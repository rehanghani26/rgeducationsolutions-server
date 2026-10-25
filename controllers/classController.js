import mongoose from 'mongoose';
import ClassRoom from '../models/ClassRoom.js';
import ClassTeacherHistory from '../models/ClassTeacherHistory.js';
import StudentSessionHistory from '../models/StudentSessionHistory.js';
import ClassTimetable from '../models/ClassTimetable.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import AcademicSession from '../models/AcademicSession.js';
import { checkFallback } from '../config/db.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safely cast to ObjectId — returns null on invalid input */
const toObjectId = (val) => {
  if (!val) return null;
  if (mongoose.Types.ObjectId.isValid(val)) return new mongoose.Types.ObjectId(String(val));
  return null;
};

/** Class code → display name mapping (kept in sync with studentController) */
const CLASS_MAP = {
  'cls-nur': 'Nursery', 'cls-lkg': 'LKG', 'cls-ukg': 'UKG',
  'cls-1': 'Class 1',  'cls-2': 'Class 2',  'cls-3': 'Class 3',
  'cls-4': 'Class 4',  'cls-5': 'Class 5',  'cls-6': 'Class 6',
  'cls-7': 'Class 7',  'cls-8': 'Class 8',  'cls-9': 'Class 9',
  'cls-10': 'Class 10','cls-11': 'Class 11','cls-12': 'Class 12',
};

const SECTION_MAP = {
  'sec-a': 'Section A', 'sec-b': 'Section B', 'sec-c': 'Section C',
  'sec-d': 'Section D', 'sec-e': 'Section E', 'sec-f': 'Section F',
  'sec-g': 'Section G',
};

/** Derive className from classId, falling back to raw value */
const toClassName  = (id) => CLASS_MAP[id]   || id || '';
/** Derive sectionName from sectionId, falling back to raw value */
const toSectionName = (id) => SECTION_MAP[id] || id || '';

// =============================================================================
// 1. CLASSROOM CRUD
// =============================================================================

/**
 * GET /api/v1/classes
 * Query params: sessionId, classId, sectionId, status, page, limit
 */
