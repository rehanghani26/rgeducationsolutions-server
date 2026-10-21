import Setting from "../../models/Setting.js";
import AcademicSession from "../../models/AcademicSession.js";
import MasterPeriod from "../../models/MasterPeriod.js";
import { checkFallback } from "../../config/db.js";
import { FallbackDb } from "../../services/dbFallback.js";
import { logActivity } from "../../utils/activityLogger.js";

// ─── Shared helpers (same as setupController) ─────────────────────────────────

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

async function evaluateAcademicSession() {
  try {
    if (checkFallback()) {
      const sessions = FallbackDb.find("academicSessions") || [];
      const active = sessions.find((s) => s.isCurrent);
      return {
        complete: !!active,
        sessionCount: sessions.length,
        activeSession: active?.sessionName || null,
      };
    }
    const count = await AcademicSession.countDocuments();
    const active = await AcademicSession.findOne({ isCurrent: true }).lean();
    return {
      complete: !!active,
      sessionCount: count,
      activeSession: active?.sessionName || null,
    };
  } catch {
    return { complete: false, sessionCount: 0, activeSession: null };
  }
}

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

function evaluateAcademicRules(settings) {
  if (settings?.setupWizard?.academicRules) return { complete: true };
  const hasPassingPct =
    settings?.defaultPassingPercentage &&
    settings.defaultPassingPercentage !== 40;
  return { complete: !!hasPassingPct };
}

