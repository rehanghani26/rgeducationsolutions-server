// 2. External packages
import mongoose from 'mongoose';

// 3. Configuration
import { checkFallback } from '../config/db.js';

// 4. Models
import BudgetAllocation from '../models/BudgetAllocation.js';
import AcademicSession from '../models/AcademicSession.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import { isValidObjectId } from '../utils/commonUtil.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError
} from '../utils/responseUtil.js';

/**
 * Retrieves all session budget allocations.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getBudgets = async (req, res) => {
  try {
    if (checkFallback()) {
      const budgets = FallbackDb.find('budgetAllocations') || [];
      return sendSuccess(res, undefined, { budgets });
    }
    const budgets = await BudgetAllocation.find()
      .populate('sessionId', 'sessionName startDate endDate isCurrent')
      .sort({ createdAt: -1 });
    return sendSuccess(res, undefined, { budgets });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves budget allocation for a specific academic session with live remainder calculations.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getBudgetBySession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (checkFallback()) {
      const budgets = FallbackDb.find('budgetAllocations') || [];
      const budget = budgets.find((b) => String(b.sessionId) === String(sessionId));

      if (!budget) {
        // Find session to get name
        const sessions = FallbackDb.find('academicSessions') || [];
        const sess = sessions.find((s) => String(s._id) === String(sessionId));
        return sendSuccess(res, 'No budget allocated yet for this session', {
          budget: null,
          sessionName: sess ? sess.sessionName : '',
        });
      }

      const salaryRemaining = Math.max(0, (budget.salaryBudget || 0) - (budget.salarySpent || 0));
      const reqRemaining = Math.max(0, (budget.schoolRequirementsBudget || 0) - (budget.schoolRequirementsSpent || 0));
      const bufferRemaining = Math.max(0, (budget.operationalBufferBudget || 0) - (budget.operationalBufferSpent || 0));

      return sendSuccess(res, undefined, {
        budget: {
          ...budget,
          salaryRemaining,
          schoolRequirementsRemaining: reqRemaining,
          operationalBufferRemaining: bufferRemaining,
          totalSpent: (budget.salarySpent || 0) + (budget.schoolRequirementsSpent || 0) + (budget.operationalBufferSpent || 0),
          totalRemaining: Math.max(0, (budget.totalBudget || 0) - ((budget.salarySpent || 0) + (budget.schoolRequirementsSpent || 0) + (budget.operationalBufferSpent || 0))),
        },
      });
    }

    const budget = (sessionId && isValidObjectId(sessionId))
      ? await BudgetAllocation.findOne({ sessionId })
      : null;

    if (!budget) {
      const session = (sessionId && isValidObjectId(sessionId))
        ? await AcademicSession.findById(sessionId)
        : null;
      return sendSuccess(res, 'No budget allocated yet for this session', {
        budget: null,
        sessionName: session ? session.sessionName : '',
      });
    }

    const salaryRemaining = Math.max(0, budget.salaryBudget - budget.salarySpent);
    const reqRemaining = Math.max(0, budget.schoolRequirementsBudget - budget.schoolRequirementsSpent);
    const bufferRemaining = Math.max(0, budget.operationalBufferBudget - budget.operationalBufferSpent);
    const totalSpent = budget.salarySpent + budget.schoolRequirementsSpent + budget.operationalBufferSpent;
    const totalRemaining = Math.max(0, budget.totalBudget - totalSpent);

    return sendSuccess(res, undefined, {
      budget: {
        ...budget.toObject(),
        salaryRemaining,
        schoolRequirementsRemaining: reqRemaining,
        operationalBufferRemaining: bufferRemaining,
        totalSpent,
        totalRemaining,
      },
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Creates or updates budget allocation for an academic session.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const saveBudget = async (req, res) => {
  try {
    const {
      sessionId,
      sessionName,
      salaryBudget = 0,
      schoolRequirementsBudget = 0,
      operationalBufferBudget = 0,
      totalBudget,
      notes = '',
    } = req.body;

    if (!sessionId) {
      return sendBadRequest(res, 'Academic Session ID is required');
    }

    const numSalary = Number(salaryBudget) || 0;
    const numReq = Number(schoolRequirementsBudget) || 0;
    const numBuffer = Number(operationalBufferBudget) || 0;
    const computedTotal = totalBudget ? Number(totalBudget) : numSalary + numReq + numBuffer;

    if (checkFallback()) {
      const budgets = FallbackDb.find('budgetAllocations') || [];
      const existingIndex = budgets.findIndex((b) => String(b.sessionId) === String(sessionId));

      if (existingIndex > -1) {
        budgets[existingIndex] = {
          ...budgets[existingIndex],
          sessionName: sessionName || budgets[existingIndex].sessionName,
          salaryBudget: numSalary,
          schoolRequirementsBudget: numReq,
          operationalBufferBudget: numBuffer,
          totalBudget: computedTotal,
          notes: notes || budgets[existingIndex].notes,
          updatedAt: new Date().toISOString(),
        };
        return sendSuccess(res, 'Budget updated successfully', {
          budget: budgets[existingIndex]
        });
      }

      const newBudget = {
        _id: `bgt-${Date.now()}`,
        sessionId,
        sessionName: sessionName || 'Current Session',
        salaryBudget: numSalary,
        salarySpent: 0,
        schoolRequirementsBudget: numReq,
        schoolRequirementsSpent: 0,
        operationalBufferBudget: numBuffer,
        operationalBufferSpent: 0,
        totalBudget: computedTotal,
        notes,
        status: 'active',
        revisionLogs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      budgets.push(newBudget);
      return sendCreated(res, 'Budget allocated successfully', { budget: newBudget });
    }

    let budget = await BudgetAllocation.findOne({ sessionId });
    if (budget) {
      budget.salaryBudget = numSalary;
      budget.schoolRequirementsBudget = numReq;
      budget.operationalBufferBudget = numBuffer;
      budget.totalBudget = computedTotal;
      if (notes) budget.notes = notes;
      if (sessionName) budget.sessionName = sessionName;
      await budget.save();
      return sendSuccess(res, 'Budget updated successfully', { budget });
    }

    // Lookup session name if omitted
    let finalSessionName = sessionName;
    if (!finalSessionName) {
      const sess = await AcademicSession.findById(sessionId);
      finalSessionName = sess ? sess.sessionName : 'Academic Session';
    }

    budget = new BudgetAllocation({
      sessionId,
      sessionName: finalSessionName,
      salaryBudget: numSalary,
      salarySpent: 0,
      schoolRequirementsBudget: numReq,
      schoolRequirementsSpent: 0,
      operationalBufferBudget: numBuffer,
      operationalBufferSpent: 0,
      totalBudget: computedTotal,
      notes,
      status: 'active',
      revisionLogs: [],
    });

    await budget.save();
    return sendCreated(res, 'Budget allocated successfully', { budget });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Revises session budget with an audited supplementary increase/adjustment.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const reviseBudget = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { category, additionalAmount, reason } = req.body;

    const delta = Number(additionalAmount);
    if (!delta || delta <= 0) {
      return sendBadRequest(res, 'A valid positive revision amount is required');
    }
    if (!reason || !reason.trim()) {
      return sendBadRequest(res, 'Justification reason is required for budget revision');
    }

    const validCategories = ['salary', 'schoolRequirements', 'operationalBuffer', 'total'];
    if (!validCategories.includes(category)) {
      return sendBadRequest(res, 'Invalid budget category for revision');
    }

    const userName = req.user?.name || 'Administrator';
    const userId = req.user?._id;

    if (checkFallback()) {
      const budgets = FallbackDb.find('budgetAllocations') || [];
      const budget = budgets.find((b) => String(b.sessionId) === String(sessionId) || String(b._id) === String(sessionId));

      if (!budget) {
        return sendNotFound(res, 'Budget allocation not found for this session');
      }

      let prevAmount = 0;
      let newAmount = 0;

      if (category === 'salary') {
        prevAmount = budget.salaryBudget || 0;
        newAmount = prevAmount + delta;
        budget.salaryBudget = newAmount;
        budget.totalBudget = (budget.totalBudget || 0) + delta;
      } else if (category === 'schoolRequirements') {
        prevAmount = budget.schoolRequirementsBudget || 0;
        newAmount = prevAmount + delta;
        budget.schoolRequirementsBudget = newAmount;
        budget.totalBudget = (budget.totalBudget || 0) + delta;
      } else if (category === 'operationalBuffer') {
        prevAmount = budget.operationalBufferBudget || 0;
        newAmount = prevAmount + delta;
        budget.operationalBufferBudget = newAmount;
        budget.totalBudget = (budget.totalBudget || 0) + delta;
      } else if (category === 'total') {
        prevAmount = budget.totalBudget || 0;
        newAmount = prevAmount + delta;
        budget.totalBudget = newAmount;
      }

      budget.status = 'revised';
      if (!budget.revisionLogs) budget.revisionLogs = [];
      budget.revisionLogs.unshift({
        _id: `rev-${Date.now()}`,
        revisedBy: userId,
        revisedByName: userName,
        category,
        previousAmount: prevAmount,
        newAmount,
        deltaAmount: delta,
        reason: reason.trim(),
        revisedAt: new Date().toISOString(),
      });

      return sendSuccess(res, 'Revised budget committed successfully', { budget });
    }

    const searchOr = [{ sessionName: sessionId }];
    if (sessionId && isValidObjectId(sessionId)) {
      searchOr.push({ sessionId });
      searchOr.push({ _id: sessionId });
    }
    const budget = await BudgetAllocation.findOne({ $or: searchOr });

    if (!budget) {
      return sendNotFound(res, 'Budget allocation not found for this session');
    }

    let prevAmount = 0;
    let newAmount = 0;

    if (category === 'salary') {
      prevAmount = budget.salaryBudget;
      newAmount = prevAmount + delta;
      budget.salaryBudget = newAmount;
      budget.totalBudget += delta;
    } else if (category === 'schoolRequirements') {
      prevAmount = budget.schoolRequirementsBudget;
      newAmount = prevAmount + delta;
      budget.schoolRequirementsBudget = newAmount;
      budget.totalBudget += delta;
    } else if (category === 'operationalBuffer') {
      prevAmount = budget.operationalBufferBudget;
      newAmount = prevAmount + delta;
      budget.operationalBufferBudget = newAmount;
      budget.totalBudget += delta;
    } else if (category === 'total') {
      prevAmount = budget.totalBudget;
      newAmount = prevAmount + delta;
      budget.totalBudget = newAmount;
    }

    budget.status = 'revised';
    budget.revisionLogs.unshift({
      revisedBy: userId,
      revisedByName: userName,
      category,
      previousAmount: prevAmount,
      newAmount,
      deltaAmount: delta,
      reason: reason.trim(),
      revisedAt: new Date(),
    });

    await budget.save();
    return sendSuccess(res, 'Revised budget committed successfully', { budget });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};
