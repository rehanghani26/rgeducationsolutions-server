// 3. Configuration
import { checkFallback } from '../config/db.js';

// 4. Models
import AcademicSession from '../models/AcademicSession.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError
} from '../utils/responseUtil.js';

/**
 * Retrieves all institutional academic sessions.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getAcademicSessions = async (req, res) => {
  try {
    if (checkFallback()) {
      const sessions = FallbackDb.find('academicSessions') || [];
      return sendSuccess(res, undefined, { sessions });
    }
    const sessions = await AcademicSession.find().sort({ startDate: -1 });
    return sendSuccess(res, undefined, { sessions });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Creates a new academic session.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const createAcademicSession = async (req, res) => {
  try {
    const { sessionName, startDate, endDate, isCurrent = false, notes = '' } = req.body;

    if (!sessionName || !startDate || !endDate) {
      return sendBadRequest(res, 'Session name, start date, and end date are required');
    }

    if (checkFallback()) {
      const all = FallbackDb.find('academicSessions') || [];
      if (isCurrent) {
        all.forEach((s) => (s.isCurrent = false));
      }
      const newSession = {
        _id: `sess-${Date.now()}`,
        sessionName: sessionName.trim(),
        startDate,
        endDate,
        isCurrent: Boolean(isCurrent),
        status: isCurrent ? 'active' : 'upcoming',
        notes,
        createdAt: new Date().toISOString(),
      };
      all.unshift(newSession);
      FallbackDb.updateAll('academicSessions', all);
      return sendCreated(res, undefined, { session: newSession });
    }

    if (isCurrent) {
      await AcademicSession.updateMany({}, { isCurrent: false });
    }

    const session = await AcademicSession.create({
      sessionName: sessionName.trim(),
      startDate,
      endDate,
      isCurrent: Boolean(isCurrent),
      status: isCurrent ? 'active' : 'upcoming',
      notes,
      createdBy: req.user?.name || 'admin',
    });

    return sendCreated(res, undefined, { session });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Activates an academic session and deactivates other active sessions.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const activateAcademicSession = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      const all = FallbackDb.find('academicSessions') || [];
      all.forEach((s) => {
        if (String(s._id) === String(id) || String(s.id) === String(id)) {
          s.isCurrent = true;
          s.status = 'active';
        } else {
          s.isCurrent = false;
        }
      });
      FallbackDb.updateAll('academicSessions', all);
      return sendSuccess(res, 'Academic session activated');
    }

    await AcademicSession.updateMany({}, { isCurrent: false });
    await AcademicSession.findByIdAndUpdate(id, { isCurrent: true, status: 'active' });

    return sendSuccess(res, 'Academic session activated');
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Updates an academic session's parameters.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const updateAcademicSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionName, startDate, endDate, status, notes } = req.body;

    if (checkFallback()) {
      const all = FallbackDb.find('academicSessions') || [];
      const idx = all.findIndex((s) => String(s._id) === String(id) || String(s.id) === String(id));
      if (idx !== -1) {
        if (sessionName) all[idx].sessionName = sessionName;
        if (startDate) all[idx].startDate = startDate;
        if (endDate) all[idx].endDate = endDate;
        if (status) all[idx].status = status;
        if (notes !== undefined) all[idx].notes = notes;
        FallbackDb.updateAll('academicSessions', all);
        return sendSuccess(res, undefined, { session: all[idx] });
      }
      return sendNotFound(res, 'Session not found');
    }

    const session = await AcademicSession.findByIdAndUpdate(
      id,
      {
        ...(sessionName && { sessionName }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
      },
      { new: true }
    );

    return sendSuccess(res, undefined, { session });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Deletes an academic session.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const deleteAcademicSession = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      const all = (FallbackDb.find('academicSessions') || []).filter(
        (s) => String(s._id) !== String(id) && String(s.id) !== String(id)
      );
      FallbackDb.updateAll('academicSessions', all);
      return sendSuccess(res, 'Session deleted');
    }

    await AcademicSession.findByIdAndDelete(id);
    return sendSuccess(res, 'Session deleted');
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves the currently active academic session.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getActiveSession = async (req, res) => {
  try {
    if (checkFallback()) {
      const all = FallbackDb.find('academicSessions') || [];
      const active = all.find((s) => s.isCurrent) || all[0] || null;
      return sendSuccess(res, undefined, { session: active });
    }
    const session = await AcademicSession.findOne({ isCurrent: true }).lean();
    return sendSuccess(res, undefined, { session: session || null });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Internal helper to update denormalized session metadata (e.g., timetable count).
 *
 * @param {string} sessionId - Mongo ObjectId string or FallbackDb _id.
 * @param {Object} patch - Fields to update.
 * @returns {Promise<void>}
 */
export const updateSessionMetadata = async (sessionId, patch) => {
  try {
    if (!sessionId) return;
    if (checkFallback()) {
      const all = FallbackDb.find('academicSessions') || [];
      const idx = all.findIndex(
        (s) => String(s._id) === String(sessionId) || String(s.id) === String(sessionId)
      );
      if (idx !== -1) {
        Object.assign(all[idx], patch);
        FallbackDb.updateAll('academicSessions', all);
      }
      return;
    }
    await AcademicSession.findByIdAndUpdate(sessionId, { $set: patch });
  } catch (err) {
    console.warn('updateSessionMetadata (non-fatal):', err.message);
  }
};