function evaluateFinancePolicies(settings) {
  if (settings?.setupWizard?.financePolicies) return { complete: true };
  const hasCustomCurrency =
    settings?.currencySymbol && settings.currencySymbol !== "$";
  return { complete: !!hasCustomCurrency };
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const setupToolDefinitions = [
  {
    name: "getSetupWizardStatus",
    description:
      "Get the complete setup wizard status — shows which of the 5 mandatory setup steps are complete, which are pending, what is missing, and the overall percentage. Use this to understand the current onboarding state before guiding the admin.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "runSetupStep1_SchoolProfile",
    description:
      "Execute Setup Step 1: Configure school profile and identity. Saves the school name, contact email, phone, address, city, state, country, and other institutional details. Requires all mandatory fields.",
    parameters: {
      type: "object",
      properties: {
        schoolName: {
          type: "string",
          description: "Full official school name (required).",
        },
        schoolShortName: {
          type: "string",
          description: 'Short abbreviation e.g. "RGES".',
        },
        contactEmail: {
          type: "string",
          description: "Primary official email (required).",
        },
        schoolPhone: {
          type: "string",
          description: "Main contact phone number (required).",
        },
        addressLine1: {
          type: "string",
          description: "Building/street address (required).",
        },
        addressLine2: {
          type: "string",
          description: "Area, landmark (optional).",
        },
        city: { type: "string", description: "City (required)." },
        state: { type: "string", description: "State or province (required)." },
        country: { type: "string", description: "Country (required)." },
        postalCode: { type: "string", description: "ZIP / PIN code." },
        schoolType: {
          type: "string",
          description: 'e.g. "primary", "secondary", "senior", "college".',
        },
        affiliationNumber: {
          type: "string",
          description: "Board affiliation number.",
        },
        registrationNumber: {
          type: "string",
          description: "Government registration number.",
        },
        principalName: {
          type: "string",
          description: "Name of the principal.",
        },
        schoolMotto: {
          type: "string",
          description: "School tagline or motto.",
        },
        websiteUrl: { type: "string", description: "Official website URL." },
        establishedYear: {
          type: "number",
          description: "Year school was established.",
        },
        currencySymbol: {
          type: "string",
          description: 'Currency symbol e.g. "₹", "$", "£".',
        },
        academicYear: {
          type: "string",
          description: 'Current academic year e.g. "2026-2027".',
        },
      },
      required: [
        "schoolName",
        "contactEmail",
        "schoolPhone",
        "addressLine1",
        "city",
        "state",
        "country",
      ],
    },
  },
  {
    name: "runSetupStep2_AcademicSession",
    description:
      "Execute Setup Step 2: Create and activate an academic session (the foundation calendar anchor). If a session already exists, you can activate it instead.",
    parameters: {
      type: "object",
      properties: {
        sessionName: {
          type: "string",
          description: 'Session name e.g. "2026-2027" (required).',
        },
        startDate: {
          type: "string",
          description: 'Start date YYYY-MM-DD e.g. "2026-04-01" (required).',
        },
        endDate: {
          type: "string",
          description: 'End date YYYY-MM-DD e.g. "2027-03-31" (required).',
        },
        notes: {
          type: "string",
          description: "Optional admin notes about this session.",
        },
      },
      required: ["sessionName", "startDate", "endDate"],
    },
  },
  {
    name: "runSetupStep3_MasterPeriods",
    description:
      "Execute Setup Step 3: Define the master daily bell schedule — school start time, end time, period duration, and breaks. This creates the core time-slot structure for all timetables.",
    parameters: {
      type: "object",
      properties: {
        scheduleName: {
          type: "string",
          description:
            'Name for this schedule e.g. "Standard Day Schedule" (required).',
        },
        startTime: {
          type: "string",
          description:
            'School start time in HH:MM 24h format e.g. "08:00" (required).',
        },
        endTime: {
          type: "string",
          description:
            'School end time in HH:MM 24h format e.g. "15:00" (required).',
        },
        periodDuration: {
          type: "number",
          description: "Default teaching period duration in minutes e.g. 45.",
        },
        breakDuration: {
          type: "number",
          description: "Short break duration in minutes e.g. 10.",
        },
        lunchDuration: {
          type: "number",
          description: "Lunch break duration in minutes e.g. 30.",
        },
        periodsPerDay: {
          type: "number",
          description: "Number of teaching periods per day e.g. 8.",
        },
        workingDays: {
          type: "array",
          description:
            'Working days e.g. ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].',
          items: { type: "string" },
        },
      },
      required: ["scheduleName", "startTime", "endTime"],
    },
  },
  {
    name: "runSetupStep4_AcademicRules",
    description:
      "Execute Setup Step 4: Configure academic rules and grading system — passing percentage, grade scale, grading type, and exam settings.",
    parameters: {
      type: "object",
      properties: {
        defaultPassingPercentage: {
          type: "number",
          description: "Minimum % to pass e.g. 33, 35, 40, 50.",
        },
        gradePointScale: {
          type: "number",
          description: "GPA scale e.g. 4.0 or 10.0.",
        },
        enableGradeDistribution: {
          type: "boolean",
          description: "Whether to show grade distribution in reports.",
        },
        attendanceRequirement: {
          type: "number",
          description: "Minimum attendance % to appear in exams e.g. 75.",
        },
        gradingSystem: {
          type: "string",
          description:
            'e.g. "marks" (percentage) or "grade" (letter grade) or "gpa".',
        },
      },
      required: ["defaultPassingPercentage"],
    },
  },
  {
    name: "runSetupStep5_FinancePolicies",
    description:
      "Execute Setup Step 5: Configure finance and fee policies — currency, late fees, payment modes, and auto-reminders.",
    parameters: {
      type: "object",
      properties: {
        currencySymbol: {
          type: "string",
          description:
            'Currency symbol e.g. "₹" for INR, "$" for USD (required).',
        },
        lateFeesPercentage: {
          type: "number",
          description: "Late fee penalty percentage e.g. 5 means 5% per month.",
        },
        enableInstallmentPayment: {
          type: "boolean",
          description: "Whether fee can be paid in installments.",
        },
        enableAutoReminder: {
          type: "boolean",
          description: "Auto-send fee due reminders to parents.",
        },
        reminderDaysBefore: {
          type: "number",
          description: "How many days before due date to send reminder.",
        },
        enableSmsAlerts: {
          type: "boolean",
          description: "Enable SMS notifications.",
        },
        enableEmailAlerts: {
          type: "boolean",
          description: "Enable Email notifications.",
        },
      },
      required: ["currencySymbol"],
    },
  },
  {
    name: "getSetupStepGuide",
    description:
      "Get a detailed guide for a specific setup step — what information is needed, what to ask the admin, and what fields to collect. Use this before running a step to know what data is needed.",
    parameters: {
      type: "object",
      properties: {
        stepNumber: {
          type: "number",
          description:
            "Step number 1-5. 1=School Profile, 2=Academic Session, 3=Master Periods, 4=Academic Rules, 5=Finance.",
        },
      },
      required: ["stepNumber"],
    },
  },
];

// ─── Tool Executors ───────────────────────────────────────────────────────────

export const setupToolExecutors = {
  async getSetupWizardStatus(args, context) {
    try {
      let settings;
      if (checkFallback()) {
        settings = FallbackDb.getSettings() || {};
      } else {
        settings = await Setting.findOne().lean();
        if (!settings) settings = {};
      }

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
          complete: profileEval.complete,
          detail: profileEval,
        },
        {
          key: "academicSession",
          stepNumber: 2,
          title: "Academic Session & Calendar",
          complete: sessionEval.complete,
          detail: sessionEval,
        },
        {
          key: "masterPeriods",
          stepNumber: 3,
          title: "Master Period & Bell Schedule",
          complete: periodsEval.complete,
          detail: periodsEval,
        },
        {
          key: "academicRules",
          stepNumber: 4,
          title: "Academic & Grading Rules",
          complete: academicEval.complete,
          detail: academicEval,
        },
        {
          key: "financePolicies",
          stepNumber: 5,
          title: "Finance & Fee Policies",
          complete: financeEval.complete,
          detail: financeEval,
        },
      ];

      const completedCount = steps.filter((s) => s.complete).length;
      const percentComplete = Math.round((completedCount / steps.length) * 100);

      return {
        success: true,
        percentComplete,
        completedCount,
        totalSteps: steps.length,
        isFullyComplete: completedCount === steps.length,
        isDismissed: settings?.setupWizard?.dismissed || false,
        steps,
        nextStep: steps.find((s) => !s.complete) || null,
        summary:
          completedCount === steps.length
            ? "✅ All 5 setup steps are complete. The ERP is fully configured!"
            : `⚠️ ${steps.length - completedCount} step(s) remaining. Next: "${steps.find((s) => !s.complete)?.title}"`,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async runSetupStep1_SchoolProfile(args, context) {
    const required = [
      "schoolName",
      "contactEmail",
      "schoolPhone",
      "addressLine1",
      "city",
      "state",
      "country",
    ];
    const missing = required.filter((f) => !args[f] || !String(args[f]).trim());
    if (missing.length > 0) {
      return {
        success: false,
        error: `Missing required fields: ${missing.join(", ")}. Please provide these to complete Step 1.`,
        missingFields: missing,
      };
    }

    const updateData = {};
    const allowedFields = [
      "schoolName",
      "schoolShortName",
      "contactEmail",
      "schoolPhone",
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "country",
      "postalCode",
      "schoolType",
      "affiliationNumber",
      "registrationNumber",
      "principalName",
      "schoolMotto",
      "websiteUrl",
      "establishedYear",
      "currencySymbol",
      "academicYear",
    ];
    for (const field of allowedFields) {
      if (
        args[field] !== undefined &&
        args[field] !== null &&
        String(args[field]).trim()
      ) {
        updateData[field] =
          typeof args[field] === "string" ? args[field].trim() : args[field];
      }
    }
    // Mark wizard step complete
    updateData["setupWizard.schoolProfile"] = true;

    try {
      if (checkFallback()) {
        const s = FallbackDb.getSettings() || {};
        Object.assign(s, updateData);
        FallbackDb.updateSettings(s);
      } else {
        await Setting.findOneAndUpdate({}, updateData, {
          upsert: true,
          new: true,
        });
      }

      await logActivity({
        userId: context.user?._id || context.user?.id,
        action: "UPDATE",
        module: "setup-wizard",
        details: `AI completed Setup Step 1 — School Profile for "${args.schoolName}"`,
        ipAddress: context.ip || "AI",
      });

      return {
        success: true,
        message: `✅ Step 1 complete! School profile saved for **${args.schoolName}**.`,
        savedFields: Object.keys(updateData).filter(
          (k) => !k.startsWith("setupWizard")
        ),
        nextStep:
          'Step 2 — Academic Session. I need: session name (e.g. "2026-2027"), start date, and end date.',
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async runSetupStep2_AcademicSession(args, context) {
    const { sessionName, startDate, endDate, notes } = args;
    if (!sessionName || !startDate || !endDate) {
      return {
        success: false,
        error:
          "sessionName, startDate (YYYY-MM-DD), and endDate (YYYY-MM-DD) are required.",
      };
    }

    try {
      const payload = {
        sessionName: sessionName.trim(),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isCurrent: true,
        notes:
          notes ||
          `Created via AI Setup Wizard on ${new Date().toLocaleDateString()}`,
      };

      if (checkFallback()) {
        // Deactivate existing
        const existing = FallbackDb.find("academicSessions") || [];
        for (const s of existing) {
          FallbackDb.update("academicSessions", s.id || s._id, {
            isCurrent: false,
          });
        }
        FallbackDb.create("academicSessions", payload);
      } else {
        // Deactivate all others first
        await AcademicSession.updateMany({}, { isCurrent: false });
        await AcademicSession.create(payload);
      }

      // Mark wizard flag
      if (checkFallback()) {
        const s = FallbackDb.getSettings() || {};
        if (!s.setupWizard) s.setupWizard = {};
        s.setupWizard.academicSession = true;
        FallbackDb.updateSettings(s);
      } else {
        await Setting.findOneAndUpdate(
          {},
          { "setupWizard.academicSession": true },
          { upsert: true }
        );
      }

      await logActivity({
        userId: context.user?._id || context.user?.id,
        action: "CREATE",
        module: "setup-wizard",
        details: `AI completed Setup Step 2 — Academic Session "${sessionName}" created and activated`,
        ipAddress: context.ip || "AI",
      });

      return {
        success: true,
        message: `✅ Step 2 complete! Academic session **${sessionName}** (${startDate} → ${endDate}) is now active.`,
        session: { sessionName, startDate, endDate, isCurrent: true },
        nextStep:
          "Step 3 — Master Period & Bell Schedule. I need: school start time, end time, period duration in minutes.",
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async runSetupStep3_MasterPeriods(args, context) {
    const {
      scheduleName,
      startTime,
      endTime,
      periodDuration = 45,
      breakDuration = 10,
      lunchDuration = 30,
      periodsPerDay = 8,
      workingDays,
    } = args;
    if (!scheduleName || !startTime || !endTime) {
      return {
        success: false,
        error:
          "scheduleName, startTime (HH:MM), and endTime (HH:MM) are required.",
      };
    }

    const defaultWorkingDays = workingDays || [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    // Build period slots from start time + durations
    const buildPeriodSlots = () => {
      const [sh, sm] = startTime.split(":").map(Number);
      const slots = [];
      let cursor = sh * 60 + sm;

      for (let i = 1; i <= periodsPerDay; i++) {
        const sH = String(Math.floor(cursor / 60)).padStart(2, "0");
        const sM = String(cursor % 60).padStart(2, "0");
        cursor += periodDuration;
        const eH = String(Math.floor(cursor / 60)).padStart(2, "0");
        const eM = String(cursor % 60).padStart(2, "0");

        slots.push({
          periodNumber: i,
          label: `Period ${i}`,
          startTime: `${sH}:${sM}`,
          endTime: `${eH}:${eM}`,
          type: "teaching",
          duration: periodDuration,
        });

        // Add breaks
        if (i === Math.floor(periodsPerDay / 2)) {
          // Lunch break in the middle
          cursor += lunchDuration;
        } else if (i < periodsPerDay) {
          // Short break between periods
          cursor += breakDuration;
        }
      }
      return slots;
    };

    const periodSlots = buildPeriodSlots();

    const payload = {
      scheduleName: scheduleName.trim(),
      startTime,
      endTime,
      periodDuration,
      breakDuration,
      lunchDuration,
      periodsPerDay,
      workingDays: defaultWorkingDays,
      periods: periodSlots,
      isActive: true,
      isDefault: true,
    };

    try {
      if (checkFallback()) {
        const existing = FallbackDb.find("masterPeriods") || [];
        if (existing.length > 0) {
          FallbackDb.update(
            "masterPeriods",
            existing[0].id || existing[0]._id,
            payload
          );
        } else {
          FallbackDb.create("masterPeriods", payload);
        }
      } else {
        await MasterPeriod.findOneAndUpdate({ isDefault: true }, payload, {
          upsert: true,
          new: true,
        });
      }

      // Mark wizard flag
      if (checkFallback()) {
        const s = FallbackDb.getSettings() || {};
        if (!s.setupWizard) s.setupWizard = {};
        s.setupWizard.masterPeriods = true;
        FallbackDb.updateSettings(s);
      } else {
        await Setting.findOneAndUpdate(
          {},
          { "setupWizard.masterPeriods": true },
          { upsert: true }
        );
      }

      await logActivity({
        userId: context.user?._id || context.user?.id,
        action: "CREATE",
        module: "setup-wizard",
        details: `AI completed Setup Step 3 — Master Period schedule "${scheduleName}" created with ${periodsPerDay} periods`,
        ipAddress: context.ip || "AI",
      });

      return {
        success: true,
        message: `✅ Step 3 complete! Bell schedule **${scheduleName}** created — ${periodsPerDay} periods from ${startTime} to ${endTime}.`,
        schedule: {
          scheduleName,
          startTime,
          endTime,
          periodsPerDay,
          periodDuration,
          workingDays: defaultWorkingDays,
        },
        samplePeriods: periodSlots.slice(0, 3),
        nextStep:
          "Step 4 — Academic & Grading Rules. I need: minimum passing percentage (e.g. 33, 40, 50).",
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async runSetupStep4_AcademicRules(args, context) {
    const {
      defaultPassingPercentage,
      gradePointScale,
      enableGradeDistribution,
      attendanceRequirement,
      gradingSystem,
    } = args;

    if (
      defaultPassingPercentage === undefined ||
      defaultPassingPercentage === null
    ) {
      return {
        success: false,
        error: "defaultPassingPercentage is required (e.g. 33, 35, 40, 50).",
      };
    }

    const updateData = {
      defaultPassingPercentage: Number(defaultPassingPercentage),
      "setupWizard.academicRules": true,
    };
    if (gradePointScale !== undefined)
      updateData.gradePointScale = Number(gradePointScale);
    if (enableGradeDistribution !== undefined)
      updateData.enableGradeDistribution = enableGradeDistribution;
    if (attendanceRequirement !== undefined)
      updateData.attendanceRequirement = Number(attendanceRequirement);

    try {
      if (checkFallback()) {
        const s = FallbackDb.getSettings() || {};
        Object.assign(s, {
          defaultPassingPercentage: Number(defaultPassingPercentage),
          gradePointScale: gradePointScale || s.gradePointScale,
          setupWizard: { ...(s.setupWizard || {}), academicRules: true },
        });
        FallbackDb.updateSettings(s);
      } else {
        await Setting.findOneAndUpdate({}, updateData, {
          upsert: true,
          new: true,
        });
      }

      await logActivity({
        userId: context.user?._id || context.user?.id,
        action: "UPDATE",
        module: "setup-wizard",
        details: `AI completed Setup Step 4 — Academic Rules: ${defaultPassingPercentage}% passing mark`,
        ipAddress: context.ip || "AI",
      });

      return {
        success: true,
        message: `✅ Step 4 complete! Academic rules saved — passing mark: **${defaultPassingPercentage}%**.`,
        rules: {
          defaultPassingPercentage,
          gradePointScale,
          attendanceRequirement,
        },
        nextStep:
          "Step 5 — Finance & Fee Policies. I need: currency symbol (e.g. ₹ for INR, $ for USD).",
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async runSetupStep5_FinancePolicies(args, context) {
    const {
      currencySymbol,
      lateFeesPercentage,
      enableInstallmentPayment,
      enableAutoReminder,
      reminderDaysBefore,
      enableSmsAlerts,
      enableEmailAlerts,
    } = args;

    if (!currencySymbol) {
      return {
        success: false,
        error: 'currencySymbol is required (e.g. "₹", "$", "£").',
      };
    }

    const updateData = {
      currencySymbol: currencySymbol.trim(),
      "setupWizard.financePolicies": true,
    };
    if (lateFeesPercentage !== undefined)
      updateData.lateFeesPercentage = Number(lateFeesPercentage);
    if (enableInstallmentPayment !== undefined)
      updateData.enableInstallmentPayment = enableInstallmentPayment;
    if (enableAutoReminder !== undefined)
      updateData.enableAutoReminder = enableAutoReminder;
    if (reminderDaysBefore !== undefined)
      updateData.reminderDaysBefore = Number(reminderDaysBefore);
    if (enableSmsAlerts !== undefined)
      updateData.enableSmsAlerts = enableSmsAlerts;
    if (enableEmailAlerts !== undefined)
      updateData.enableEmailAlerts = enableEmailAlerts;

    try {
      if (checkFallback()) {
        const s = FallbackDb.getSettings() || {};
        Object.assign(s, {
          currencySymbol: currencySymbol.trim(),
          lateFeesPercentage: lateFeesPercentage || s.lateFeesPercentage,
          setupWizard: { ...(s.setupWizard || {}), financePolicies: true },
        });
        FallbackDb.updateSettings(s);
      } else {
        await Setting.findOneAndUpdate({}, updateData, {
          upsert: true,
          new: true,
        });
      }

      await logActivity({
        userId: context.user?._id || context.user?.id,
        action: "UPDATE",
        module: "setup-wizard",
        details: `AI completed Setup Step 5 — Finance Policies: currency ${currencySymbol}`,
        ipAddress: context.ip || "AI",
      });

      // Check if all steps are now complete
      const settings = checkFallback()
        ? FallbackDb.getSettings()
        : await Setting.findOne().lean();
      const sw = settings?.setupWizard || {};
      const allComplete =
        sw.schoolProfile &&
        sw.academicSession &&
        sw.masterPeriods &&
        sw.academicRules &&
        sw.financePolicies;

      if (allComplete && !settings?.setupWizard?.completedAt) {
        if (checkFallback()) {
          const s = FallbackDb.getSettings() || {};
          if (!s.setupWizard) s.setupWizard = {};
          s.setupWizard.completedAt = new Date().toISOString();
          FallbackDb.updateSettings(s);
        } else {
          await Setting.findOneAndUpdate(
            {},
            { "setupWizard.completedAt": new Date() },
            { upsert: true }
          );
        }
      }

      return {
        success: true,
        message: `✅ Step 5 complete! Finance policies saved — currency: **${currencySymbol}**.`,
        financeConfig: {
          currencySymbol,
          lateFeesPercentage,
          enableAutoReminder,
        },
        wizardComplete: allComplete,
        finalMessage: allComplete
          ? "🎉 **Setup Complete!** All 5 steps are done. Your ERP is ready for admissions, staff onboarding, and operations!"
          : "Finance policies saved. Check setup status for remaining steps.",
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async getSetupStepGuide(args, context) {
    const { stepNumber } = args;

    const guides = {
      1: {
        stepNumber: 1,
        title: "School Profile & Identity",
        purpose:
          "This is the foundation of your ERP. Your school name, logo, and contact info appear on every report, receipt, certificate, and the public portal.",
        requiredFields: [
          {
            field: "schoolName",
            label: "School Name",
            example: "Delhi Public School",
          },
          {
            field: "contactEmail",
            label: "Official Email",
            example: "admin@dps.edu.in",
          },
          {
            field: "schoolPhone",
            label: "Phone Number",
            example: "+91 98765 43210",
          },
          {
            field: "addressLine1",
            label: "Street Address",
            example: "12 Knowledge Park Road",
          },
          { field: "city", label: "City", example: "New Delhi" },
          { field: "state", label: "State", example: "Delhi" },
          { field: "country", label: "Country", example: "India" },
        ],
        optionalFields: [
          "schoolShortName",
          "postalCode",
          "schoolType",
          "affiliationNumber",
          "principalName",
          "schoolMotto",
          "currencySymbol",
        ],
        questionsToAsk: [
          "What is the full official name of your school?",
          "What is the official contact email address?",
          "What is the school phone number?",
          "What is the complete address?",
        ],
      },
      2: {
        stepNumber: 2,
        title: "Academic Session & Calendar",
        purpose:
          "Every student admission, fee collection, attendance record, exam, and timetable is anchored to the active session. You must create one before adding any students.",
        requiredFields: [
          { field: "sessionName", label: "Session Name", example: "2026-2027" },
          { field: "startDate", label: "Start Date", example: "2026-04-01" },
          { field: "endDate", label: "End Date", example: "2027-03-31" },
        ],
        questionsToAsk: [
          "What academic year are you starting? (e.g. 2026-2027)",
          "When does the academic year start? (date)",
          "When does it end? (date)",
        ],
      },
      3: {
        stepNumber: 3,
        title: "Master Period & Bell Schedule",
        purpose:
          "Defines the daily structure — when school starts and ends, how long each class period is, and when breaks happen. This is used by the timetable builder and attendance system.",
        requiredFields: [
          {
            field: "scheduleName",
            label: "Schedule Name",
            example: "Standard School Day",
          },
          { field: "startTime", label: "School Start Time", example: "08:00" },
          { field: "endTime", label: "School End Time", example: "15:00" },
        ],
        optionalFields: [
          "periodDuration (default 45 min)",
          "periodsPerDay (default 8)",
          "breakDuration (default 10 min)",
          "lunchDuration (default 30 min)",
        ],
        questionsToAsk: [
          "What time does school start? (e.g. 8:00 AM)",
          "What time does school end? (e.g. 3:00 PM)",
          "How long is each class period? (e.g. 45 minutes)",
          "How many periods per day? (e.g. 8)",
        ],
      },
      4: {
        stepNumber: 4,
        title: "Academic & Grading Rules",
        purpose:
          "Determines how students are evaluated — what is the passing threshold, how grades are assigned, and what attendance is required.",
        requiredFields: [
          {
            field: "defaultPassingPercentage",
            label: "Passing Percentage",
            example: "35 or 40 or 50",
          },
        ],
        optionalFields: [
          "gradePointScale (4.0 or 10.0)",
          "attendanceRequirement (e.g. 75%)",
          "enableGradeDistribution",
        ],
        questionsToAsk: [
          "What is the minimum passing percentage for students? (e.g. 33%, 35%, 40%, 50%)",
          "Do you use a 4.0 GPA scale or 10.0?",
          "What is the minimum attendance required to sit in exams?",
        ],
      },
      5: {
        stepNumber: 5,
        title: "Finance & Fee Policies",
        purpose:
          "All fee receipts, invoices, and financial reports use the currency and policies set here. Must be configured before collecting any fee.",
        requiredFields: [
          {
            field: "currencySymbol",
            label: "Currency Symbol",
            example: "₹ (INR) or $ (USD) or £ (GBP)",
          },
        ],
        optionalFields: [
          "lateFeesPercentage",
          "enableInstallmentPayment",
          "enableAutoReminder",
          "reminderDaysBefore",
        ],
        questionsToAsk: [
          "What currency do you use? (e.g. Indian Rupee ₹, US Dollar $)",
          "Is there a late fee penalty? What percentage?",
          "Do you want to send automatic fee reminders to parents?",
        ],
      },
    };

    const guide = guides[stepNumber];
    if (!guide) {
      return { success: false, error: "Invalid step number. Must be 1-5." };
    }

    return { success: true, ...guide };
  },
};
