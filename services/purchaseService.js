import { catalogFields, findCatalogItem, recordMovement } from './inventoryStockService.js';
import { writeProcurement } from './procurementStore.js';
import {
  activeSession,
  actor,
  billDueDate,
  budgetAmounts,
  cleanText,
  CREDIT_METHOD,
  dateValue,
  displayBillNumber,
  generatedCode,
  inventoryUnitCost,
  legacyBundle,
  numeric,
  optionalCode,
  paymentBalance,
  PAYMENT_METHODS,
  procurementError,
  recordId,
  recordIds,
  requestHash,
  roundMoney,
  roundQuantity,
  sessionBudget,
  sessionById,
  stockStatus,
} from '../utils/procurementValues.js';

const formatAmount = (amount) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

function purchaseLine(input, item) {
  const quantity = numeric(input.quantity, 'Quantity for ' + item.name, {
    min: 0.001,
    fallback: 0,
    round: roundQuantity,
  });
  if (!quantity) throw procurementError('Enter a quantity for ' + item.name + '.');
  const unitCost = numeric(input.unitCost, 'Unit cost for ' + item.name, { fallback: roundMoney(inventoryUnitCost(item)) });
  const gstRate = numeric(input.gstRate, 'GST rate for ' + item.name, { max: 100, fallback: item.gstRate || 0 });
  const totalCost = roundMoney(quantity * unitCost);
  return {
    itemId: recordId(item),
    name: item.name,
    sku: item.sku,
    category: item.category,
    unit: item.unit,
    quantity,
    unitCost,
    totalCost,
    gstRate,
    gstAmount: roundMoney(totalCost * gstRate / 100),
  };
}

function purchaseAmounts(input, items) {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.totalCost, 0));
  const calculatedTax = roundMoney(items.reduce((sum, item) => sum + item.gstAmount, 0));
  const taxAmount = numeric(input.taxAmount, 'Invoice tax', { fallback: calculatedTax });
  const discountAmount = numeric(input.discountAmount, 'Invoice discount');
  const shippingCharges = numeric(input.shippingCharges, 'Shipping charges');
  const otherCharges = numeric(input.otherCharges, 'Other charges');
  const grandTotal = roundMoney(subtotal + taxAmount + shippingCharges + otherCharges - discountAmount);
  if (grandTotal < 0) throw procurementError('The invoice discount exceeds the invoice amount.');
  if (grandTotal > 1e12) throw procurementError('The invoice total is too large.');

  const paymentType = cleanText(input.paymentType) || 'Bank Transfer';
  if (![...PAYMENT_METHODS, CREDIT_METHOD].includes(paymentType)) throw procurementError('Select a valid payment method.');
  const amountPaid = numeric(input.amountPaid, 'Amount paid', {
    fallback: paymentType === CREDIT_METHOD ? 0 : grandTotal,
    max: grandTotal,
  });
  if (paymentType === CREDIT_METHOD && amountPaid > 0) {
    throw procurementError('Select the method used for the amount already paid.');
  }

  return {
    subtotal, taxAmount, discountAmount, shippingCharges, otherCharges, grandTotal, paymentType,
    ...paymentBalance(grandTotal, amountPaid),
  };
}

const purchaseCollections = ['academicSessions', 'budgetAllocations', 'inventory', 'inventoryPurchases', 'inventoryTransactions', 'vendors'];

