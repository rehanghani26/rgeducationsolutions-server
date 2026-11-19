import { readProcurement, writeProcurement } from '../services/procurementStore.js';
import {
  actor,
  BUDGET_BUCKETS,
  cleanText,
  dateValue,
  numeric,
  procurementError,
  recordId,
  roundMoney,
  sendProcurementError,
  sessionBudget,
} from '../utils/procurementValues.js';
import { sendCreated, sendSuccess } from '../utils/responseUtil.js';

const budgetFields = ['salaryBudget', 'schoolRequirementsBudget', 'operationalBufferBudget'];
const spentFields = ['salarySpent', 'schoolRequirementsSpent', 'operationalBufferSpent'];
const budgetLabels = {
  salaryBudget: 'Staff salary allocation',
  schoolRequirementsBudget: 'School requirements allocation',
  operationalBufferBudget: 'Operational buffer allocation',
  totalBudget: 'Approved total',
};
const sumFields = (record, fields) => roundMoney(fields.reduce((sum, field) => sum + Number(record[field] || 0), 0));

function budgetView(budget) {
  if (!budget) return null;
  const totalSpent = sumFields(budget, spentFields);
  return {
    ...budget,
    unallocated: roundMoney(Number(budget.totalBudget || 0) - sumFields(budget, budgetFields)),
    totalSpent,
    remaining: roundMoney(Number(budget.totalBudget || 0) - totalSpent),
    salaryRemaining: roundMoney(Number(budget.salaryBudget || 0) - Number(budget.salarySpent || 0)),
    schoolRequirementsRemaining: roundMoney(Number(budget.schoolRequirementsBudget || 0) - Number(budget.schoolRequirementsSpent || 0)),
    operationalBufferRemaining: roundMoney(Number(budget.operationalBufferBudget || 0) - Number(budget.operationalBufferSpent || 0)),
  };
}

function revision(req, category, before, after, reason) {
  const user = actor(req);
  return {
    revisedBy: user.id,
    revisedByName: user.name,
    category,
    previousAmount: before,
    newAmount: after,
    deltaAmount: roundMoney(after - before),
    reason,
    revisedAt: new Date().toISOString(),
  };
}

async function findBudget(store, id) {
  const direct = await store.get('budgetAllocations', id);
  if (direct) return direct;
  const session = await store.get('academicSessions', id);
  if (session) return sessionBudget(store, session);
  return store.one('budgetAllocations', { sessionName: id });
}

export async function getBudgets(req, res) {
  try {
    const store = readProcurement(req);
    const admin = ['super-admin', 'school-admin', 'admin', 'principal'].includes(req.user?.role);
    const match = admin && req.query.allSessions === 'true' ? {}
      : req.query.sessionId === 'legacy' ? { sessionId: null }
      : req.academicSessionId ? { sessionId: req.academicSessionId } : {};
    const budgets = (await store.find('budgetAllocations', match))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(budgetView);
    return sendSuccess(res, undefined, { budgets }, 200, { budgets });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function getBudgetBySession(req, res) {
  try {
    const store = readProcurement(req);
    const id = req.params.sessionId;
    const session = await store.get('academicSessions', id) || await store.one('academicSessions', { sessionName: id });
    const budget = budgetView(session ? await sessionBudget(store, session) : await findBudget(store, id));
    const details = { budget, sessionName: session?.sessionName || budget?.sessionName || '' };
    return sendSuccess(res, undefined, details, 200, details);
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function saveBudget(req, res) {
  try {
    const input = req.body || {};
    if (!input.sessionId) throw procurementError('Select an academic session.');
    const saved = await writeProcurement(req, ['academicSessions', 'budgetAllocations', 'inventoryPurchases'], async (store) => {
      const session = await store.get('academicSessions', input.sessionId);
      if (!session) throw procurementError('Academic session not found.', 404);
      const sessionId = recordId(session);
      await store.lockBudget(sessionId);
      const existing = await sessionBudget(store, session);
      if (existing?.status === 'closed') throw procurementError('This budget is closed.', 409);
      const amounts = Object.fromEntries(budgetFields.map((field) => [
        field, numeric(input[field], budgetLabels[field], { fallback: existing?.[field] || 0 }),
      ]));
      const allocated = sumFields(amounts, budgetFields);
      const totalBudget = numeric(input.totalBudget, 'Approved total', {
        fallback: Object.hasOwn(input, 'totalBudget') ? allocated : existing?.totalBudget ?? allocated,
      });
      if (allocated > totalBudget) throw procurementError('The category allocations exceed the approved total.');

      const changes = { sessionId, sessionName: session.sessionName, ...amounts, totalBudget };
      for (const field of ['notes', 'budgetOwner', 'approvalReference']) {
        if (Object.hasOwn(input, field)) changes[field] = cleanText(input[field]);
      }
      if (Object.hasOwn(input, 'approvedDate')) changes.approvedDate = dateValue(input.approvedDate, 'Approval date');

      if (!existing) {
        const purchases = await store.find('inventoryPurchases', { sessionId });
        changes.schoolRequirementsSpent = roundMoney(purchases.reduce((sum, bill) => sum + Number(bill.grandTotal || 0), 0));
        changes.salarySpent = 0;
        changes.operationalBufferSpent = 0;
        changes.status = 'active';
        changes.revisionLogs = [];
        return { created: true, budget: await store.create('budgetAllocations', changes) };
      }

      const logs = Object.entries(BUDGET_BUCKETS).flatMap(([category, field]) => {
        const before = Number(existing[field] || 0);
        const after = changes[field];
        return before === after ? [] : [revision(req, category, before, after, cleanText(input.revisionReason) || 'Allocation updated')];
      });
      if (logs.length) {
        changes.status = 'revised';
        changes.revisionLogs = [...logs, ...(existing.revisionLogs || [])];
      }
      return { created: false, budget: await store.update('budgetAllocations', recordId(existing), changes) };
    });

    const budget = budgetView(saved.budget);
    if (saved.created) return sendCreated(res, 'Budget allocated.', { budget }, { budget });
    return sendSuccess(res, 'Budget saved.', { budget }, 200, { budget });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function reviseBudget(req, res) {
  try {
    const { category, additionalAmount, reason } = req.body || {};
    if (!Object.hasOwn(BUDGET_BUCKETS, category)) throw procurementError('Select a valid budget category.');
    const delta = numeric(additionalAmount, 'Increase amount', { min: 0.01 });
    const justification = cleanText(reason);
    if (!delta || !justification) throw procurementError('Enter an increase and a reason for the revision.');

    const budget = budgetView(await writeProcurement(req, ['academicSessions', 'budgetAllocations'], async (store) => {
      const existing = await findBudget(store, req.params.sessionId);
      if (!existing) throw procurementError('Budget allocation not found.', 404);
      if (existing.status === 'closed') throw procurementError('This budget is closed.', 409);
      const field = BUDGET_BUCKETS[category];
      const before = Number(existing[field] || 0);
      const after = roundMoney(before + delta);
      const totalBudget = roundMoney(Number(existing.totalBudget || 0) + delta);
      if (totalBudget > 1e12) throw procurementError('The approved total is too large.');
      return store.update('budgetAllocations', recordId(existing), {
        [field]: after,
        totalBudget,
        status: 'revised',
        revisionLogs: [revision(req, category, before, after, justification), ...(existing.revisionLogs || [])],
      });
    }));
    return sendSuccess(res, 'Budget revised.', { budget }, 200, { budget });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}
