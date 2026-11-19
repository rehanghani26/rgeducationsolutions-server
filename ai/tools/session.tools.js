import * as sessions from '../../controllers/sessionController.js';
import { readProcurement } from '../../services/procurementStore.js';
import AcademicSession from "../../models/AcademicSession.js";
import MasterPeriod from "../../models/MasterPeriod.js";
import ClassTimetable from "../../models/ClassTimetable.js";
import { checkFallback } from "../../config/db.js";
import { FallbackDb } from "../../services/dbFallback.js";
import { logActivity } from "../../utils/activityLogger.js";

export const sessionToolDefinitions = [
  {
    name: "getActiveAcademicSession",
    description:
      "Get the currently active Academic Session (the foundation anchor of the school) including its date boundaries, active status, notes, and downstream setup linkage (master schedule & timetable count).",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "listAcademicSessions",
    description:
      "List all academic sessions in the school ERP with their start date, end date, status (active, upcoming, completed), and whether it is current.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            'Filter by status: "active", "upcoming", "completed", or leave blank for all.',
        },
      },
    },
  },
  {
    name: "createAcademicSession",
    description:
      "Create a new academic session in the school ERP. Sets the official calendar dates and foundation anchor.",
    parameters: {
      type: "object",
      properties: {
        sessionName: {
          type: "string",
          description:
            'Session label, e.g. "2026-2027", "2025-2026" (required).',
        },
        startDate: {
          type: "string",
          description:
            'Start date in YYYY-MM-DD format, e.g. "2026-04-01" (required).',
        },
        endDate: {
          type: "string",
          description:
            'End date in YYYY-MM-DD format, e.g. "2027-03-31" (required).',
        },
        isCurrent: {
          type: "boolean",
          description:
            "Whether to make this the active current session immediately (default: false).",
        },
        notes: {
          type: "string",
          description:
            "Optional administrative notes or affiliation description.",
        },
      },
      required: ["sessionName", "startDate", "endDate"],
    },
  },
  {
    name: "activateAcademicSession",
    description:
      "Activate an academic session to become the active foundation anchor for the school. Only one session can be active at a time. All other sessions will be deactivated.",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description:
            "ID of the session to activate (or specify sessionName).",
        },
        sessionName: {
          type: "string",
          description: 'Session name e.g. "2026-2027" if ID is not known.',
        },
      },
    },
  },
  {
    name: "updateAcademicSession",
    description:
      "Update academic session details such as session name, start date, end date, status, or administrative notes.",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description:
            "Unique session ID or session name to update (required).",
        },
        sessionName: {
          type: "string",
          description: 'New session name, e.g. "2026-2027".',
        },
        startDate: {
          type: "string",
          description: "New start date YYYY-MM-DD.",
        },
        endDate: {
          type: "string",
          description: "New end date YYYY-MM-DD.",
        },
        status: {
          type: "string",
          description: 'Session status: "upcoming", "active", "completed".',
        },
        notes: {
          type: "string",
          description: "Administrative notes.",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "deleteAcademicSession",
    description:
      "Delete an academic session record. Active sessions cannot be deleted without switching or confirmation.",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID or session name to delete (required).",
        },
        confirm: {
          type: "boolean",
          description:
            "Confirmation flag. Must be true to proceed with deletion.",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "getAcademicSetupProgress",
    description:
      "Get the 3-step Academic Setup progress status: Step 1 (Academic Session Anchor) -> Step 2 (Master Bell Period Schedule) -> Step 3 (Class Timetable Builder). Returns what is completed, what is pending, and next steps.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

const formatDate = (val) => {
  if (!val) return "N/A";
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? String(val) : d.toISOString().split("T")[0];
  } catch {
    return String(val);
  }
};


