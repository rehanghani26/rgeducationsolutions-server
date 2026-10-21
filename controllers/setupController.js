/**
 * @file setupController.js
 * @description Setup Wizard API — computes live setup status by inspecting actual
 * database records across Settings, AcademicSession, MasterPeriod, and more.
 *
 * Routes:
 *   GET  /api/v1/setup/status          → returns current wizard progress
 *   POST /api/v1/setup/complete-step   → mark a step complete / re-evaluate
 *   POST /api/v1/setup/dismiss         → admin dismisses the wizard
 *   POST /api/v1/setup/reset           → (super-admin only) reset wizard state
 */

import Setting from '../models/Setting.js';
import AcademicSession from '../models/AcademicSession.js';
import MasterPeriod from '../models/MasterPeriod.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';

// ─── Step Evaluation Helpers ──────────────────────────────────────────────────

/**
 * Step 1 — School Profile
 * Requires: schoolName, contactEmail, schoolPhone, addressLine1, city, state, country
 */
function evaluateSchoolProfile(settings) {
  const s = settings || {};
  const mandatory = ['schoolName', 'contactEmail', 'schoolPhone', 'addressLine1', 'city', 'state', 'country'];
  const filled = mandatory.filter((f) => s[f] && String(s[f]).trim().length > 0);
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
      const sessions = FallbackDb.find('academicSessions') || [];
      const active = sessions.find((s) => s.isCurrent);
      return { complete: !!active, sessionCount: sessions.length, activeSession: active?.sessionName || null };
    }
    const count = await AcademicSession.countDocuments();
    const active = await AcademicSession.findOne({ isCurrent: true }).lean();
    return { complete: !!active, sessionCount: count, activeSession: active?.sessionName || null };
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
      const periods = FallbackDb.find('masterPeriods') || [];
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
 * Requires: defaultPassingPercentage is explicitly set (not the default 40 doesn't count as "configured")
 * We use a setupWizard.academicRules flag because there's no "empty" state in the DB — admin must save it.
 */
function evaluateAcademicRules(settings) {
  const sw = settings?.setupWizard || {};
  // If the flag is explicitly set, use it. Otherwise, if gradePointScale or passingPercentage
  // has been intentionally configured, treat as complete.
  if (sw.academicRules) return { complete: true };
  // Treat as configured if the admin explicitly changed any academic setting
  const hasPassingPct = settings?.defaultPassingPercentage && settings.defaultPassingPercentage !== 40;
  return { complete: !!hasPassingPct };
}

/**
 * Step 5 — Finance Policies
 * Requires: currencySymbol is not the default '$' OR the wizard flag is set.
 */
function evaluateFinancePolicies(settings) {
  const sw = settings?.setupWizard || {};
  if (sw.financePolicies) return { complete: true };
  // Treat as configured if currency or late fee was explicitly changed
  const hasCustomCurrency = settings?.currencySymbol && settings.currencySymbol !== '$';
  return { complete: !!hasCustomCurrency };
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
      key: 'schoolProfile',
      stepNumber: 1,
      title: 'School Profile & Identity',
      description: 'Set your school name, logo, contact info, and address.',
      route: '/settings/profile',
      complete: profileEval.complete,
      detail: profileEval,
      icon: 'school',
      priority: 'critical',
    },
    {
      key: 'academicSession',
      stepNumber: 2,
      title: 'Academic Session & Calendar',
      description: 'Create and activate the current academic year.',
      route: '/settings/session',
      complete: sessionEval.complete,
      detail: sessionEval,
      icon: 'calendar',
      priority: 'critical',
    },
    {
      key: 'masterPeriods',
      stepNumber: 3,
      title: 'Master Period & Bell Schedule',
      description: 'Define school timings, periods, and daily schedule.',
      route: '/settings/master-period',
      complete: periodsEval.complete,
      detail: periodsEval,
      icon: 'clock',
      priority: 'critical',
    },
    {
      key: 'academicRules',
      stepNumber: 4,
      title: 'Academic & Grading Rules',
      description: 'Set passing marks, grading scale, and exam types.',
      route: '/settings/academic',
      complete: academicEval.complete,
      detail: academicEval,
      icon: 'graduationCap',
      priority: 'high',
    },
    {
      key: 'financePolicies',
      stepNumber: 5,
      title: 'Finance & Fee Policies',
      description: 'Configure currency, fee types, and payment rules.',
      route: '/settings/finance',
      complete: financeEval.complete,
      detail: financeEval,
      icon: 'coins',
      priority: 'high',
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  const totalSteps = steps.length;
  const percentComplete = Math.round((completedCount / totalSteps) * 100);
  const isFullyComplete = completedCount === totalSteps;
  const isDismissed = settings?.setupWizard?.dismissed || false;
  const completedAt = settings?.setupWizard?.completedAt || null;

  // Auto-mark completedAt if just became 100%
  if (isFullyComplete && !completedAt) {
    try {
      await Setting.findOneAndUpdate(
        {},
        { 'setupWizard.completedAt': new Date() },
        { upsert: true }
      );
    } catch (_) {}
  }

  return {
    steps,
    completedCount,
    totalSteps,
    percentComplete,
    isFullyComplete,
    isDismissed,
    completedAt,
    // Next incomplete step
    nextStep: steps.find((s) => !s.complete) || null,
  };
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/setup/status
 * Returns complete wizard progress by evaluating live DB records.
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
    return res.json({ success: true, ...status });
  } catch (err) {
    console.error('[Setup] getSetupStatus error:', err);
    return res.status(500).json({ success: false, message: 'Failed to compute setup status.' });
  }
};