export async function postPurchase(req) {
  const input = req.body || {};
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) {
    throw procurementError('Add between 1 and 100 items to the bill.');
  }
  const supplierBillNumber = optionalCode(input.supplierBillNumber || input.billNumber);
  if (!supplierBillNumber || supplierBillNumber.length > 100) {
    throw procurementError('Enter a supplier invoice number of up to 100 characters.');
  }
  const billNumber = generatedCode('BILL');
  const today = new Date().toISOString();
  const billDate = dateValue(input.billDate, 'Bill date', today);
  const receivedDate = dateValue(input.receivedDate, 'Received date', today);
  const expectedDeliveryDate = dateValue(input.expectedDeliveryDate, 'Expected delivery date');
  const actorInfo = actor(req);

  return writeProcurement(req, purchaseCollections, async (store) => {
    const vendor = await store.get('vendors', input.vendorId);
    if (!vendor) throw procurementError('Vendor not found.', 404);
    if (vendor.status && vendor.status !== 'active') throw procurementError('Select an active vendor.', 409);

    const vendorId = recordId(vendor);
    if (
      await store.one('inventoryPurchases', { vendorId, supplierBillNumber }) ||
      await store.one('inventoryPurchases', { vendorId, billNumber: supplierBillNumber })
    ) {
      throw procurementError('This vendor invoice has already been recorded.', 409);
    }

    const session = input.sessionId ? await sessionById(store, input.sessionId) : await activeSession(store);
    if (!session) throw procurementError('Select an academic session with an approved inventory budget.', 409);
    await store.lockBudget(recordId(session));
    const budget = await sessionBudget(store, session);
    if (!budget || ['draft', 'closed'].includes(budget.status)) {
      throw procurementError('The selected session needs an approved, open inventory budget.', 409);
    }
    const { schoolRequirementsBudget, schoolRequirementsSpent, remainingBudget } = budgetAmounts(budget);
    if (!(schoolRequirementsBudget > 0) || !Number.isFinite(remainingBudget)) {
      throw procurementError('Allocate an inventory budget for this session in Settings.', 409);
    }

    const targets = new Map();
    const catalogUpdates = new Map();
    const items = [];
    for (const line of input.items) {
      let item;
      let catalogId;
      if (line?.itemId) {
        item = await store.get('inventory', line.itemId);
        if (!item) throw procurementError('A stock item on this invoice could not be found. Search for the current SKU.', 404);
      } else if (line?.product) {
        const { catalogId: preset, name, description, category, subcategory, imageUrl, unit } = line.product;
        if (!preset) throw procurementError('Select a catalog product or a stock item.');
        const fields = catalogFields({
          catalogId: preset, name, description, category, subcategory, imageUrl, unit,
          unitCost: line.unitCost, gstRate: line.gstRate, vendorId, quantity: 0,
        });
        catalogId = fields.catalogId;
        item = await findCatalogItem(store, fields);
        if (item && item.unit !== fields.unit) {
          throw procurementError('The stock unit for ' + item.name + ' has changed. Select its existing SKU.', 409);
        }
        if (!item) item = await store.create('inventory', fields);
      } else {
        throw procurementError('Select a catalog product or a stock item.');
      }
      const key = String(recordId(item));
      if (targets.has(key)) throw procurementError('Combine repeated entries for ' + item.name + ' into one line.');
      if (item.status === 'discontinued' || legacyBundle(item)) {
        throw procurementError('Select an active individual SKU in place of ' + item.name + '.', 409);
      }
      targets.set(key, item);
      if (catalogId && !item.catalogId) catalogUpdates.set(key, catalogId);
      items.push(purchaseLine(line, item));
    }
    const amounts = purchaseAmounts(input, items);
    if (amounts.grandTotal >= remainingBudget) {
      throw procurementError(
        'The invoice total of ' + formatAmount(amounts.grandTotal) +
        ' must be lower than the available inventory budget of ' + formatAmount(remainingBudget) + '.', 409
      );
    }
    const paymentDate = amounts.amountPaid > 0 ? dateValue(input.paymentDate, 'Payment date', billDate) : undefined;
    const dueDate = dateValue(input.dueDate, 'Payment due date', billDueDate(billDate, vendor.paymentTerms));
    if (dueDate.slice(0, 10) < billDate.slice(0, 10)) {
      throw procurementError('The payment due date must be on or after the invoice date.');
    }

    const budgetDeducted = {
      budgetAllocationId: recordId(budget),
      category: 'schoolRequirements',
      amount: amounts.grandTotal,
      allocatedAmount: schoolRequirementsBudget,
      previousSpent: schoolRequirementsSpent,
      newSpent: roundMoney(schoolRequirementsSpent + amounts.grandTotal),
    };

    const purchase = await store.create('inventoryPurchases', {
      billNumber,
      supplierBillNumber,
      vendorId,
      vendorName: vendor.name,
      sessionId: recordId(session),
      sessionName: session.sessionName,
      billDate,
      receivedDate,
      expectedDeliveryDate,
      paymentDate,
      initialAmountPaid: amounts.amountPaid,
      deliveryCarrier: cleanText(input.deliveryCarrier),
      deliveryReference: cleanText(input.deliveryReference),
      deliveryLocation: cleanText(input.deliveryLocation),
      deliveryNotes: cleanText(input.deliveryNotes),
      dueDate,
      poNumber: cleanText(input.poNumber),
      notes: cleanText(input.notes),
      invoiceAttachmentUrl: cleanText(input.invoiceAttachmentUrl),
      transactionReference: cleanText(input.transactionReference),
      receivedBy: actorInfo.id,
      receivedByName: actorInfo.name,
      budgetDeducted,
      items,
      ...amounts,
    });

    for (const line of items) {
      const key = String(line.itemId);
      const item = targets.get(key);
      const previous = Number(item.quantity || 0);
      const quantity = roundQuantity(previous + line.quantity);
      const unitCost = roundMoney((previous * inventoryUnitCost(item) + line.totalCost) / quantity);
      const updated = await store.update('inventory', line.itemId, {
        quantity,
        totalQuantity: quantity,
        unitCost,
        price: unitCost,
        unitCostVerified: true,
        ...(catalogUpdates.has(key) ? { catalogId: catalogUpdates.get(key) } : {}),
        status: stockStatus({ ...item, quantity }),
      });
      await recordMovement(store, updated, req, {
        type: 'STOCK_IN_PURCHASE',
        sessionId: recordId(session),
        quantity: line.quantity,
        unitPrice: line.unitCost,
        referenceId: recordId(purchase),
        referenceDocNumber: displayBillNumber(purchase),
        partyName: vendor.name,
        reason: 'Vendor receipt',
      });
    }

    const totalBilled = roundMoney(Number(vendor.totalBilled || 0) + amounts.grandTotal);
    const totalPaid = roundMoney(Number(vendor.totalPaid || 0) + amounts.amountPaid);
    await store.update('vendors', vendorId, {
      totalBilled,
      totalPaid,
      outstandingBalance: roundMoney(totalBilled - totalPaid),
    });
    await store.update('budgetAllocations', budgetDeducted.budgetAllocationId, {
      schoolRequirementsSpent: budgetDeducted.newSpent,
    });
    return purchase;
  });
}