async function sessionTool(handler, args, context) {
  const role = String(context.user?.role || '').toLowerCase().replaceAll('_', '-');
  if (!['super-admin', 'superadmin', 'school-admin', 'principal', 'admin'].includes(role)) {
    return { success: false, error: 'School administrator permission is required.' };
  }
  let id = args.sessionId;
  if (!id && args.sessionName && handler !== sessions.createAcademicSession) {
    const match = (await readProcurement(context).find('academicSessions')).find((session) =>
      String(session.sessionName).toLowerCase() === String(args.sessionName).toLowerCase());
    id = match?._id || match?.id;
  }
  const req = { ...context, body: args, params: { id: id ? String(id) : '' } };
  const res = {
    status() { return this; },
    json(result) { return result.success ? result : { ...result, error: result.message }; },
  };
  return handler(req, res);
}

export const sessionToolExecutors = {
  async getActiveAcademicSession(args, context) {
    let session = null;

    if (checkFallback()) {
      const all = FallbackDb.find("academicSessions") || [];
      session = all.find((s) => s.isCurrent) || all[0] || null;
    } else {
      session = await AcademicSession.findOne({ isCurrent: true }).lean();
      if (!session) {
        session = await AcademicSession.findOne()
          .sort({ startDate: -1 })
          .lean();
      }
    }

    if (!session) {
      return {
        success: true,
        hasActiveSession: false,
        message:
          "No academic session found in the system. Step 1 (Academic Session) needs to be configured.",
        recommendation:
          "Use createAcademicSession to set up the foundation anchor (e.g. 2026-2027 from 2026-04-01 to 2027-03-31).",
      };
    }

    const start = new Date(session.startDate);
    const end = new Date(session.endDate);
    const now = new Date();
    const totalDays = Math.max(
      1,
      Math.round((end - start) / (1000 * 60 * 60 * 24))
    );
    const elapsedDays = Math.max(
      0,
      Math.min(totalDays, Math.round((now - start) / (1000 * 60 * 60 * 24)))
    );
    const progressPercent = Math.round((elapsedDays / totalDays) * 100);

    return {
      success: true,
      hasActiveSession: true,
      session: {
        id: session._id || session.id,
        sessionName: session.sessionName,
        startDate: formatDate(session.startDate),
        endDate: formatDate(session.endDate),
        isCurrent: Boolean(session.isCurrent),
        status: session.status || (session.isCurrent ? "active" : "upcoming"),
        notes: session.notes || "",
        daysTotal: totalDays,
        daysElapsed: elapsedDays,
        calendarProgress: `${progressPercent}%`,
        hasMasterSchedule: Boolean(session.hasMasterSchedule),
        timetableCount: Number(session.timetableCount || 0),
      },
    };
  },

  async listAcademicSessions(args, context) {
    let sessions = [];

    if (checkFallback()) {
      sessions = FallbackDb.find("academicSessions") || [];
    } else {
      sessions = await AcademicSession.find().sort({ startDate: -1 }).lean();
    }

    if (args.status) {
      const targetStatus = args.status.toLowerCase().trim();
      sessions = sessions.filter(
        (s) => (s.status || "").toLowerCase() === targetStatus
      );
    }

    return {
      success: true,
      count: sessions.length,
      sessions: sessions.map((s) => ({
        id: s._id || s.id,
        sessionName: s.sessionName,
        startDate: formatDate(s.startDate),
        endDate: formatDate(s.endDate),
        isCurrent: Boolean(s.isCurrent),
        status: s.status || (s.isCurrent ? "active" : "upcoming"),
        notes: s.notes || "",
        hasMasterSchedule: Boolean(s.hasMasterSchedule),
        timetableCount: Number(s.timetableCount || 0),
      })),
    };
  },

  async createAcademicSession(args, context) {
    return sessionTool(sessions.createAcademicSession, args, context);
  },

  async activateAcademicSession(args, context) {
    return sessionTool(sessions.activateAcademicSession, args, context);
  },

  async updateAcademicSession(args, context) {
    if (!args.sessionId) return { success: false, error: 'Choose a session to update.' };
    return sessionTool(sessions.updateAcademicSession, args, context);
  },

  async deleteAcademicSession(args, context) {
    if (!args.confirm) return { success: false, error: 'Confirm the session deletion first.' };
    return sessionTool(sessions.deleteAcademicSession, args, context);
  },

  async getAcademicSetupProgress(args, context) {
    let activeSession = null;
    let masterPeriodsCount = 0;
    let classTimetablesCount = 0;

    if (checkFallback()) {
      const allSessions = FallbackDb.find("academicSessions") || [];
      activeSession =
        allSessions.find((s) => s.isCurrent) || allSessions[0] || null;

      const master = FallbackDb.find("masterPeriods") || [];
      masterPeriodsCount = master.length;

      const timetables = FallbackDb.find("classTimetables") || [];
      classTimetablesCount = timetables.length;
    } else {
      activeSession = await AcademicSession.findOne({ isCurrent: true }).lean();
      if (!activeSession) {
        activeSession = await AcademicSession.findOne()
          .sort({ startDate: -1 })
          .lean();
      }

      masterPeriodsCount = await MasterPeriod.countDocuments({
        isActive: true,
      });
      if (masterPeriodsCount === 0) {
        masterPeriodsCount = await MasterPeriod.countDocuments({});
      }

      classTimetablesCount = await ClassTimetable.countDocuments({});
    }

    const step1Done = Boolean(activeSession);
    const step2Done = Boolean(
      activeSession?.hasMasterSchedule || masterPeriodsCount > 0
    );
    const step3Done = Boolean(
      (activeSession?.timetableCount || 0) > 0 || classTimetablesCount > 0
    );

    const steps = [
      {
        step: 1,
        title: "Academic Session & Calendar",
        status: step1Done ? "COMPLETED" : "PENDING",
        details: step1Done
          ? `Active Session: "${activeSession.sessionName}" (${formatDate(activeSession.startDate)} to ${formatDate(activeSession.endDate)})`
          : "No active session configured. Foundation anchor missing.",
        actionUrl: "/settings/session",
      },
      {
        step: 2,
        title: "Master Period & Bell Schedule",
        status: step2Done ? "COMPLETED" : "PENDING",
        details: step2Done
          ? `Bell schedule configured (${masterPeriodsCount} master period set(s) registered).`
          : step1Done
            ? "Pending configuration. Requires establishing daily periods, prayer, and lunch breaks."
            : "Blocked — Requires Step 1 (Academic Session) first.",
        actionUrl: "/settings/master-period",
      },
      {
        step: 3,
        title: "Class Timetable Builder",
        status: step3Done ? "COMPLETED" : "PENDING",
        details: step3Done
          ? `Timetables active (${Math.max(activeSession?.timetableCount || 0, classTimetablesCount)} class schedule(s) built).`
          : step2Done
            ? "Pending class-level slot allocation."
            : "Blocked — Requires Step 2 (Master Bell Schedule) first.",
        actionUrl: "/settings/class-timetable",
      },
    ];

    const completedCount = [step1Done, step2Done, step3Done].filter(
      Boolean
    ).length;
    const completionPercentage = Math.round((completedCount / 3) * 100);

    let nextStepMessage = "";
    if (!step1Done) {
      nextStepMessage =
        "Step 1 is needed: Create or activate an academic session.";
    } else if (!step2Done) {
      nextStepMessage =
        "Step 1 is ready! Proceed to Step 2: Configure Master Period bell schedule at /settings/master-period.";
    } else if (!step3Done) {
      nextStepMessage =
        "Steps 1 & 2 are ready! Proceed to Step 3: Map class timetables at /settings/class-timetable.";
    } else {
      nextStepMessage =
        "All 3 steps are complete! Academic scheduling foundation is fully operational.";
    }

    return {
      success: true,
      setupProgress: {
        completedCount,
        totalSteps: 3,
        completionPercentage: `${completionPercentage}%`,
        activeSession: activeSession
          ? {
              id: activeSession._id || activeSession.id,
              name: activeSession.sessionName,
              dates: `${formatDate(activeSession.startDate)} - ${formatDate(activeSession.endDate)}`,
            }
          : null,
        nextRecommendation: nextStepMessage,
        steps,
      },
    };
  },
};
