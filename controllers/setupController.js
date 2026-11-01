// 3. Configuration
import { checkFallback } from "../config/db.js";

// 4. Models
import AcademicSession from "../models/AcademicSession.js";
import MasterPeriod from "../models/MasterPeriod.js";
import Setting from "../models/Setting.js";

// 6. Services
import { FallbackDb } from "../services/dbFallback.js";

// 7. Utilities
import {
  sendBadRequest,
  sendError,
  sendSuccess,
} from "../utils/responseUtil.js";

/**
 * @file setupController.js
 * @description Setup Wizard API — computes live setup status by inspecting actual
 * database records across Settings, AcademicSession, MasterPeriod, and more.
 */

// ─── Step Evaluation Helpers ──────────────────────────────────────────────────

/**
 * Step 1 — School Profile
 * Requires: schoolName, contactEmail, schoolPhone, addressLine1, city, state, country
 */
function evaluateSchoolProfile(settings) {
  const s = settings || {};
  const mandatory = [
    "schoolName",
    "contactEmail",
    "schoolPhone",
    "addressLine1",
    "city",
    "state",
    "country",
  ];
  const filled = mandatory.filter(
    (f) => s[f] && String(s[f]).trim().length > 0
  );
  return {
    complete: filled.length >= mandatory.length,
    filledCount: filled.length,
    totalCount: mandatory.length,
    missingFields: mandatory.filter((f) => !s[f] || !String(s[f]).trim()),
  };
}

/**
 * Step 2 — Academic Session
 * Requires: at least one session that isCurrent === true
 */
async function evaluateAcademicSession() {
  try {
    if (checkFallback()) {
      const sessions = FallbackDb.find("academicSessions") || [];
      const active = sessions.find((s) => s.isCurrent);
      return {
        complete: Boolean(active),
        sessionCount: sessions.length,
        activeSession: active?.sessionName || null,
      };
    }
    const count = await AcademicSession.countDocuments();
    const active = await AcademicSession.findOne({ isCurrent: true }).lean();
    return {
      complete: Boolean(active),
      sessionCount: count,
      activeSession: active?.sessionName || null,
    };
  } catch {
    return { complete: false, sessionCount: 0, activeSession: null };
  }
}

/**
 * Step 3 — Master Periods
 * Requires: at least one MasterPeriod document exists
 */
async function evaluateMasterPeriods() {
  try {
    if (checkFallback()) {
      const periods = FallbackDb.find("masterPeriods") || [];
      return { complete: periods.length > 0, periodCount: periods.length };
    }
    const count = await MasterPeriod.countDocuments();
    return { complete: count > 0, periodCount: count };
  } catch {
    return { complete: false, periodCount: 0 };
  }
}

/**
 * Step 4 — Academic Rules
 * Requires: defaultPassingPercentage is explicitly set.
 */
function evaluateAcademicRules(settings) {
  const sw = settings?.setupWizard || {};
  if (sw.academicRules) return { complete: true };
  const hasPassingPct =
    settings?.defaultPassingPercentage &&
    settings.defaultPassingPercentage !== 40;
  return { complete: Boolean(hasPassingPct) };
}

/**
 * Step 5 — Finance Policies
 * Requires: currencySymbol is not the default '$' OR the wizard flag is set.
 */
function evaluateFinancePolicies(settings) {
  const sw = settings?.setupWizard || {};
  if (sw.financePolicies) return { complete: true };
  const hasCustomCurrency =
    settings?.currencySymbol && settings.currencySymbol !== "$";
  return { complete: Boolean(hasCustomCurrency) };
}

// ─── Main Status Builder ──────────────────────────────────────────────────────