export async function applyVendorPayment(req) {
  const input = req.body || {};
  const amount = numeric(input.amount, 'Payment amount', { min: 0.01 });
  if (!amount) throw procurementError('Enter a payment amount.');
  const paymentType = cleanText(input.paymentType) || 'Bank Transfer';
  if (!PAYMENT_METHODS.includes(paymentType)) throw procurementError('Select a valid payment method.');
  const paymentDate = dateValue(input.paymentDate, 'Payment date', new Date().toISOString());
  const requestId = cleanText(input.requestId).slice(0, 100);
  const transactionReference = cleanText(input.transactionReference);
  const notes = cleanText(input.notes);
  const fingerprint = requestHash([input.billId || '', amount, input.paymentDate || '', paymentType, transactionReference, notes]);

  return writeProcurement(req, ['vendors', 'inventoryPurchases'], async (store) => {
    const vendor = await store.get('vendors', req.params.id);
    if (!vendor) throw procurementError('Vendor not found.', 404);
    const previous = requestId && vendor.payments?.find((payment) => payment.requestId === requestId);
    if (previous) {
      if (previous.requestHash && previous.requestHash !== fingerprint) {
        throw procurementError('This payment was already recorded. Refresh the vendor balance before entering another payment.', 409);
      }
      return { vendor, payment: previous, alreadyRecorded: true };
    }
    const vendorId = recordId(vendor);
    const outstanding = roundMoney(Number(vendor.totalBilled || 0) - Number(vendor.totalPaid || 0));

    let bills;
    if (input.billId) {
      const bill = await store.get('inventoryPurchases', input.billId);
      if (!bill || !recordIds(vendor).includes(String(bill.vendorId))) throw procurementError('Invoice not found for this vendor.', 404);
      if (amount > Number(bill.balanceDue || 0)) throw procurementError('The payment exceeds the balance on this invoice.', 409);
      if (paymentDate.slice(0, 10) < new Date(bill.billDate).toISOString().slice(0, 10)) {
        throw procurementError('The payment date must be on or after the invoice date.');
      }
      bills = [bill];
    } else {
      bills = (await store.find('inventoryPurchases', { vendorId }))
        .filter((bill) => bill.balanceDue > 0)
        .sort((a, b) => new Date(a.billDate) - new Date(b.billDate));
    }
    if (amount > outstanding) throw procurementError('The payment exceeds the vendor balance.', 409);

    const appliedBills = [];
    let unassigned = amount;
    for (const bill of bills) {
      if (!unassigned) break;
      if (new Date(bill.billDate).toISOString().slice(0, 10) > paymentDate.slice(0, 10)) continue;
      const applied = Math.min(unassigned, Number(bill.balanceDue));
      const billId = recordId(bill);
      await store.update('inventoryPurchases', billId,
        paymentBalance(Number(bill.grandTotal), roundMoney(Number(bill.amountPaid || 0) + applied)));
      appliedBills.push({ billId, billNumber: displayBillNumber(bill), amount: applied });
      unassigned = roundMoney(unassigned - applied);
    }

    const openBillBalance = roundMoney(bills.reduce((sum, bill) => sum + Number(bill.balanceDue || 0), 0));
    const legacyBalance = Math.max(0, roundMoney(outstanding - openBillBalance));
    if (unassigned > legacyBalance) {
      throw procurementError('The payment exceeds the outstanding balance on or before the payment date.', 409);
    }
    const payment = {
      requestId,
      requestHash: fingerprint,
      amount,
      paymentType,
      paymentDate,
      transactionReference,
      notes,
      appliedBills,
      recordedByName: actor(req).name,
    };
    const totalPaid = roundMoney(Number(vendor.totalPaid || 0) + amount);
    const updated = await store.update('vendors', vendorId, {
      totalPaid,
      outstandingBalance: roundMoney(outstanding - amount),
      payments: [payment, ...(vendor.payments || [])],
    });
    return { vendor: updated, payment };
  });
}
