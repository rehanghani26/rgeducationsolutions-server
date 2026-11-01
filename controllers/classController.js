// 2. External packages
import mongoose from 'mongoose';

// 3. Configuration
import { checkFallback } from '../config/db.js';

// 4. Models
import ClassRoom from '../models/ClassRoom.js';
import ClassTeacherHistory from '../models/ClassTeacherHistory.js';
import StudentSessionHistory from '../models/StudentSessionHistory.js';
import ClassTimetable from '../models/ClassTimetable.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import AcademicSession from '../models/AcademicSession.js';

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
 * Safely casts a value to a Mongoose ObjectId or returns null.
 *
 * @param {string|mongoose.Types.ObjectId} val - Input ID.
 * @returns {mongoose.Types.ObjectId|null}
 */
const toObjectId = (val) => {
  if (!val) return null;
  if (isValidObjectId(val)) return new mongoose.Types.ObjectId(String(val));
  return null;
};

/** Class code → display name mapping */
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

/**
 * Derives human-readable class name from class code.
 *
 * @param {string} id - Class code identifier.
 * @returns {string} Human-readable class name.
 */
const toClassName = (id) => CLASS_MAP[id] || id || '';

/**
 * Derives human-readable section name from section code.
 *
 * @param {string} id - Section code identifier.
 * @returns {string} Human-readable section name.
 */
const toSectionName = (id) => SECTION_MAP[id] || id || '';