async function buildSetupStatus(settings) {
  const [sessionEval, periodsEval] = await Promise.all([
    evaluateAcademicSession(),
    evaluateMasterPeriods(),
  ]);

  const profileEval = evaluateSchoolProfile(settings);
  const academicEval = evaluateAcademicRules(settings);
  const financeEval = evaluateFinancePolicies(settings);

  const steps = [
    {
      key: "schoolProfile",
      stepNumber: 1,
      title: "School Profile & Identity",
      description: "Set your school name, logo, contact info, and address.",
      route: "/settings/profile",
      complete: profileEval.complete,
      detail: profileEval,
      icon: "school",
      priority: "critical",
    },
    {
      key: "academicSession",
      stepNumber: 2,
      title: "Academic Session & Calendar",
      description: "Create and activate the current academic year.",
      route: "/settings/session",
      complete: sessionEval.complete,
      detail: sessionEval,
      icon: "calendar",
      priority: "critical",
    },
    {
      key: "masterPeriods",
      stepNumber: 3,
      title: "Master Period & Bell Schedule",
      description: "Define school timings, periods, and daily schedule.",
      route: "/settings/master-period",
      complete: periodsEval.complete,
      detail: periodsEval,
      icon: "clock",
      priority: "critical",
    },
    {
      key: "academicRules",
      stepNumber: 4,
      title: "Academic & Grading Rules",
      description: "Set passing marks, grading scale, and exam types.",
      route: "/settings/academic",
      complete: academicEval.complete,
      detail: academicEval,
      icon: "graduationCap",
      priority: "high",
    },
    {
      key: "financePolicies",
      stepNumber: 5,
      title: "Finance & Fee Policies",
      description: "Configure currency, fee types, and payment rules.",
      route: "/settings/finance",
      complete: financeEval.complete,
      detail: financeEval,
      icon: "coins",
      priority: "high",
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  const totalSteps = steps.length;
  const percentComplete = Math.round((completedCount / totalSteps) * 100);
  const isFullyComplete = completedCount === totalSteps;
  const isDismissed = settings?.setupWizard?.dismissed || false;
  const completedAt = settings?.setupWizard?.completedAt || null;

  if (isFullyComplete && !completedAt) {
    try {
      await Setting.findOneAndUpdate(
        {},
        { "setupWizard.completedAt": new Date() },
        { upsert: true }
      );
    } catch (_e) {}
  }

  return {
    steps,
    completedCount,
    totalSteps,
    percentComplete,
    isFullyComplete,
    isDismissed,
    completedAt,
    nextStep: steps.find((s) => !s.complete) || null,
  };
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * Returns complete wizard progress by evaluating live DB records.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getSetupStatus = async (req, res) => {
  try {
    let settings;
    if (checkFallback()) {
      settings = FallbackDb.getSettings() || {};
    } else {
      settings = await Setting.findOne().lean();
      if (!settings) {
        settings = await Setting.create({});
        settings = settings.toObject();
      }
    }

    const status = await buildSetupStatus(settings);
    return sendSuccess(res, undefined, null, 200, { ...status });
  } catch (err) {
    console.error("[Setup] getSetupStatus error:", err);
    return sendError(res, "Failed to compute setup status.", 500);
  }
};

/**
 * Marks a flag-based step as complete.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const completeStep = async (req, res) => {
  try {
    const { step } = req.body;
    const flagSteps = ["academicRules", "financePolicies"];

    if (!step) {
      return sendBadRequest(res, "step is required.");
    }

    if (!flagSteps.includes(step)) {
      let settings;
      if (checkFallback()) {
        settings = FallbackDb.getSettings() || {};
      } else {
        settings = await Setting.findOne().lean();
      }
      const status = await buildSetupStatus(settings);
      return sendSuccess(res, "Status refreshed.", null, 200, { ...status });
    }

    const updateKey = `setupWizard.${step}`;
    let settings;
    if (checkFallback()) {
      settings = FallbackDb.getSettings() || {};
      if (!settings.setupWizard) settings.setupWizard = {};
      settings.setupWizard[step] = true;
      FallbackDb.updateSettings(settings);
      settings = FallbackDb.getSettings();
    } else {
      await Setting.findOneAndUpdate(
        {},
        { [updateKey]: true },
        { upsert: true, new: true }
      );
      settings = await Setting.findOne().lean();
    }

    const status = await buildSetupStatus(settings);
    return sendSuccess(
      res,
      `Step "${step}" marked complete.`,
      null,
      200,
      { ...status }
    );
  } catch (err) {
    console.error("[Setup] completeStep error:", err);
    return sendError(res, "Failed to update step status.", 500);
  }
};

/**
 * Admin dismisses the wizard.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const dismissWizard = async (req, res) => {
  try {
    if (checkFallback()) {
      const s = FallbackDb.getSettings() || {};
      if (!s.setupWizard) s.setupWizard = {};
      s.setupWizard.dismissed = true;
      FallbackDb.updateSettings(s);
    } else {
      await Setting.findOneAndUpdate(
        {},
        { "setupWizard.dismissed": true },
        { upsert: true }
      );
    }
    return sendSuccess(res, "Setup wizard dismissed.");
  } catch (_err) {
    return sendError(res, "Failed to dismiss wizard.", 500);
  }
};

/**
 * Super-admin only: resets all wizard flags to false.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const resetWizard = async (req, res) => {
  try {
    const resetPayload = {
      "setupWizard.schoolProfile": false,
      "setupWizard.academicSession": false,
      "setupWizard.masterPeriods": false,
      "setupWizard.academicRules": false,
      "setupWizard.financePolicies": false,
      "setupWizard.completedAt": null,
      "setupWizard.dismissed": false,
    };

    if (checkFallback()) {
      const s = FallbackDb.getSettings() || {};
      s.setupWizard = {
        schoolProfile: false,
        academicSession: false,
        masterPeriods: false,
        academicRules: false,
        financePolicies: false,
        completedAt: null,
        dismissed: false,
      };
      FallbackDb.updateSettings(s);
    } else {
      await Setting.findOneAndUpdate({}, resetPayload, { upsert: true });
    }

    return sendSuccess(res, "Setup wizard has been reset.");
  } catch (_err) {
    return sendError(res, "Failed to reset wizard.", 500);
  }
};
