import mongoose from 'mongoose';
import { checkFallback } from '../config/db.js';
import School from '../models/School.js';
import { FallbackDb } from '../services/dbFallback.js';
import {
  activeAcademicSession, isConfiguredSession, orderedGrades, readRolloverSettings,
  saveClassOrder, saveSessionConfiguration, sessionCollections, sessionGrades, writeRolloverSettings,
} from '../services/academicSessionService.js';
import { getSchool, readProcurement, writeProcurement } from '../services/procurementStore.js';
import { previewRollover, runRollover } from '../services/sessionRolloverService.js';
import { procurementError } from '../utils/procurementValues.js';
import { sendSuccess, sendCreated, sendError } from '../utils/responseUtil.js';
import tenantContext from '../utils/tenantContext.js';
import { academicCollections } from '../utils/academicScope.js';

const handle = (handler) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    return sendError(res, error.code === 11000 ? 'A matching academic record already exists.' : error.message,
      error.statusCode || (error.code === 11000 ? 409 : 500));
  }
};

export const getAcademicSessions = handle(async (req, res) => {
  const sessions = await readProcurement(req).find('academicSessions');
  sessions.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
  return sendSuccess(res, undefined, { sessions }, 200, { sessions });
});

export const getActiveSession = handle(async (req, res) => {
  const session = await activeAcademicSession(readProcurement(req));
  return sendSuccess(res, undefined, { session }, 200, { session });
});

export const getClassMaster = handle(async (req, res) => {
  const classes = await orderedGrades(readProcurement(req));
  return sendSuccess(res, undefined, { classes }, 200, { classes });
});

export const updateClassOrder = handle(async (req, res) =>
  sendSuccess(res, 'Class order saved.', { grade: await saveClassOrder(req) })
);

export const getSessionClasses = handle(async (req, res) => {
  const store = readProcurement(req);
  const session = await store.get('academicSessions', req.params.id);
  if (!session) throw procurementError('Academic session not found.', 404);
  const classes = await sessionGrades(store, session);
  return sendSuccess(res, undefined, { classes }, 200, { classes });
});

export async function academicSetupStatus(req) {
  const store = readProcurement(req);
  const session = await activeAcademicSession(store);
  const schoolId = getSchool(req);
  const onboarded = !checkFallback() && Boolean(await School.exists({ schoolId }));
  return { session, pending: !isConfiguredSession(session), onboarded };
}

export const getAcademicSetup = handle(async (req, res) => {
  const setup = await academicSetupStatus(req);
  const classes = await orderedGrades(readProcurement(req));
  return sendSuccess(res, undefined, { ...setup, classes });
});

export const confirmAcademicSetup = handle(async (req, res) => {
  const session = await saveSessionConfiguration(req, { id: req.body?.sessionId, confirm: true });
  return sendSuccess(res, 'Academic session and curriculum saved.', { session }, 200, { session });
});

export const createAcademicSession = handle(async (req, res) => {
  const session = await saveSessionConfiguration(req);
  return sendCreated(res, 'Academic session created successfully.', { session }, { session });
});

export const updateAcademicSession = handle(async (req, res) => {
  const session = await saveSessionConfiguration(req, { id: req.params.id });
  return sendSuccess(res, 'Academic session updated successfully.', { session }, 200, { session });
});

export const activateAcademicSession = handle(async (req, res) => {
  const session = await writeProcurement(req, sessionCollections, async (store) => {
    await store.lockAcademicSettings();
    const current = await activeAcademicSession(store);
    const selected = await store.get('academicSessions', req.params.id);
    if (!selected) throw procurementError('Academic session not found.', 404);
    if (selected.isCurrent) return selected;
    if (current) throw procurementError('Use the whole-school upgrade to switch the active session.', 409);
    if (!isConfiguredSession(selected) || selected.status !== 'upcoming') {
      throw procurementError('Only an upcoming session with a confirmed curriculum can be activated.', 409);
    }
    return store.update('academicSessions', req.params.id, { status: 'active', isCurrent: true });
  });
  return sendSuccess(res, 'Academic session activated.', { session }, 200, { session });
});

export const deleteAcademicSession = handle(async (req, res) => {
  const { id } = req.params;
  const schoolId = getSchool(req);
  await writeProcurement(req, sessionCollections, async (store) => {
    await store.lockAcademicSettings();
    const session = await store.get('academicSessions', id);
    if (!session) throw procurementError('Academic session not found.', 404);
    if (session.isCurrent || session.status === 'completed' || session.previousSessionId) {
      throw procurementError('Only an unlinked upcoming session can be deleted.', 409);
    }
    if (checkFallback()) {
      const collections = [
        ...Object.keys(academicCollections), 'students', 'studentSessionHistories',
        'budgetAllocations', 'inventoryPurchases', 'payrollDisbursements',
      ];
      if (collections.some((collection) => FallbackDb.find(collection).some((row) =>
        String(row.schoolId || 'IQRA_P01001') === schoolId && String(row.sessionId) === id))) {
        throw procurementError('This session has linked records.', 409);
      }
    } else {
      const reference = new mongoose.Types.ObjectId(id);
      for (const model of Object.values(mongoose.models)) {
        if (!model.schema.path('sessionId')) continue;
        if (await model.exists({ schoolId, sessionId: reference })) {
          throw procurementError('This session has linked records.', 409);
        }
      }
    }
    await store.remove('academicSessions', id);
  });
  return sendSuccess(res, 'Academic session deleted.');
});

export const getSchedule = handle(async (req, res) =>
  sendSuccess(res, undefined, await readRolloverSettings(req))
);

export const saveSchedule = handle(async (req, res) =>
  sendSuccess(res, 'Rollover settings saved.', await writeRolloverSettings(req))
);

export const getRolloverPreview = handle(async (req, res) =>
  sendSuccess(res, undefined, await previewRollover(req, req.params.id))
);

export const upgradeSchoolSession = handle(async (req, res) => {
  if (!req.body?.planVersion) throw procurementError('Preview the upgrade before confirming.');
  const execution = await runRollover(req, req.params.id, { planVersion: req.body.planVersion });
  return sendSuccess(res, execution.status === 'completed' ? 'Whole-school upgrade completed.' : 'Rollover approval recorded.', execution);
});

export async function updateSessionMetadata(sessionId, patch) {
  if (!sessionId) return null;
  const schoolId = tenantContext.getSchoolId();
  if (!schoolId) return null;
  try {
    return await readProcurement({ schoolId }).update('academicSessions', sessionId, patch);
  } catch (error) {
    console.warn('Could not update academic session metadata:', error.message);
    return null;
  }
}