export const getClassRooms = async (req, res) => {
  try {
    const { sessionId, classId, sectionId, status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (sessionId)  filter.sessionId  = toObjectId(sessionId) || sessionId;
    if (classId)    filter.classId    = classId;
    if (sectionId)  filter.sectionId  = sectionId;
    if (status)     filter.status     = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [classRooms, total] = await Promise.all([
      ClassRoom.find(filter)
        .populate('classTeacherId', 'name employeeId email phone designation')
        .populate('sessionId', 'sessionName startDate endDate isCurrent')
        .sort({ className: 1, sectionName: 1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      ClassRoom.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      classRooms,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error('getClassRooms error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * GET /api/v1/classes/session/:sessionId
 * All classrooms for a given session
 */
export const getClassRoomsBySession = async (req, res) => {
  try {
    const sessionObjId = toObjectId(req.params.sessionId);
    if (!sessionObjId) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const classRooms = await ClassRoom.find({ sessionId: sessionObjId })
      .populate('classTeacherId', 'name employeeId email phone')
      .sort({ className: 1, sectionName: 1 })
      .lean();

    const session = await AcademicSession.findById(sessionObjId).lean();

    return res.json({ success: true, session, classRooms, total: classRooms.length });
  } catch (err) {
    console.error('getClassRoomsBySession error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * GET /api/v1/classes/:id
 * Full detail: teacher, students count, timetable ref
 */
export const getClassRoomById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!toObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid classroom ID' });
    }

    const classRoom = await ClassRoom.findById(id)
      .populate('classTeacherId', 'name employeeId email phone photo designation')
      .populate('sessionId', 'sessionName startDate endDate isCurrent status')
      .populate('timetableId')
      .lean();

    if (!classRoom) {
      return res.status(404).json({ success: false, message: 'Classroom not found' });
    }

    return res.json({ success: true, classRoom });
  } catch (err) {
    console.error('getClassRoomById error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * POST /api/v1/classes
 * Create a session-scoped classroom
 * Body: { sessionId, classId, sectionId, room?, capacity? }
 */
export const createClassRoom = async (req, res) => {
  try {
    const { sessionId, classId, sectionId, room, capacity } = req.body;

    if (!sessionId || !classId || !sectionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId, classId and sectionId are required',
      });
    }

    const sessionObjId = toObjectId(sessionId);
    if (!sessionObjId) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    // Verify session exists
    const session = await AcademicSession.findById(sessionObjId).lean();
    if (!session) {
      return res.status(404).json({ success: false, message: 'Academic session not found' });
    }

    const className   = toClassName(classId);
    const sectionName = toSectionName(sectionId);
    const sec         = sectionName.replace(/^Section\s*/i, '');
    const displayName = `${className} – ${sec} (${session.sessionName})`;

    const classRoom = await ClassRoom.create({
      sessionId:   sessionObjId,
      sessionName: session.sessionName,
      classId,
      className,
      sectionId,
      sectionName,
      displayName,
      room:     room     || '',
      capacity: capacity || 40,
      createdBy: req.user?.name || 'admin',
    });

    return res.status(201).json({ success: true, classRoom });
  } catch (err) {
    console.error('createClassRoom error:', err);
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A classroom for this class and section already exists in this session',
      });
    }
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * PUT /api/v1/classes/:id
 * Update room, capacity, status
 */
export const updateClassRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const { room, capacity, status } = req.body;
    const patch = {};
    if (room     !== undefined) patch.room     = room;
    if (capacity !== undefined) patch.capacity = Number(capacity);
    if (status   !== undefined) patch.status   = status;

    const classRoom = await ClassRoom.findByIdAndUpdate(id, patch, { new: true })
      .populate('classTeacherId', 'name employeeId');

    if (!classRoom) {
      return res.status(404).json({ success: false, message: 'Classroom not found' });
    }

    return res.json({ success: true, classRoom });
  } catch (err) {
    console.error('updateClassRoom error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * DELETE /api/v1/classes/:id
 * Soft-delete: set status to 'archived'
 */
export const deleteClassRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const classRoom = await ClassRoom.findByIdAndUpdate(
      id,
      { status: 'archived' },
      { new: true }
    );
    if (!classRoom) {
      return res.status(404).json({ success: false, message: 'Classroom not found' });
    }
    return res.json({ success: true, message: 'Classroom archived successfully', classRoom });
  } catch (err) {
    console.error('deleteClassRoom error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// =============================================================================
// 2. CLASS TEACHER ASSIGNMENT
// =============================================================================

/**
 * PATCH /api/v1/classes/:id/assign-teacher
 * Assign a teacher as class teacher for this classroom.
 * Records history. Updates Teacher.currentClassRoomId.
 * Body: { teacherId, notes? }
 */
export const assignClassTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { teacherId, notes } = req.body;

    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'teacherId is required' });
    }

    const [classRoom, teacher] = await Promise.all([
      ClassRoom.findById(id),
      Teacher.findById(teacherId),
    ]);

    if (!classRoom) return res.status(404).json({ success: false, message: 'Classroom not found' });
    if (!teacher)   return res.status(404).json({ success: false, message: 'Teacher not found' });

    const actorName = req.user?.name || 'admin';

    // ── Close any active history record for this classroom ──────────────────
    await ClassTeacherHistory.updateMany(
      { classRoomId: classRoom._id, isCurrent: true },
      { isCurrent: false, removedAt: new Date(), removedBy: actorName }
    );

    // ── If the teacher was class teacher elsewhere, close that too ──────────
    if (teacher.currentClassRoomId && !teacher.currentClassRoomId.equals(classRoom._id)) {
      await ClassTeacherHistory.updateMany(
        { teacherId: teacher._id, isCurrent: true },
        { isCurrent: false, removedAt: new Date(), removedBy: actorName }
      );
      // Update old ClassRoom to remove this teacher
      await ClassRoom.findByIdAndUpdate(teacher.currentClassRoomId, {
        classTeacherId: null,
        classTeacherName: '',
      });
    }

    // ── Create new history record ────────────────────────────────────────────
    await ClassTeacherHistory.create({
      teacherId:         teacher._id,
      teacherName:       teacher.name || `${teacher.firstName} ${teacher.lastName}`.trim(),
      teacherEmployeeId: teacher.employeeId,
      classRoomId:       classRoom._id,
      sessionId:         classRoom.sessionId,
      sessionName:       classRoom.sessionName,
      classId:           classRoom.classId,
      className:         classRoom.className,
      sectionId:         classRoom.sectionId,
      sectionName:       classRoom.sectionName,
      assignedAt:        new Date(),
      isCurrent:         true,
      assignedBy:        actorName,
      notes:             notes || '',
    });

    // ── Update ClassRoom ─────────────────────────────────────────────────────
    classRoom.classTeacherId   = teacher._id;
    classRoom.classTeacherName = teacher.name || `${teacher.firstName} ${teacher.lastName}`.trim();
    await classRoom.save();

    // ── Update Teacher ────────────────────────────────────────────────────────
    teacher.isClassTeacher      = true;
    teacher.currentClassRoomId  = classRoom._id;
    teacher.currentClassRoomName = classRoom.displayName;
    await teacher.save();

    return res.json({
      success: true,
      message: `${teacher.name || teacher.firstName} assigned as class teacher for ${classRoom.displayName}`,
      classRoom,
    });
  } catch (err) {
    console.error('assignClassTeacher error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * PATCH /api/v1/classes/:id/remove-teacher
 * Remove the current class teacher from this classroom.
 */
export const removeClassTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const actorName = req.user?.name || 'admin';

    const classRoom = await ClassRoom.findById(id);
    if (!classRoom) return res.status(404).json({ success: false, message: 'Classroom not found' });

    if (!classRoom.classTeacherId) {
      return res.status(400).json({ success: false, message: 'No class teacher is assigned to this classroom' });
    }

    const teacherId = classRoom.classTeacherId;

    // Close history records
    await ClassTeacherHistory.updateMany(
      { classRoomId: classRoom._id, isCurrent: true },
      { isCurrent: false, removedAt: new Date(), removedBy: actorName }
    );

    // Clear teacher's classroom reference
    await Teacher.findByIdAndUpdate(teacherId, {
      isClassTeacher:       false,
      currentClassRoomId:   null,
      currentClassRoomName: '',
    });

    // Clear classroom's teacher
    classRoom.classTeacherId   = null;
    classRoom.classTeacherName = '';
    await classRoom.save();

    return res.json({
      success: true,
      message: 'Class teacher removed from classroom',
      classRoom,
    });
  } catch (err) {
    console.error('removeClassTeacher error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * GET /api/v1/classes/:id/teacher-history
 * All past + current class teachers for a given classroom
 */
export const getClassTeacherHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const history = await ClassTeacherHistory.find({ classRoomId: id })
      .populate('teacherId', 'name employeeId email photo designation')
      .sort({ assignedAt: -1 })
      .lean();

    return res.json({ success: true, history, total: history.length });
  } catch (err) {
    console.error('getClassTeacherHistory error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * GET /api/v1/classes/teacher/:teacherId/class-history
 * All classrooms a teacher has been class teacher of (with session info)
 */
export const getTeacherClassHistory = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const teacher = await Teacher.findById(teacherId)
      .select('name firstName lastName employeeId email photo designation currentClassRoomId currentClassRoomName isClassTeacher')
      .lean();

    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const history = await ClassTeacherHistory.find({ teacherId })
      .populate('classRoomId', 'displayName className sectionName room capacity')
      .populate('sessionId', 'sessionName startDate endDate isCurrent')
      .sort({ assignedAt: -1 })
      .lean();

    const current = history.find((h) => h.isCurrent) || null;

    return res.json({
      success: true,
      teacher,
      currentClassRoom: current,
      history,
      total: history.length,
    });
  } catch (err) {
    console.error('getTeacherClassHistory error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// =============================================================================
// 3. STUDENT ENROLLMENT
// =============================================================================

/**
 * POST /api/v1/classes/:id/enroll
 * Add students to classroom. Creates StudentSessionHistory records.
 * Body: { studentIds: ['id1', 'id2', ...] }
 */
export const enrollStudents = async (req, res) => {
  try {
    const { id } = req.params;
    const { studentIds } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'studentIds array is required' });
    }

    const classRoom = await ClassRoom.findById(id);
    if (!classRoom) return res.status(404).json({ success: false, message: 'Classroom not found' });
    if (classRoom.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Cannot enroll into an archived/completed classroom' });
    }

    const actorName = req.user?.name || 'admin';
    const results   = { enrolled: [], skipped: [], errors: [] };

    for (const sid of studentIds) {
      try {
        const student = await Student.findById(sid);
        if (!student) { results.errors.push({ id: sid, reason: 'Student not found' }); continue; }

        // Skip if already in this classroom
        if (classRoom.students.some((s) => s.equals(student._id))) {
          results.skipped.push({ id: sid, reason: 'Already enrolled' });
          continue;
        }

        // Check capacity
        if (classRoom.studentCount >= classRoom.capacity) {
          results.errors.push({ id: sid, reason: 'Classroom at full capacity' });
          continue;
        }

        // Upsert StudentSessionHistory
        await StudentSessionHistory.findOneAndUpdate(
          { studentId: student._id, sessionId: classRoom.sessionId },
          {
            studentId:        student._id,
            studentName:      student.name,
            admissionNumber:  student.admissionNumber,
            sessionId:        classRoom.sessionId,
            sessionName:      classRoom.sessionName,
            classRoomId:      classRoom._id,
            classId:          classRoom.classId,
            className:        classRoom.className,
            sectionId:        classRoom.sectionId,
            sectionName:      classRoom.sectionName,
            rollNumber:       student.rollNumber,
            classTeacherId:   classRoom.classTeacherId   || null,
            classTeacherName: classRoom.classTeacherName || '',
            action:           'enrolled',
            status:           'active',
            enrolledAt:       new Date(),
            enrolledBy:       actorName,
          },
          { upsert: true, new: true }
        );

        // Add to classroom
        classRoom.students.push(student._id);

        // Update Student record
        await Student.findByIdAndUpdate(student._id, {
          currentClassRoomId: classRoom._id,
          sessionId:          classRoom.sessionId,
          academicYear:       classRoom.sessionName,
        });

        results.enrolled.push({ id: sid, name: student.name });
      } catch (e) {
        results.errors.push({ id: sid, reason: e.message });
      }
    }

    // Update studentCount and save
    classRoom.studentCount = classRoom.students.length;
    await classRoom.save();

    return res.json({
      success: true,
      message: `${results.enrolled.length} student(s) enrolled`,
      results,
      classRoom: { _id: classRoom._id, displayName: classRoom.displayName, studentCount: classRoom.studentCount },
    });
  } catch (err) {
    console.error('enrollStudents error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * DELETE /api/v1/classes/:id/students/:studentId
 * Remove a student from a classroom (does NOT delete student record)
 */
export const removeStudent = async (req, res) => {
  try {
    const { id, studentId } = req.params;

    const classRoom = await ClassRoom.findById(id);
    if (!classRoom) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const before = classRoom.students.length;
    classRoom.students = classRoom.students.filter((s) => !s.equals(toObjectId(studentId)));

    if (classRoom.students.length === before) {
      return res.status(404).json({ success: false, message: 'Student is not enrolled in this classroom' });
    }

    classRoom.studentCount = classRoom.students.length;
    await classRoom.save();

    // Mark SessionHistory completed
    await StudentSessionHistory.findOneAndUpdate(
      { studentId, sessionId: classRoom.sessionId, status: 'active' },
      { status: 'completed', completedAt: new Date(), completedBy: req.user?.name || 'admin', action: 'transferred' }
    );

    // Clear student's classroom ref if it pointed here
    await Student.findOneAndUpdate(
      { _id: studentId, currentClassRoomId: classRoom._id },
      { currentClassRoomId: null }
    );

    return res.json({
      success: true,
      message: 'Student removed from classroom',
      studentCount: classRoom.studentCount,
    });
  } catch (err) {
    console.error('removeStudent error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * GET /api/v1/classes/:id/students
 * All students enrolled in this classroom for this session
 */
export const getClassStudents = async (req, res) => {
  try {
    const { id } = req.params;

    const classRoom = await ClassRoom.findById(id)
      .populate({
        path: 'students',
        select: 'name admissionNumber rollNumber gender email photo contactNumber status academicYear',
      })
      .lean();

    if (!classRoom) return res.status(404).json({ success: false, message: 'Classroom not found' });

    return res.json({
      success: true,
      classRoom: { _id: classRoom._id, displayName: classRoom.displayName, sessionName: classRoom.sessionName },
      students:  classRoom.students || [],
      total:     classRoom.studentCount,
    });
  } catch (err) {
    console.error('getClassStudents error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// =============================================================================
// 4. TIMETABLE ASSIGNMENT
// =============================================================================

/**
 * PATCH /api/v1/classes/:id/assign-timetable
 * Link a timetable to this classroom (session-scoped).
 *
 * Modes (send ONE):
 *   { timetableId }           — link an already-existing ClassTimetable
 *   { cloneFromTimetableId }  — deep-clone another classroom's timetable
 *   { masterPeriodId }        — create a blank timetable using the given master period
 */
export const assignTimetable = async (req, res) => {
  try {
    const { id } = req.params;
    const { timetableId, cloneFromTimetableId, masterPeriodId } = req.body;

    const classRoom = await ClassRoom.findById(id);
    if (!classRoom) return res.status(404).json({ success: false, message: 'Classroom not found' });

    let timetable;

    if (timetableId) {
      // ── Mode 1: Link existing ─────────────────────────────────────────────
      timetable = await ClassTimetable.findById(timetableId);
      if (!timetable) return res.status(404).json({ success: false, message: 'Timetable not found' });

      // Stamp session + classroom on it
      timetable.sessionId    = classRoom.sessionId;
      timetable.sessionName  = classRoom.sessionName;
      timetable.classRoomId  = classRoom._id;
      await timetable.save();

    } else if (cloneFromTimetableId) {
      // ── Mode 2: Clone from another timetable ──────────────────────────────
      const source = await ClassTimetable.findById(cloneFromTimetableId).lean();
      if (!source) return res.status(404).json({ success: false, message: 'Source timetable not found' });

      const { _id, createdAt, updatedAt, ...rest } = source;
      timetable = await ClassTimetable.create({
        ...rest,
        classSectionKey: `${classRoom.className} - ${classRoom.sectionName}`,
        classId:    classRoom.classId,
        sectionId:  classRoom.sectionId,
        className:  classRoom.className,
        sectionName: classRoom.sectionName,
        sessionId:  classRoom.sessionId,
        sessionName: classRoom.sessionName,
        classRoomId: classRoom._id,
        createdBy:  req.user?.name || 'admin',
      });

    } else if (masterPeriodId) {
      // ── Mode 3: Create blank from master period ───────────────────────────
      timetable = await ClassTimetable.create({
        classSectionKey: `${classRoom.className} - ${classRoom.sectionName}`,
        classId:      classRoom.classId,
        sectionId:    classRoom.sectionId,
        className:    classRoom.className,
        sectionName:  classRoom.sectionName,
        sessionId:    classRoom.sessionId,
        sessionName:  classRoom.sessionName,
        classRoomId:  classRoom._id,
        masterPeriodId,
        allocations:  [],
        createdBy:    req.user?.name || 'admin',
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide one of: timetableId, cloneFromTimetableId, or masterPeriodId',
      });
    }

    // Link timetable to classroom
    classRoom.timetableId   = timetable._id;
    classRoom.masterPeriodId = String(timetable.masterPeriodId || masterPeriodId || '');
    await classRoom.save();

    return res.json({
      success: true,
      message: 'Timetable assigned to classroom',
      timetable,
      classRoom: { _id: classRoom._id, displayName: classRoom.displayName, timetableId: classRoom.timetableId },
    });
  } catch (err) {
    console.error('assignTimetable error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/**
 * GET /api/v1/classes/:id/timetable
 * Returns the timetable linked to this classroom
 */
export const getClassTimetable = async (req, res) => {
  try {
    const { id } = req.params;

    const classRoom = await ClassRoom.findById(id).lean();
    if (!classRoom) return res.status(404).json({ success: false, message: 'Classroom not found' });

    if (!classRoom.timetableId) {
      return res.json({ success: true, timetable: null, message: 'No timetable assigned yet' });
    }

    const timetable = await ClassTimetable.findById(classRoom.timetableId).lean();
    return res.json({ success: true, timetable });
  } catch (err) {
    console.error('getClassTimetable error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// =============================================================================
// 5. HISTORY & LOOKUP
// =============================================================================

/**
 * GET /api/v1/classes/student/:studentId/history
 * Returns full class + session timeline for a student.
 * :studentId can be a Mongo ObjectId OR an admissionNumber (e.g. STD-2026-0001)
 *
 * Response includes current class info + all historical sessions.
 */
export const getStudentFullHistory = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Resolve student by ObjectId or admissionNumber
    let student;
    if (mongoose.Types.ObjectId.isValid(studentId)) {
      student = await Student.findById(studentId)
        .select('name admissionNumber rollNumber email gender photo status academicYear currentClassRoomId sessionId classId sectionId className sectionName promotionHistory')
        .populate('currentClassRoomId', 'displayName className sectionName classTeacherId classTeacherName sessionName room')
        .lean();
    }
    if (!student) {
      student = await Student.findOne({ admissionNumber: studentId.toUpperCase() })
        .select('name admissionNumber rollNumber email gender photo status academicYear currentClassRoomId sessionId classId sectionId className sectionName promotionHistory')
        .populate('currentClassRoomId', 'displayName className sectionName classTeacherId classTeacherName sessionName room')
        .lean();
    }

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Fetch full session-by-session history
    const history = await StudentSessionHistory.find({ studentId: student._id })
      .populate('sessionId', 'sessionName startDate endDate isCurrent')
      .populate('classTeacherId', 'name employeeId email photo')
      .sort({ enrolledAt: 1 })
      .lean();

    // Fetch current classroom teacher details if not populated
    let currentClassRoom = student.currentClassRoomId || null;
    if (currentClassRoom && currentClassRoom.classTeacherId) {
      const ct = await Teacher.findById(currentClassRoom.classTeacherId)
        .select('name employeeId email photo')
        .lean();
      currentClassRoom = { ...currentClassRoom, classTeacher: ct };
    }

    return res.json({
      success: true,
      student: {
        _id:             student._id,
        name:            student.name,
        admissionNumber: student.admissionNumber,
        email:           student.email,
        gender:          student.gender,
        photo:           student.photo,
        status:          student.status,
        rollNumber:      student.rollNumber,
        currentClass: currentClassRoom
          ? {
              displayName:      currentClassRoom.displayName,
              className:        currentClassRoom.className,
              sectionName:      currentClassRoom.sectionName,
              sessionName:      currentClassRoom.sessionName,
              classTeacher:     currentClassRoom.classTeacher || null,
              classTeacherName: currentClassRoom.classTeacherName,
              room:             currentClassRoom.room,
              status:           'active',
            }
          : null,
      },
      history,
      totalSessions: history.length,
    });
  } catch (err) {
    console.error('getStudentFullHistory error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// =============================================================================
// 6. PROMOTE CLASSROOM
// =============================================================================

/**
 * POST /api/v1/classes/:id/promote
 * Promote all students in this classroom to a new class in a new session.
 *
 * Body:
 * {
 *   targetSessionId:  '...',   // new AcademicSession ObjectId
 *   targetClassId:    'cls-11',
 *   targetSectionId:  'sec-a',
 *   action:           'promote' | 'passout'
 * }
 *
 * - Marks current classroom StudentSessionHistory as completed
 * - Creates (or finds) a ClassRoom in the new session
 * - Enrolls all students into it
 * - Appends to Student.promotionHistory
 */
export const promoteClassRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetSessionId, targetClassId, targetSectionId, action = 'promote' } = req.body;

    if (!targetSessionId || !targetClassId || !targetSectionId) {
      return res.status(400).json({
        success: false,
        message: 'targetSessionId, targetClassId and targetSectionId are required',
      });
    }

    const [sourceRoom, targetSession] = await Promise.all([
      ClassRoom.findById(id).populate('students'),
      AcademicSession.findById(targetSessionId),
    ]);

    if (!sourceRoom)    return res.status(404).json({ success: false, message: 'Source classroom not found' });
    if (!targetSession) return res.status(404).json({ success: false, message: 'Target session not found' });

    const actorName      = req.user?.name || 'admin';
    const targetClassName   = toClassName(targetClassId);
    const targetSectionName = toSectionName(targetSectionId);
    const sec               = targetSectionName.replace(/^Section\s*/i, '');
    const displayName       = `${targetClassName} – ${sec} (${targetSession.sessionName})`;

    // Create or find the target classroom
    let targetRoom = await ClassRoom.findOne({
      sessionId: targetSession._id,
      classId:   targetClassId,
      sectionId: targetSectionId,
    });

    if (!targetRoom) {
      targetRoom = await ClassRoom.create({
        sessionId:   targetSession._id,
        sessionName: targetSession.sessionName,
        classId:     targetClassId,
        className:   targetClassName,
        sectionId:   targetSectionId,
        sectionName: targetSectionName,
        displayName,
        createdBy:   actorName,
      });
    }

    const now     = new Date();
    const results = { promoted: [], skipped: [], errors: [] };

    for (const student of sourceRoom.students) {
      try {
        // Close old session history
        await StudentSessionHistory.findOneAndUpdate(
          { studentId: student._id, sessionId: sourceRoom.sessionId, status: 'active' },
          { status: 'completed', completedAt: now, completedBy: actorName, action }
        );

        // Skip if already in target classroom
        if (targetRoom.students.some((s) => s.equals(student._id))) {
          results.skipped.push({ id: student._id, name: student.name, reason: 'Already enrolled in target' });
          continue;
        }

        // Create new session history
        await StudentSessionHistory.findOneAndUpdate(
          { studentId: student._id, sessionId: targetSession._id },
          {
            studentId:       student._id,
            studentName:     student.name,
            admissionNumber: student.admissionNumber,
            sessionId:       targetSession._id,
            sessionName:     targetSession.sessionName,
            classRoomId:     targetRoom._id,
            classId:         targetClassId,
            className:       targetClassName,
            sectionId:       targetSectionId,
            sectionName:     targetSectionName,
            rollNumber:      student.rollNumber,
            action:          action === 'passout' ? 'passout' : 'promoted',
            status:          action === 'passout' ? 'completed' : 'active',
            enrolledAt:      now,
            enrolledBy:      actorName,
          },
          { upsert: true, new: true }
        );

        // Append to Student.promotionHistory + update current classroom
        await Student.findByIdAndUpdate(student._id, {
          $push: {
            promotionHistory: {
              fromClass:   sourceRoom.className,
              toClass:     targetClassName,
              fromSection: sourceRoom.sectionName,
              toSection:   targetSectionName,
              action,
              sessionName: targetSession.sessionName,
              sessionId:   targetSession._id,
              classRoomId: targetRoom._id,
              promotedAt:  now,
              promotedBy:  actorName,
            },
          },
          currentClassRoomId: action === 'passout' ? null : targetRoom._id,
          sessionId:          action === 'passout' ? null : targetSession._id,
          academicYear:       targetSession.sessionName,
          status:             action === 'passout' ? 'Passout' : 'active',
          classId:            action === 'passout' ? student.classId : targetClassId,
          className:          action === 'passout' ? student.className : targetClassName,
          sectionId:          action === 'passout' ? student.sectionId : targetSectionId,
          sectionName:        action === 'passout' ? student.sectionName : targetSectionName,
          class:              targetClassName,
          section:            targetSectionName,
        });

        if (action !== 'passout') {
          targetRoom.students.push(student._id);
        }

        results.promoted.push({ id: student._id, name: student.name });
      } catch (e) {
        results.errors.push({ id: student._id, name: student.name, reason: e.message });
      }
    }

    // Mark source classroom as completed, save target
    sourceRoom.status = 'completed';
    await sourceRoom.save();

    targetRoom.studentCount = targetRoom.students.length;
    await targetRoom.save();

    return res.json({
      success: true,
      message: `${results.promoted.length} student(s) ${action === 'passout' ? 'passed out' : 'promoted'} to ${displayName}`,
      results,
      sourceClassRoom: { _id: sourceRoom._id, status: sourceRoom.status },
      targetClassRoom: { _id: targetRoom._id, displayName: targetRoom.displayName, studentCount: targetRoom.studentCount },
    });
  } catch (err) {
    console.error('promoteClassRoom error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};