/**
 * POST /api/v1/setup/complete-step
 * Body: { step: 'academicRules' | 'financePolicies' }
 * Marks a flag-based step as complete (for steps that don't have a DB record to check).
 */
export const completeStep = async (req, res) => {
  try {
    const { step } = req.body;
    const flagSteps = ['academicRules', 'financePolicies'];

    if (!step) {
      return res.status(400).json({ success: false, message: 'step is required.' });
    }

    if (!flagSteps.includes(step)) {
      // For record-based steps (schoolProfile, academicSession, masterPeriods),
      // just re-evaluate and return the fresh status.
      let settings;
      if (checkFallback()) {
        settings = FallbackDb.getSettings() || {};
      } else {
        settings = await Setting.findOne().lean();
      }
      const status = await buildSetupStatus(settings);
      return res.json({ success: true, message: 'Status refreshed.', ...status });
    }

    // Set the wizard flag for flag-based steps
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
    return res.json({ success: true, message: `Step "${step}" marked complete.`, ...status });
  } catch (err) {
    console.error('[Setup] completeStep error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update step status.' });
  }
};

/**
 * POST /api/v1/setup/dismiss
 * Admin dismisses the wizard. The banner will no longer show.
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
        { 'setupWizard.dismissed': true },
        { upsert: true }
      );
    }
    return res.json({ success: true, message: 'Setup wizard dismissed.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to dismiss wizard.' });
  }
};

/**
 * POST /api/v1/setup/reset
 * Super-admin only: resets all wizard flags to false (for re-onboarding).
 */
export const resetWizard = async (req, res) => {
  try {
    const resetPayload = {
      'setupWizard.schoolProfile': false,
      'setupWizard.academicSession': false,
      'setupWizard.masterPeriods': false,
      'setupWizard.academicRules': false,
      'setupWizard.financePolicies': false,
      'setupWizard.completedAt': null,
      'setupWizard.dismissed': false,
    };

    if (checkFallback()) {
      const s = FallbackDb.getSettings() || {};
      s.setupWizard = {
        schoolProfile: false, academicSession: false, masterPeriods: false,
        academicRules: false, financePolicies: false, completedAt: null, dismissed: false,
      };
      FallbackDb.updateSettings(s);
    } else {
      await Setting.findOneAndUpdate({}, resetPayload, { upsert: true });
    }

    return res.json({ success: true, message: 'Setup wizard has been reset.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to reset wizard.' });
  }
};