/**
 * Retrieves paginated classrooms with optional session, class, or section filtering.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getClassRooms = async (req, res) => {
  try {
    const { sessionId, classId, sectionId, status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (sessionId) filter.sessionId = toObjectId(sessionId) || sessionId;
    if (classId) filter.classId = classId;
    if (sectionId) filter.sectionId = sectionId;
    if (status) filter.status = status;

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

    return sendSuccess(res, undefined, {
      classRooms,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves all classrooms for a specific academic session.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getClassRoomsBySession = async (req, res) => {
  try {
    const sessionObjId = toObjectId(req.params.sessionId);
    if (!sessionObjId) {
      return sendBadRequest(res, 'Invalid session ID');
    }

    const classRooms = await ClassRoom.find({ sessionId: sessionObjId })
      .populate('classTeacherId', 'name employeeId email phone')
      .sort({ className: 1, sectionName: 1 })
      .lean();

    const session = await AcademicSession.findById(sessionObjId).lean();
    return sendSuccess(res, undefined, { session, classRooms, total: classRooms.length });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves full details for a single classroom by ID.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getClassRoomById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!toObjectId(id)) {
      return sendBadRequest(res, 'Invalid classroom ID');
    }

    const classRoom = await ClassRoom.findById(id)
      .populate('classTeacherId', 'name employeeId email phone photo designation')
      .populate('sessionId', 'sessionName startDate endDate isCurrent status')
      .populate('timetableId')
      .lean();

    if (!classRoom) {
      return sendNotFound(res, 'Classroom not found');
    }

    return sendSuccess(res, undefined, { classRoom });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Creates a session-scoped classroom.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const createClassRoom = async (req, res) => {
  try {
    const { sessionId, classId, sectionId, room, capacity } = req.body;

    if (!sessionId || !classId || !sectionId) {
      return sendBadRequest(res, 'sessionId, classId and sectionId are required');
    }

    const sessionObjId = toObjectId(sessionId);
    if (!sessionObjId) {
      return sendBadRequest(res, 'Invalid session ID');
    }

    const session = await AcademicSession.findById(sessionObjId).lean();
    if (!session) {
      return sendNotFound(res, 'Academic session not found');
    }

    const className = toClassName(classId);
    const sectionName = toSectionName(sectionId);
    const sec = sectionName.replace(/^Section\s*/i, '');
    const displayName = `${className} – ${sec} (${session.sessionName})`;

    const classRoom = await ClassRoom.create({
      sessionId: sessionObjId,
      sessionName: session.sessionName,
      classId,
      className,
      sectionId,
      sectionName,
      displayName,
      room: room || '',
      capacity: capacity || 40,
      createdBy: req.user?.name || 'admin',
    });

    return sendCreated(res, undefined, { classRoom });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A classroom for this class and section already exists in this session',
      });
    }
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Updates classroom parameters (room number, capacity, status).
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const updateClassRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const { room, capacity, status } = req.body;
    const patch = {};
    if (room !== undefined) patch.room = room;
    if (capacity !== undefined) patch.capacity = Number(capacity);
    if (status !== undefined) patch.status = status;

    const classRoom = await ClassRoom.findByIdAndUpdate(id, patch, { new: true })
      .populate('classTeacherId', 'name employeeId');

    if (!classRoom) {
      return sendNotFound(res, 'Classroom not found');
    }

    return sendSuccess(res, undefined, { classRoom });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Soft-deletes a classroom by archiving its status.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
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
      return sendNotFound(res, 'Classroom not found');
    }
    return sendSuccess(res, 'Classroom archived successfully', { classRoom });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Assigns a teacher as the class teacher for a classroom and records historical audit trail.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const assignClassTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { teacherId, notes } = req.body;

    if (!teacherId) {
      return sendBadRequest(res, 'teacherId is required');
    }

    const [classRoom, teacher] = await Promise.all([
      ClassRoom.findById(id),
      Teacher.findById(teacherId),
    ]);

    if (!classRoom) return sendNotFound(res, 'Classroom not found');
    if (!teacher) return sendNotFound(res, 'Teacher not found');

    const actorName = req.user?.name || 'admin';

    // Close any active history record for this classroom
    await ClassTeacherHistory.updateMany(
      { classRoomId: classRoom._id, isCurrent: true },
      { isCurrent: false, removedAt: new Date(), removedBy: actorName }
    );

    // If teacher was class teacher elsewhere, close that too
    if (teacher.currentClassRoomId && !teacher.currentClassRoomId.equals(classRoom._id)) {
      await ClassTeacherHistory.updateMany(
        { teacherId: teacher._id, isCurrent: true },
        { isCurrent: false, removedAt: new Date(), removedBy: actorName }
      );
      await ClassRoom.findByIdAndUpdate(teacher.currentClassRoomId, {
        classTeacherId: null,
        classTeacherName: '',
      });
    }

    // Create new history record
    await ClassTeacherHistory.create({
      teacherId: teacher._id,
      teacherName: teacher.name || `${teacher.firstName} ${teacher.lastName}`.trim(),
      teacherEmployeeId: teacher.employeeId,
      classRoomId: classRoom._id,
      sessionId: classRoom.sessionId,
      sessionName: classRoom.sessionName,
      classId: classRoom.classId,
      className: classRoom.className,
      sectionId: classRoom.sectionId,
      sectionName: classRoom.sectionName,
      assignedAt: new Date(),
      isCurrent: true,
      assignedBy: actorName,
      notes: notes || '',
    });

    classRoom.classTeacherId = teacher._id;
    classRoom.classTeacherName = teacher.name || `${teacher.firstName} ${teacher.lastName}`.trim();
    await classRoom.save();

    teacher.isClassTeacher = true;
    teacher.currentClassRoomId = classRoom._id;
    teacher.currentClassRoomName = classRoom.displayName;
    await teacher.save();

    return sendSuccess(
      res,
      `${teacher.name || teacher.firstName} assigned as class teacher for ${classRoom.displayName}`,
      { classRoom }
    );
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Removes the currently assigned class teacher from a classroom.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const removeClassTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const actorName = req.user?.name || 'admin';

    const classRoom = await ClassRoom.findById(id);
    if (!classRoom) return sendNotFound(res, 'Classroom not found');

    if (!classRoom.classTeacherId) {
      return sendBadRequest(res, 'No class teacher is assigned to this classroom');
    }

    const teacherId = classRoom.classTeacherId;

    await ClassTeacherHistory.updateMany(
      { classRoomId: classRoom._id, isCurrent: true },
      { isCurrent: false, removedAt: new Date(), removedBy: actorName }
    );

    await Teacher.findByIdAndUpdate(teacherId, {
      isClassTeacher: false,
      currentClassRoomId: null,
      currentClassRoomName: '',
    });

    classRoom.classTeacherId = null;
    classRoom.classTeacherName = '';
    await classRoom.save();

    return sendSuccess(res, 'Class teacher removed from classroom', { classRoom });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves teacher assignment history for a given classroom.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getClassTeacherHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const history = await ClassTeacherHistory.find({ classRoomId: id })
      .populate('teacherId', 'name employeeId email photo designation')
      .sort({ assignedAt: -1 })
      .lean();

    return sendSuccess(res, undefined, { history, total: history.length });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves historical classrooms assigned to a teacher.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getTeacherClassHistory = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const teacher = await Teacher.findById(teacherId)
      .select('name firstName lastName employeeId email photo designation currentClassRoomId currentClassRoomName isClassTeacher')
      .lean();

    if (!teacher) return sendNotFound(res, 'Teacher not found');

    const history = await ClassTeacherHistory.find({ teacherId })
      .populate('classRoomId', 'displayName className sectionName room capacity')
      .populate('sessionId', 'sessionName startDate endDate isCurrent')
      .sort({ assignedAt: -1 })
      .lean();

    const current = history.find((h) => h.isCurrent) || null;

    return sendSuccess(res, undefined, {
      teacher,
      currentClassRoom: current,
      history,
      total: history.length,
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Enrolls students into a classroom and records session history.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const enrollStudents = async (req, res) => {
  try {
    const { id } = req.params;
    const { studentIds } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return sendBadRequest(res, 'studentIds array is required');
    }

    const classRoom = await ClassRoom.findById(id);
    if (!classRoom) return sendNotFound(res, 'Classroom not found');
    if (classRoom.status !== 'active') {
      return sendBadRequest(res, 'Cannot enroll into an archived/completed classroom');
    }

    const actorName = req.user?.name || 'admin';
    const results = { enrolled: [], skipped: [], errors: [] };

    for (const sid of studentIds) {
      try {
        const student = await Student.findById(sid);
        if (!student) {
          results.errors.push({ id: sid, reason: 'Student not found' });
          continue;
        }

        if (classRoom.students.some((s) => s.equals(student._id))) {
          results.skipped.push({ id: sid, reason: 'Already enrolled' });
          continue;
        }

        if (classRoom.studentCount >= classRoom.capacity) {
          results.errors.push({ id: sid, reason: 'Classroom at full capacity' });
          continue;
        }

        await StudentSessionHistory.findOneAndUpdate(
          { studentId: student._id, sessionId: classRoom.sessionId },
          {
            studentId: student._id,
            studentName: student.name,
            admissionNumber: student.admissionNumber,
            sessionId: classRoom.sessionId,
            sessionName: classRoom.sessionName,
            classRoomId: classRoom._id,
            classId: classRoom.classId,
            className: classRoom.className,
            sectionId: classRoom.sectionId,
            sectionName: classRoom.sectionName,
            rollNumber: student.rollNumber,
            classTeacherId: classRoom.classTeacherId || null,
            classTeacherName: classRoom.classTeacherName || '',
            action: 'enrolled',
            status: 'active',
            enrolledAt: new Date(),
            enrolledBy: actorName,
          },
          { upsert: true, new: true }
        );

        classRoom.students.push(student._id);

        await Student.findByIdAndUpdate(student._id, {
          currentClassRoomId: classRoom._id,
          sessionId: classRoom.sessionId,
          academicYear: classRoom.sessionName,
        });

        results.enrolled.push({ id: sid, name: student.name });
      } catch (e) {
        results.errors.push({ id: sid, reason: e.message });
      }
    }

    classRoom.studentCount = classRoom.students.length;
    await classRoom.save();

    return sendSuccess(res, `${results.enrolled.length} student(s) enrolled`, {
      results,
      classRoom: { _id: classRoom._id, displayName: classRoom.displayName, studentCount: classRoom.studentCount },
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Removes a student from a classroom.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const removeStudent = async (req, res) => {
  try {
    const { id, studentId } = req.params;

    const classRoom = await ClassRoom.findById(id);
    if (!classRoom) return sendNotFound(res, 'Classroom not found');

    const before = classRoom.students.length;
    classRoom.students = classRoom.students.filter((s) => !s.equals(toObjectId(studentId)));

    if (classRoom.students.length === before) {
      return sendNotFound(res, 'Student is not enrolled in this classroom');
    }

    classRoom.studentCount = classRoom.students.length;
    await classRoom.save();

    await StudentSessionHistory.findOneAndUpdate(
      { studentId, sessionId: classRoom.sessionId, status: 'active' },
      { status: 'completed', completedAt: new Date(), completedBy: req.user?.name || 'admin', action: 'transferred' }
    );

    await Student.findOneAndUpdate(
      { _id: studentId, currentClassRoomId: classRoom._id },
      { currentClassRoomId: null }
    );

    return sendSuccess(res, 'Student removed from classroom', {
      studentCount: classRoom.studentCount,
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves all students enrolled in a classroom.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
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

    if (!classRoom) return sendNotFound(res, 'Classroom not found');

    return sendSuccess(res, undefined, {
      classRoom: { _id: classRoom._id, displayName: classRoom.displayName, sessionName: classRoom.sessionName },
      students: classRoom.students || [],
      total: classRoom.studentCount,
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Assigns or clones a timetable for a classroom.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const assignTimetable = async (req, res) => {
  try {
    const { id } = req.params;
    const { timetableId, cloneFromTimetableId, masterPeriodId } = req.body;

    const classRoom = await ClassRoom.findById(id);
    if (!classRoom) return sendNotFound(res, 'Classroom not found');

    let timetable;

    if (timetableId) {
      timetable = await ClassTimetable.findById(timetableId);
      if (!timetable) return sendNotFound(res, 'Timetable not found');

      timetable.sessionId = classRoom.sessionId;
      timetable.sessionName = classRoom.sessionName;
      timetable.classRoomId = classRoom._id;
      await timetable.save();
    } else if (cloneFromTimetableId) {
      const source = await ClassTimetable.findById(cloneFromTimetableId).lean();
      if (!source) return sendNotFound(res, 'Source timetable not found');

      const { _id, createdAt, updatedAt, ...rest } = source;
      timetable = await ClassTimetable.create({
        ...rest,
        classSectionKey: `${classRoom.className} - ${classRoom.sectionName}`,
        classId: classRoom.classId,
        sectionId: classRoom.sectionId,
        className: classRoom.className,
        sectionName: classRoom.sectionName,
        sessionId: classRoom.sessionId,
        sessionName: classRoom.sessionName,
        classRoomId: classRoom._id,
        createdBy: req.user?.name || 'admin',
      });
    } else if (masterPeriodId) {
      timetable = await ClassTimetable.create({
        classSectionKey: `${classRoom.className} - ${classRoom.sectionName}`,
        classId: classRoom.classId,
        sectionId: classRoom.sectionId,
        className: classRoom.className,
        sectionName: classRoom.sectionName,
        sessionId: classRoom.sessionId,
        sessionName: classRoom.sessionName,
        classRoomId: classRoom._id,
        masterPeriodId,
        allocations: [],
        createdBy: req.user?.name || 'admin',
      });
    } else {
      return sendBadRequest(res, 'Provide one of: timetableId, cloneFromTimetableId, or masterPeriodId');
    }

    classRoom.timetableId = timetable._id;
    classRoom.masterPeriodId = String(timetable.masterPeriodId || masterPeriodId || '');
    await classRoom.save();

    return sendSuccess(res, 'Timetable assigned to classroom', {
      timetable,
      classRoom: { _id: classRoom._id, displayName: classRoom.displayName, timetableId: classRoom.timetableId },
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves the timetable associated with a classroom.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getClassTimetable = async (req, res) => {
  try {
    const { id } = req.params;

    const classRoom = await ClassRoom.findById(id).lean();
    if (!classRoom) return sendNotFound(res, 'Classroom not found');

    if (!classRoom.timetableId) {
      return sendSuccess(res, 'No timetable assigned yet', { timetable: null });
    }

    const timetable = await ClassTimetable.findById(classRoom.timetableId).lean();
    return sendSuccess(res, undefined, { timetable });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves the full academic and enrollment history for a student across all sessions.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getStudentFullHistory = async (req, res) => {
  try {
    const { studentId } = req.params;

    let student;
    if (isValidObjectId(studentId)) {
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
      return sendNotFound(res, 'Student not found');
    }

    const history = await StudentSessionHistory.find({ studentId: student._id })
      .populate('sessionId', 'sessionName startDate endDate isCurrent')
      .populate('classTeacherId', 'name employeeId email photo')
      .sort({ enrolledAt: 1 })
      .lean();

    let currentClassRoom = student.currentClassRoomId || null;
    if (currentClassRoom && currentClassRoom.classTeacherId) {
      const ct = await Teacher.findById(currentClassRoom.classTeacherId)
        .select('name employeeId email photo')
        .lean();
      currentClassRoom = { ...currentClassRoom, classTeacher: ct };
    }

    return sendSuccess(res, undefined, {
      student: {
        _id: student._id,
        name: student.name,
        admissionNumber: student.admissionNumber,
        email: student.email,
        gender: student.gender,
        photo: student.photo,
        status: student.status,
        rollNumber: student.rollNumber,
        currentClass: currentClassRoom
          ? {
              displayName: currentClassRoom.displayName,
              className: currentClassRoom.className,
              sectionName: currentClassRoom.sectionName,
              sessionName: currentClassRoom.sessionName,
              classTeacher: currentClassRoom.classTeacher || null,
              classTeacherName: currentClassRoom.classTeacherName,
              room: currentClassRoom.room,
              status: 'active',
            }
          : null,
      },
      history,
      totalSessions: history.length,
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Promotes all students in a classroom to a new session and classroom.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const promoteClassRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetSessionId, targetClassId, targetSectionId, action = 'promote' } = req.body;

    if (!targetSessionId || !targetClassId || !targetSectionId) {
      return sendBadRequest(res, 'targetSessionId, targetClassId and targetSectionId are required');
    }

    const [sourceRoom, targetSession] = await Promise.all([
      ClassRoom.findById(id).populate('students'),
      AcademicSession.findById(targetSessionId),
    ]);

    if (!sourceRoom) return sendNotFound(res, 'Source classroom not found');
    if (!targetSession) return sendNotFound(res, 'Target session not found');

    const actorName = req.user?.name || 'admin';
    const targetClassName = toClassName(targetClassId);
    const targetSectionName = toSectionName(targetSectionId);
    const sec = targetSectionName.replace(/^Section\s*/i, '');
    const displayName = `${targetClassName} – ${sec} (${targetSession.sessionName})`;

    let targetRoom = await ClassRoom.findOne({
      sessionId: targetSession._id,
      classId: targetClassId,
      sectionId: targetSectionId,
    });

    if (!targetRoom) {
      targetRoom = await ClassRoom.create({
        sessionId: targetSession._id,
        sessionName: targetSession.sessionName,
        classId: targetClassId,
        className: targetClassName,
        sectionId: targetSectionId,
        sectionName: targetSectionName,
        displayName,
        createdBy: actorName,
      });
    }

    const now = new Date();
    const results = { promoted: [], skipped: [], errors: [] };

    for (const student of sourceRoom.students) {
      try {
        await StudentSessionHistory.findOneAndUpdate(
          { studentId: student._id, sessionId: sourceRoom.sessionId, status: 'active' },
          { status: 'completed', completedAt: now, completedBy: actorName, action }
        );

        if (targetRoom.students.some((s) => s.equals(student._id))) {
          results.skipped.push({ id: student._id, name: student.name, reason: 'Already enrolled in target' });
          continue;
        }

        await StudentSessionHistory.findOneAndUpdate(
          { studentId: student._id, sessionId: targetSession._id },
          {
            studentId: student._id,
            studentName: student.name,
            admissionNumber: student.admissionNumber,
            sessionId: targetSession._id,
            sessionName: targetSession.sessionName,
            classRoomId: targetRoom._id,
            classId: targetClassId,
            className: targetClassName,
            sectionId: targetSectionId,
            sectionName: targetSectionName,
            rollNumber: student.rollNumber,
            action: action === 'passout' ? 'passout' : 'promoted',
            status: action === 'passout' ? 'completed' : 'active',
            enrolledAt: now,
            enrolledBy: actorName,
          },
          { upsert: true, new: true }
        );

        await Student.findByIdAndUpdate(student._id, {
          $push: {
            promotionHistory: {
              fromClass: sourceRoom.className,
              toClass: targetClassName,
              fromSection: sourceRoom.sectionName,
              toSection: targetSectionName,
              action,
              sessionName: targetSession.sessionName,
              sessionId: targetSession._id,
              classRoomId: targetRoom._id,
              promotedAt: now,
              promotedBy: actorName,
            },
          },
          currentClassRoomId: action === 'passout' ? null : targetRoom._id,
          sessionId: action === 'passout' ? null : targetSession._id,
          academicYear: targetSession.sessionName,
          status: action === 'passout' ? 'Passout' : 'active',
          classId: action === 'passout' ? student.classId : targetClassId,
          className: action === 'passout' ? student.className : targetClassName,
          sectionId: action === 'passout' ? student.sectionId : targetSectionId,
          sectionName: action === 'passout' ? student.sectionName : targetSectionName,
          class: targetClassName,
          section: targetSectionName,
        });

        if (action !== 'passout') {
          targetRoom.students.push(student._id);
        }

        results.promoted.push({ id: student._id, name: student.name });
      } catch (e) {
        results.errors.push({ id: student._id, name: student.name, reason: e.message });
      }
    }

    sourceRoom.status = 'completed';
    await sourceRoom.save();

    targetRoom.studentCount = targetRoom.students.length;
    await targetRoom.save();

    return sendSuccess(
      res,
      `${results.promoted.length} student(s) ${action === 'passout' ? 'passed out' : 'promoted'} to ${displayName}`,
      {
        results,
        sourceClassRoom: { _id: sourceRoom._id, status: sourceRoom.status },
        targetClassRoom: { _id: targetRoom._id, displayName: targetRoom.displayName, studentCount: targetRoom.studentCount },
      }
    );
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};
