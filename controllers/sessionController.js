import AcademicSession from '../models/AcademicSession.js';
import { FallbackDb } from '../services/dbFallback.js';
import { checkFallback } from '../config/db.js';

// GET all academic sessions
export const getAcademicSessions = async (req, res) => {
  try {
    if (checkFallback()) {
      const sessions = FallbackDb.find('academicSessions') || [];
      return res.json({ success: true, sessions });
    }
    const sessions = await AcademicSession.find().sort({ startDate: -1 });
    return res.json({ success: true, sessions });
  } catch (err) {
    console.error('getAcademicSessions error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// CREATE new academic session
export const createAcademicSession = async (req, res) => {
  try {
    const { sessionName, startDate, endDate, isCurrent = false, notes = '' } = req.body;

    if (!sessionName || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Session name, start date, and end date are required',
      });
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
      return res.status(201).json({ success: true, session: newSession });
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

    return res.status(201).json({ success: true, session });
  } catch (err) {
    console.error('createAcademicSession error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ACTIVATE session
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
      return res.json({ success: true, message: 'Academic session activated' });
    }

    await AcademicSession.updateMany({}, { isCurrent: false });
    await AcademicSession.findByIdAndUpdate(id, { isCurrent: true, status: 'active' });

    return res.json({ success: true, message: 'Academic session activated' });
  } catch (err) {
    console.error('activateAcademicSession error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// UPDATE session
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
        return res.json({ success: true, session: all[idx] });
      }
      return res.status(404).json({ success: false, message: 'Session not found' });
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

    return res.json({ success: true, session });
  } catch (err) {
    console.error('updateAcademicSession error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// DELETE session
export const deleteAcademicSession = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      const all = (FallbackDb.find('academicSessions') || []).filter(
        (s) => String(s._id) !== String(id) && String(s.id) !== String(id)
      );
      FallbackDb.updateAll('academicSessions', all);
      return res.json({ success: true, message: 'Session deleted' });
    }

    await AcademicSession.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Session deleted' });
  } catch (err) {
    console.error('deleteAcademicSession error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET active session (fast single-record lookup for stepper banner & downstream controllers)
export const getActiveSession = async (req, res) => {
  try {
    if (checkFallback()) {
      const all = FallbackDb.find('academicSessions') || [];
      const active = all.find((s) => s.isCurrent) || all[0] || null;
      return res.json({ success: true, session: active });
    }
    const session = await AcademicSession.findOne({ isCurrent: true }).lean();
    return res.json({ success: true, session: session || null });
  } catch (err) {
    console.error('getActiveSession error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * Internal helper — NOT exposed as an HTTP route.
 * Called by masterPeriodController and classTimetableController after save/delete
 * to keep the denormalized hasMasterSchedule / timetableCount in sync.
 *
 * @param {string} sessionId  – Mongo ObjectId string or FallbackDb _id
 * @param {object} patch      – e.g. { hasMasterSchedule: true } or { timetableCount: 5 }
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
    // Non-critical — log but do not throw so the caller is not disrupted
    console.warn('updateSessionMetadata (non-fatal):', err.message);
  }
};
