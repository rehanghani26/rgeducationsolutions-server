import mongoose from 'mongoose';
import { checkFallback } from '../config/db.js';
import AcademicSession from '../models/AcademicSession.js';
import Hostel from '../models/Hostel.js';
import HostelAllocation from '../models/HostelAllocation.js';
import HostelEvent from '../models/HostelEvent.js';
import HostelOccupancy from '../models/HostelOccupancy.js';
import HostelRoom from '../models/HostelRoom.js';
import Student from '../models/Student.js';
import StudentSessionHistory from '../models/StudentSessionHistory.js';
import User from '../models/User.js';
import { academicError, getAcademicScope } from '../utils/academicScope.js';
import { hostelEventDate, onOrAfterHostelDay } from '../utils/hostelDates.js';
import { normalizeRole } from '../middleware/rbac.js';
import { buildSearchFilter, paginateResult, parsePagination } from '../utils/paginateQuery.js';
import { writeProcurement } from './procurementStore.js';
import { findScopedEnrollment } from './studentEnrollmentService.js';

const adminRoles = new Set(['super-admin', 'school-admin', 'admin', 'principal']);
const idOf = (value) => String(value?._id || value?.id || value || '');
const keyOf = (value) => String(value || '').trim().toLowerCase();
const isId = (value) => mongoose.isObjectIdOrHexString(value);
const unresolved = { reviewedAt: null };
const liveStudent = { status: 'active', isActive: { $ne: false } };
const hostelGenders = { boys: 'Male', girls: 'Female' };
const hostelCategories = new Set(['boys', 'girls', 'coed']);
const roomTypes = new Set(['Normal', 'Premium']);
const allocationFields = 'schoolId studentId studentName admissionNumber className sectionName sessionId sessionName hostelId hostelName roomId bedId block room bed roomType active status assignedAt createdAt endedAt endReason previousAllocationId';

function allocationStatus({ active, status }) {
  if (active) return 'assigned';
  // Existing departure records retain their original dates.
  return status === 'checkedOut' ? 'left' : status;
}

function clean(value, label, required = false, length = 100) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length > length || (required && !result)) throw academicError(`Enter a valid ${label}.`);
  return result;
}

function scopeFor(schoolId, required = true) {
  const scope = getAcademicScope();
  if (scope?.schoolId === schoolId && (scope.sessionId || scope.legacy)) return scope;
  if (required) throw academicError('Select a configured academic session.', 409);
  return null;
}

function capacityOf(value) {
  const capacity = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw academicError('Enter a positive whole number for hostel capacity.');
  return capacity;
}

export async function getHostelAccess(req, session = null) {
  if (checkFallback() || mongoose.connection.readyState !== 1) {
    throw academicError('Hostel records are unavailable while MongoDB is disconnected.', 503);
  }
  const { user } = req;
  const schoolId = user?.schoolId;
  const student = normalizeRole(user?.role) === 'student';
  const actor = idOf((student && user?.profileId) || user?._id || user?.id);
  if (!schoolId || !isId(actor)) throw academicError('School account required.', 403);
  const staff = student ? null : await User.findOne({ schoolId, _id: actor, isActive: { $ne: false } }).select('role name').session(session).lean();
  const canConfigure = adminRoles.has(normalizeRole(staff?.role));
  let hostelIds = [];
  if (staff && !canConfigure) {
    hostelIds = await Hostel.distinct('_id', { schoolId, wardens: actor }).session(session);
  }
  return { schoolId, actor, actorName: staff?.name, student, canConfigure, hostelIds, canManage: canConfigure || hostelIds.length > 0 };
}

function requireManagement(access, setup = false) {
  if (setup ? !access.canConfigure : !access.canManage) throw academicError('You do not have access to manage this hostel.', 403);
}

function hostelFilter(access) {
  return access.canConfigure ? {} : { hostelId: { $in: access.hostelIds } };
}

function assertHostel(access, hostelId) {
  if (!isId(hostelId) || (!access.canConfigure && !access.hostelIds.some((id) => idOf(id) === idOf(hostelId)))) {
    throw academicError('Hostel not found.', 404);
  }
}

async function getHostel(access, hostelId) {
  assertHostel(access, hostelId);
  const hostel = await Hostel.findOne({ schoolId: access.schoolId, _id: hostelId }).session(access.session || null);
  if (!hostel) throw academicError('Hostel not found.', 404);
  return hostel;
}

async function configuredBeds({ schoolId, session }, hostelId, excludeRoom) {
  const [result] = await HostelRoom.aggregate([
    { $match: { schoolId, hostelId, ...(excludeRoom && { _id: { $ne: excludeRoom } }) } },
    { $group: { _id: null, total: { $sum: { $size: '$beds' } } } },
  ]).session(session);
  return result?.total || 0;
}

function recordHostelEvent(access, hostel, event, room) {
  return HostelEvent.create([{
    schoolId: access.schoolId, hostelId: hostel._id, hostelName: hostel.name, event, actorId: access.actor, actorName: access.actorName,
    ...(room && { roomId: room._id, room: room.number, block: room.block }),
  }], { session: access.session });
}

// Use the same school lock as academic rollover and enrollment changes.
async function write(req, { setup = false, activeSession = true } = {}, operation) {
  const access = await getHostelAccess(req);
  requireManagement(access, setup);
  const scope = scopeFor(access.schoolId, activeSession);
  if (activeSession && (scope.readOnly || scope.legacy)) throw academicError('Choose the active academic session.', 409);
  return writeProcurement({ schoolId: access.schoolId }, [], async (store, session) => {
    await store.lockAcademicSettings();
    const currentAccess = await getHostelAccess(req, session);
    requireManagement(currentAccess, setup);
    if (activeSession && !(await store.get('academicSessions', scope.sessionId))?.isCurrent) {
      throw academicError('The active academic session changed. Reload the page.', 409);
    }
    return operation({ ...currentAccess, scope, store, session });
  }, { allowFallback: false });
}

function matchingLocation(legacy, hostel, room, bed) {
  const block = keyOf(legacy.block);
  return [keyOf(room.block), keyOf(hostel.name)].includes(block) &&
    keyOf(legacy.room) === keyOf(room.number) && keyOf(legacy.bed) === keyOf(bed.label);
}

export async function hostelWorkspace(req) {
  const access = await getHostelAccess(req);
  requireManagement(access);
  const { schoolId, canConfigure, hostelIds } = access;
  const scope = scopeFor(schoolId, false);
  const editing = Boolean(scope && !scope.readOnly && !scope.legacy);
  const viewSession = scope?.sessionId;
  const allocationFilter = { schoolId, ...hostelFilter(access) };
  const [hostels, rooms, allocations, legacy] = await Promise.all([
    Hostel.find({ schoolId, ...(canConfigure ? {} : { _id: { $in: hostelIds } }) }).sort('name').lean(),
    HostelRoom.find(allocationFilter).sort('block number').lean(),
    viewSession ? HostelAllocation.find({
      ...allocationFilter, ...(editing ? { $or: [{ sessionId: viewSession }, { active: true }] } : { sessionId: viewSession }),
    }).select(allocationFields).sort({ createdAt: -1 }).lean() : [],
    canConfigure && scope ? HostelOccupancy.find({ schoolId, sessionId: viewSession || null, ...unresolved }).sort('studentName').lean() : [],
  ]);
  const assignedWardenIds = hostels.flatMap((hostel) => hostel.wardens);
  const [staff, eligible] = await Promise.all([
    User.find({ schoolId, isActive: { $ne: false }, ...(!canConfigure && { _id: { $in: assignedWardenIds } }) })
      .select('name role employeeId').sort('name').lean(),
    editing && allocations.length ? StudentSessionHistory.aggregate([
      { $match: { schoolId, sessionId: new mongoose.Types.ObjectId(viewSession), status: 'active', studentId: { $in: allocations.filter((row) => row.active).map((row) => row.studentId) } } },
      ...activeStudentLookup(schoolId),
      { $project: { studentId: 1 } },
    ]) : [],
  ]);
  const eligibleIds = new Set(eligible.map((item) => idOf(item.studentId)));
  const activeBeds = new Map(allocations.filter((row) => row.active).map((row) => [idOf(row.bedId), row]));
  const hostelsById = new Map(hostels.map((hostel) => [idOf(hostel), hostel]));
  const roomById = new Map(rooms.map((room) => [idOf(room), room]));
  // Keep current legacy beds out of the vacancy list for wardens as well.
  const legacyHolds = editing && !canConfigure
    ? await HostelOccupancy.find({ schoolId, sessionId: viewSession, ...unresolved }).select('block room bed').lean()
    : legacy;
  const bedMatches = new Map();
  const inventory = rooms.map((room) => ({
    ...room,
    beds: room.beds.map((bed) => {
      const allocation = activeBeds.get(idOf(bed));
      const matches = editing || canConfigure
        ? legacyHolds.filter((row) => matchingLocation(row, hostelsById.get(idOf(room.hostelId)), room, bed))
        : [];
      for (const match of matches) {
        const id = idOf(match);
        bedMatches.set(id, [...(bedMatches.get(id) || []), idOf(bed)]);
      }
      const priorSession = allocation && idOf(allocation.sessionId) !== viewSession;
      const status = allocation ? (priorSession ? 'pendingRollover' : 'assigned')
        : bed.outOfService ? 'outOfService' : editing && matches.length ? 'legacyHold' : 'available';
      return { ...bed, status };
    }),
  }));
  return {
    hostels, rooms: inventory, staff, canConfigure, canAllocate: editing, session: scope?.session,
    allocations: allocations.map((row) => {
      const room = editing && row.active && roomById.get(idOf(row.roomId));
      const bed = room && room.beds.find((item) => idOf(item) === idOf(row.bedId));
      return {
        ...row,
        status: allocationStatus(row),
        assignedAt: row.assignedAt || row.createdAt,
        ...(bed && {
          hostelName: hostelsById.get(idOf(room.hostelId)).name,
          block: room.block, room: room.number, bed: bed.label, roomType: room.roomType,
        }),
        needsRollover: Boolean(editing && row.active && idOf(row.sessionId) !== viewSession),
        eligible: eligibleIds.has(idOf(row.studentId)),
      };
    }),
    legacy: legacy.map((row) => ({ ...row, matchingBedIds: bedMatches.get(idOf(row)) || [] })),
  };
}

export function saveHostel(req) {
  return write(req, { setup: true, activeSession: false }, async (access) => {
    const { schoolId, session } = access;
    const { id } = req.params;
    const name = clean(req.body.name, 'hostel name', true);
    const address = clean(req.body.address, 'address', true, 500);
    const description = clean(req.body.description, 'description', false, 1000);
    const category = req.body.category;
    if (!hostelCategories.has(category)) throw academicError('Choose Boys, Girls, or Co-ed.');
    const capacity = capacityOf(req.body.capacity);
    const contactPhone = clean(req.body.contactPhone, 'hostel phone', false, 40);
    if (contactPhone && !/^\+?[\d\s().-]+$/.test(contactPhone)) throw academicError('Enter a valid hostel phone.');
    const { wardens = [], updatedAt } = req.body;
    if (!Array.isArray(wardens) || !wardens.length || wardens.some((value) => !isId(value)) || wardens.length > 30) {
      throw academicError('Choose active staff accounts for the hostel.');
    }
    const ids = [...new Set(wardens.map(idOf))];
    const staffCount = await User.countDocuments({ schoolId, _id: { $in: ids }, isActive: { $ne: false } }).session(session);
    if (staffCount !== ids.length) throw academicError('Choose active staff accounts from this school.');
    const data = { name, nameKey: keyOf(name), address, category, capacity, description, contactPhone, wardens: ids };
    if (!id) {
      const [hostel] = await Hostel.create([{ schoolId, ...data }], { session });
      await recordHostelEvent(access, hostel, 'hostelCreated');
      return hostel;
    }
    const hostel = await getHostel(access, id);
    if (updatedAt && hostel.updatedAt.toISOString() !== updatedAt) throw academicError('This hostel changed. Reload the page.', 409);
    if (capacity < await configuredBeds(access, hostel._id)) throw academicError('Capacity cannot be lower than the number of configured beds.', 409);
    const gender = hostelGenders[category];
    if (gender && category !== hostel.category) {
      const active = await HostelAllocation.distinct('studentId', { schoolId, hostelId: hostel._id, active: true }).session(session);
      const matching = await Student.countDocuments({ schoolId, _id: { $in: active }, gender }).session(session);
      if (matching !== active.length) throw academicError('Transfer affected students or record their departure before changing hostel eligibility.', 409);
    }
    hostel.set(data);
    if (!hostel.isModified()) return hostel;
    await hostel.save({ session });
    await recordHostelEvent(access, hostel, 'hostelUpdated');
    return hostel;
  });
}

export function saveHostelRoom(req) {
  const activeSession = Array.isArray(req.body.beds) && req.body.beds.some((bed) => Boolean(bed?.student));
  return write(req, { setup: true, activeSession }, async (access) => {
    const { schoolId, session } = access;
    const { id } = req.params;
    const { hostelId, beds } = req.body;
    if (id && !isId(id)) throw academicError('Room not found.', 404);
    const hostel = await getHostel(access, hostelId);
    if (!Array.isArray(beds) || !beds.length || beds.length > 100) throw academicError('Enter between 1 and 100 beds for the room.');
    const room = id ? await HostelRoom.findOne({ schoolId, hostelId, _id: id }).session(session) : new HostelRoom({ schoolId, hostelId });
    if (!room) throw academicError('Room not found.', 404);
    if (id && req.body.updatedAt && room.updatedAt.toISOString() !== req.body.updatedAt) {
      throw academicError('This room changed. Reload the page.', 409);
    }
    const occupied = id ? await HostelAllocation.distinct('bedId', { schoolId, roomId: id, active: true }).session(session) : [];
    const existingBeds = new Map(room.beds.map((bed) => [idOf(bed), bed]));
    const nextBeds = beds.map((bed) => {
      if (!bed || typeof bed !== 'object') throw academicError('Enter a valid bed.');
      const { _id, label, outOfService } = bed;
      if (_id && (!isId(_id) || !existingBeds.has(idOf(_id)))) throw academicError('The room beds changed. Reload the page.', 409);
      return { _id, label: clean(label, 'bed label', true, 40), outOfService: outOfService === true };
    });
    const keptBeds = new Set(nextBeds.filter((bed) => bed._id).map((bed) => idOf(bed._id)));
    const assignedBeds = new Set(occupied.map(idOf));
    if (new Set(nextBeds.map((bed) => keyOf(bed.label))).size !== nextBeds.length ||
      keptBeds.size !== nextBeds.filter((bed) => bed._id).length) throw academicError('Bed labels must be unique in a room.', 409);
    if (occupied.some((bedId) => !keptBeds.has(idOf(bedId))) ||
      nextBeds.some((bed) => bed.outOfService && assignedBeds.has(idOf(bed._id)))) {
      throw academicError('Transfer residents or record their departure before removing or blocking their beds.', 409);
    }
    const block = clean(req.body.block, 'block');
    const number = clean(req.body.number, 'room number', true, 40);
    const { roomType } = req.body;
    if (!roomTypes.has(roomType)) throw academicError('Choose Normal or Premium.');
    const duplicate = await HostelRoom.exists({ schoolId, hostelId, number, _id: { $ne: room._id } })
      .collation({ locale: 'en', strength: 2 }).session(session);
    if (duplicate) throw academicError('This room number already exists in this hostel.', 409);
    if (hostel.capacity && nextBeds.length + await configuredBeds(access, hostel._id, room._id) > hostel.capacity) {
      throw academicError('The total number of beds would exceed hostel capacity.', 409);
    }
    const features = clean(req.body.features, 'room features', false, 750);
    room.set({ block, number, roomType, features, beds: nextBeds, roomKey: JSON.stringify([keyOf(block), keyOf(number)]) });
    const changed = room.isNew || room.isModified();
    if (changed) {
      await room.save({ session });
      await recordHostelEvent(access, hostel, id ? 'roomUpdated' : 'roomCreated', room);
    }
    if (activeSession) await assignStudents(req, access, room, beds.flatMap((bed, index) =>
      bed.student ? [{ ...bed.student, bedId: room.beds[index]._id }] : []));
    return room;
  });
}

export function assignHostelRoom(req) {
  return write(req, {}, async (access) => {
    const { schoolId, session } = access;
    if (!isId(req.params.id)) throw academicError('Room not found.', 404);
    const room = await HostelRoom.findOne({ schoolId, _id: req.params.id, ...hostelFilter(access) }).session(session);
    if (!room) throw academicError('Room not found.', 404);
    return assignStudents(req, access, room, req.body.assignments);
  });
}

async function assignStudents(req, access, room, assignments) {
  if (!Array.isArray(assignments) || !assignments.length || assignments.length > room.beds.length) {
    throw academicError('Choose students for the available beds.');
  }
  const students = new Set();
  const beds = new Set();
  for (const entry of assignments) {
    if (!isId(entry?.studentId) || !isId(entry?.bedId) || !room.beds.id(entry.bedId)) {
      throw academicError('Choose an enrolled student and bed in this room.');
    }
    students.add(idOf(entry.studentId));
    beds.add(idOf(entry.bedId));
  }
  if (students.size !== assignments.length || beds.size !== assignments.length) {
    throw academicError('Each student and bed can be selected only once.', 409);
  }
  const assignedAt = hostelEventDate(req.body.assignedOn, 'assignment date');
  const results = [];
  for (const { studentId, bedId } of assignments) {
    results.push(await assignBed(req, access, studentId, bedId, assignedAt));
  }
  return results;
}

function activeStudentLookup(schoolId) {
  return [
    { $lookup: { from: Student.collection.name, localField: 'studentId', foreignField: '_id', as: 'profile' } },
    { $unwind: '$profile' },
    { $match: { 'profile.schoolId': schoolId, 'profile.status': 'active', 'profile.isActive': { $ne: false } } },
  ];
}

export async function searchHostelStudents(req) {
  const access = await getHostelAccess(req);
  requireManagement(access);
  const { schoolId } = access;
  const scope = scopeFor(schoolId);
  if (scope.readOnly || scope.legacy) throw academicError('Choose the active academic session.', 409);
  const search = clean(req.query.search, 'student search');
  const pagination = parsePagination({ page: req.query.page, limit: req.query.limit });
  const hostel = req.query.hostelId ? await getHostel(access, req.query.hostelId) : null;
  const gender = hostelGenders[hostel?.category];
  const [result] = await StudentSessionHistory.aggregate([
    { $match: { schoolId, status: 'active', sessionId: new mongoose.Types.ObjectId(scope.sessionId) } },
    ...activeStudentLookup(schoolId),
    { $match: { ...(gender && { 'profile.gender': gender }), ...buildSearchFilter(search, ['profile.name', 'profile.admissionNumber']) } },
    { $lookup: {
      from: HostelAllocation.collection.name, localField: 'studentId', foreignField: 'studentId', as: 'activeAllocation',
      pipeline: [{ $match: { schoolId, active: true } }, { $project: { _id: 1 } }],
    } },
    { $lookup: {
      from: HostelOccupancy.collection.name, localField: 'studentId', foreignField: 'studentId', as: 'legacyAllocation',
      pipeline: [{ $match: { schoolId, sessionId: new mongoose.Types.ObjectId(scope.sessionId), ...unresolved } }, { $project: { _id: 1 } }],
    } },
    { $match: { 'activeAllocation.0': { $exists: false }, 'legacyAllocation.0': { $exists: false } } },
    { $facet: {
      rows: [
        { $sort: { 'profile.name': 1, _id: 1 } }, { $skip: pagination.skip }, { $limit: pagination.limit },
        { $project: { _id: '$studentId', name: '$profile.name', admissionNumber: '$profile.admissionNumber', className: 1, sectionName: 1 } },
      ],
      total: [{ $count: 'value' }],
    } },
  ]);
  const page = paginateResult(result.rows, result.total[0]?.value || 0, pagination);
  return { students: page.data, pagination: page.pagination };
}

async function activeEnrollment(req, access, studentId) {
  const { schoolId, session, store } = access;
  const enrollment = await findScopedEnrollment(req, studentId, store);
  const student = enrollment?.status === 'active'
    ? await Student.findOne({ _id: studentId, schoolId, ...liveStudent }).select('name admissionNumber gender').session(session || null).lean() : null;
  return student ? { enrollment, student } : null;
}

function eligibleHostel(category, gender) {
  return !hostelGenders[category] || hostelGenders[category] === gender;
}

async function enrollmentFor(req, access, studentId, hostelCategory) {
  const { schoolId, scope } = access;
  if (!isId(studentId)) throw academicError('Choose a student enrolled in the active session.');
  const active = await activeEnrollment(req, access, studentId);
  if (!active) throw academicError('Choose an active student enrolled in this session.', 409);
  const { enrollment, student } = active;
  if (!eligibleHostel(hostelCategory, student.gender)) throw academicError('This student is not eligible for the selected hostel category.', 409);
  return {
    schoolId, studentId, sessionId: scope.sessionId, sessionName: scope.session.sessionName,
    studentName: student.name, admissionNumber: student.admissionNumber,
    className: enrollment.className, sectionName: enrollment.sectionName,
  };
}

async function newAssignmentStatus(req, access, scope, studentId) {
  const { schoolId, canConfigure } = access;
  const [active, assigned, legacy] = await Promise.all([
    activeEnrollment(req, access, studentId),
    HostelAllocation.exists({ schoolId, studentId, active: true }),
    HostelOccupancy.exists({ schoolId, studentId, sessionId: scope.sessionId, ...unresolved }),
  ]);
  if (!active) return { reason: 'Only students with an active enrollment can be assigned a bed.' };
  if (assigned || legacy) {
    const reason = !canConfigure ? 'This student is unavailable for a new hostel allocation.'
      : assigned ? 'This student already has an active hostel allocation.'
        : 'Review this student’s previous hostel allocation first.';
    return { reason };
  }
  return { student: active.student };
}

export async function availableStudentBeds(req) {
  const access = await getHostelAccess(req);
  requireManagement(access);
  const { schoolId, canConfigure, hostelIds } = access;
  const scope = scopeFor(schoolId);
  if (scope.readOnly || scope.legacy) throw academicError('Choose the active academic session.', 409);
  const { studentId } = req.params;
  if (!isId(studentId) || !await Student.exists({ schoolId, _id: studentId })) throw academicError('Student not found.', 404);
  const { student, reason } = await newAssignmentStatus(req, access, scope, studentId);
  if (reason) throw academicError(reason, 409);

  const hostels = await Hostel.find({ schoolId, ...(!canConfigure && { _id: { $in: hostelIds } }) })
    .select('name category').sort({ name: 1, _id: 1 }).lean();
  const eligible = hostels.filter((hostel) => eligibleHostel(hostel.category, student.gender));
  if (!eligible.length) return { hostels: [] };
  const filter = { schoolId, hostelId: { $in: eligible.map((hostel) => hostel._id) } };
  const [rooms, occupied, legacy] = await Promise.all([
    HostelRoom.find(filter).select('hostelId block number roomType beds').sort({ block: 1, number: 1 }).lean(),
    HostelAllocation.distinct('bedId', { ...filter, active: true }),
    HostelOccupancy.find({ schoolId, sessionId: scope.sessionId, ...unresolved }).select('block room bed').lean(),
  ]);
  const occupiedIds = new Set(occupied.map(idOf));
  return {
    hostels: eligible.map((hostel) => ({
      _id: hostel._id, name: hostel.name,
      rooms: rooms.filter((room) => idOf(room.hostelId) === idOf(hostel)).map(({ beds, _id, block, number, roomType }) => ({
        _id, block, number, roomType,
        beds: beds.filter((bed) => !bed.outOfService && !occupiedIds.has(idOf(bed)) &&
          !legacy.some((hold) => matchingLocation(hold, hostel, { block, number }, bed)))
          .map(({ _id: bedId, label }) => ({ _id: bedId, label })),
      })).filter((room) => room.beds.length),
    })).filter((hostel) => hostel.rooms.length),
  };
}

async function bedPlacement(access, bedId, { legacyId, historical = false } = {}) {
  const { schoolId, scope, session } = access;
  if (!isId(bedId)) throw academicError('Choose a hostel bed.');
  const room = await HostelRoom.findOne({ schoolId, ...hostelFilter(access), 'beds._id': bedId }).session(session);
  if (!room) throw academicError('Bed not found.', 404);
  const hostel = await Hostel.findOne({ schoolId, _id: room.hostelId }).session(session).lean();
  if (!hostel) throw academicError('Hostel not found.', 404);
  const bed = room.beds.id(bedId);
  if (!historical && (bed.outOfService || await HostelAllocation.exists({ schoolId, bedId, active: true }).session(session))) {
    throw academicError('This bed is no longer available.', 409);
  }
  if (!historical) {
    const legacy = await HostelOccupancy.find({ schoolId, sessionId: scope.sessionId, ...unresolved, ...(legacyId ? { _id: { $ne: legacyId } } : {}) })
      .select('block room bed').session(session).lean();
    if (legacy.some((row) => matchingLocation(row, hostel, room, bed))) throw academicError('Review the previous allocation for this bed first.', 409);
  }
  return { category: hostel.category, hostelId: hostel._id, hostelName: hostel.name, roomId: room._id, bedId, block: room.block, room: room.number, bed: bed.label, roomType: room.roomType };
}

async function createAllocation(access, data, { assignedAt } = {}) {
  let effectiveStart = assignedAt || data.createdAt || new Date();
  if (data.active !== false && !data.previousAllocationId) {
    const student = { schoolId: access.schoolId, studentId: data.studentId };
    if (await HostelAllocation.exists({ ...student, active: true }).session(access.session)) {
      throw academicError('This student already has an active hostel allocation.', 409);
    }
    const previous = await HostelAllocation.findOne({ ...student, endedAt: { $type: 'date' } })
      .sort({ endedAt: -1, _id: -1 }).select('endedAt').session(access.session).lean();
    if (previous) data.previousAllocationId = previous._id;
    if (assignedAt) {
      const pastBed = await HostelAllocation.findOne({ schoolId: access.schoolId, bedId: data.bedId, endedAt: { $type: 'date' } })
        .sort({ endedAt: -1 }).select('endedAt').session(access.session).lean();
      effectiveStart = onOrAfterHostelDay(effectiveStart, previous?.endedAt, 'The assignment date overlaps a previous assignment for this student.');
      effectiveStart = onOrAfterHostelDay(effectiveStart, pastBed?.endedAt, 'The assignment date overlaps a previous assignment for this bed.');
    }
  }
  const [allocation] = await HostelAllocation.create([{
    openedBy: access.actor, openedByName: access.actorName, active: true, status: 'assigned', assignedAt: effectiveStart, ...data,
  }], { session: access.session });
  return allocation;
}

async function assignBed(req, access, studentId, bedId, assignedAt) {
  const { schoolId, scope, session } = access;
  const { category, ...placement } = await bedPlacement(access, bedId);
  const student = await enrollmentFor(req, access, studentId, category);
  if (await HostelOccupancy.exists({ schoolId, sessionId: scope.sessionId, studentId, ...unresolved }).session(session)) {
    throw academicError('Review this student’s previous hostel allocation first.', 409);
  }
  return createAllocation(access, { ...student, ...placement }, { assignedAt });
}

export function assignHostelBed(req) {
  return write(req, {}, (access) => assignBed(req, access, req.body.studentId, req.body.bedId,
    hostelEventDate(req.body.assignedOn, 'assignment date')));
}

export function changeHostelAllocation(req, action) {
  return write(req, {}, async (access) => {
    const { schoolId, scope, session, actor } = access;
    if (!isId(req.params.id)) throw academicError('Allocation not found.', 404);
    const row = await HostelAllocation.findOne({ schoolId, _id: req.params.id, ...hostelFilter(access) })
      .select(allocationFields).session(session);
    if (!row) throw academicError('Allocation not found.', 404);
    if (!row.active || allocationStatus(row) !== req.body.expectedStatus) throw academicError('The allocation changed. Reload the page.', 409);
    const pending = idOf(row.sessionId) !== scope.sessionId;
    const now = new Date();
    const endAudit = { endedBy: actor, endedByName: access.actorName, endedRecordedAt: now };
    const reason = clean(req.body.reason, 'reason', false, 300);
    /* Temporarily disabled with the attendance-style hostel workflow.
    if (action === 'release') {
      row.set({ active: false, status: row.status === 'reserved' ? 'cancelled' : 'checkedOut', endedAt: now, endedBy: actor, endReason: reason });
      return row.save({ session });
    }
    */
    const assignedAt = row.assignedAt || row.createdAt;
    if (action === 'leave') {
      const endedAt = onOrAfterHostelDay(hostelEventDate(req.body.leftOn, 'departure date', now), assignedAt,
        'The departure date cannot be before the assignment date.');
      row.set({ active: false, status: 'left', assignedAt, endedAt, endReason: reason, ...endAudit });
      return row.save({ session });
    }
    if (pending !== (action === 'continue')) throw academicError('Review the allocation for the active session first.', 409);
    const current = await HostelRoom.findOne({ schoolId, _id: row.roomId, 'beds._id': row.bedId }).session(session);
    if (!current) throw academicError('The allocated bed is no longer configured.', 409);
    const hostel = await getHostel(access, row.hostelId);
    /* Temporarily disabled with the attendance-style hostel workflow.
    if (action === 'check-in') {
      if (row.status !== 'reserved') throw academicError('Only a reservation can be checked in.', 409);
      await enrollmentFor(req, access, row.studentId, hostel.category);
      row.set({ status: 'checkedIn', checkedInAt: now, checkedInBy: actor });
      return row.save({ session });
    }
    */
    const { category, ...placement } = action === 'transfer' ? await bedPlacement(access, req.body.bedId) : {
      category: hostel.category,
      hostelId: hostel._id, hostelName: hostel.name, roomId: current._id, bedId: row.bedId,
      block: current.block, room: current.number, bed: current.beds.id(row.bedId).label, roomType: current.roomType,
    };
    const student = await enrollmentFor(req, access, row.studentId, category);
    row.set({ active: false, status: action === 'transfer' ? 'transferred' : 'continued', assignedAt, endedAt: now, endReason: reason, ...endAudit });
    await row.save({ session });
    return createAllocation(access, { ...student, ...placement, previousAllocationId: row._id }, { assignedAt: now });
  });
}

export function reviewLegacyAllocation(req) {
  return write(req, { setup: true, activeSession: false }, async (access) => {
    const { schoolId, scope, session, actor } = access;
    if (!scope || !isId(req.params.id)) throw academicError('Legacy allocation not found.', 404);
    const row = await HostelOccupancy.findOne({ schoolId, _id: req.params.id, sessionId: scope.sessionId || null, ...unresolved }).session(session);
    if (!row) throw academicError('Legacy allocation already reviewed or unavailable.', 409);
    const now = new Date();
    const current = scope.sessionId && Boolean(await AcademicSession.exists({ schoolId, _id: scope.sessionId, isCurrent: true }).session(session));
    if (!scope.readOnly && !current) throw academicError('The active academic session changed. Reload the page.', 409);
    const reason = clean(req.body.reason, 'review reason', !req.body.bedId, 300);
    let allocation = null;
    if (req.body.bedId) {
      if (scope.legacy) throw academicError('The academic session for this record is unassigned.', 409);
      const { category, ...placement } = await bedPlacement(access, req.body.bedId, { legacyId: row._id, historical: !current });
      const student = current ? await enrollmentFor(req, access, row.studentId, category) : {
        schoolId, sessionId: scope.sessionId, sessionName: scope.session.sessionName,
        studentId: row.studentId, studentName: row.studentName, className: row.className,
      };
      allocation = await createAllocation(access, {
        ...student, ...placement, legacyId: row._id, createdAt: row.createdAt || now,
        ...(!current && { active: false, status: 'legacy' }),
      });
    }
    row.set({ reviewedAt: now, reviewedBy: actor, reviewReason: reason });
    await row.save({ session });
    return allocation;
  });
}

export async function hostelHistory(req) {
  const access = await getHostelAccess(req);
  requireManagement(access);
  const { schoolId } = access;
  const { roomId } = req.query;
  const hostel = req.params.id ? await getHostel(access, req.params.id) : null;
  if (roomId && (!hostel || !isId(roomId) || !await HostelRoom.exists({ schoolId, hostelId: hostel._id, _id: roomId }))) {
    throw academicError('Room not found.', 404);
  }
  const match = { schoolId, ...(hostel ? { hostelId: hostel._id } : hostelFilter(access)),
    ...(roomId && { roomId: new mongoose.Types.ObjectId(roomId) }) };
  const pagination = parsePagination({ page: req.query.page, limit: req.query.limit });
  const [result] = await HostelAllocation.aggregate([
    { $match: match },
    { $project: {
      kind: { $literal: 'allocation' }, hostelId: 1, hostelName: 1, studentName: 1, admissionNumber: 1, sessionName: 1, block: 1, room: 1, bed: 1,
      status: 1, active: 1, assignedAt: { $ifNull: ['$assignedAt', '$createdAt'] },
      assignedRecordedAt: { $cond: [{ $ifNull: ['$legacyId', false] }, null, '$createdAt'] }, endedRecordedAt: 1,
      openedBy: 1, openedByName: 1, endedBy: 1, endedByName: 1,
      endedAt: 1, endReason: 1, previousAllocationId: 1,
      date: { $ifNull: ['$endedRecordedAt', '$endedAt', '$createdAt', '$assignedAt'] },
    } },
    { $unionWith: {
      coll: HostelEvent.collection.name,
      pipeline: [
        { $match: match },
        { $project: { kind: { $literal: 'event' }, hostelId: 1, hostelName: 1, block: 1, room: 1, event: 1, actorId: 1, actorName: 1, date: '$createdAt' } },
      ],
    } },
    { $facet: {
      rows: [{ $sort: { date: -1, _id: -1 } }, { $skip: pagination.skip }, { $limit: pagination.limit }],
      total: [{ $count: 'value' }],
    } },
  ]);
  const rows = await resolveHistoryActors(schoolId, result.rows);
  return paginateResult(rows, result.total[0]?.value || 0, pagination);
}

async function resolveHistoryActors(schoolId, rows) {
  const userIds = rows.flatMap((row) => [
    !row.actorName && row.actorId,
    !row.openedByName && row.openedBy,
    !row.endedByName && row.endedBy,
  ].filter(Boolean));
  const hostelIds = rows.filter((row) => !row.hostelName).map((row) => row.hostelId);
  const [users, hostels] = await Promise.all([
    userIds.length ? User.find({ schoolId, _id: { $in: userIds } }).select('name').lean() : [],
    hostelIds.length ? Hostel.find({ schoolId, _id: { $in: hostelIds } }).select('name').lean() : [],
  ]);
  const userNames = new Map(users.map((user) => [idOf(user), user.name]));
  const hostelNames = new Map(hostels.map((hostel) => [idOf(hostel), hostel.name]));
  return rows.map((row) => {
    const { actorId, openedBy, endedBy, ...entry } = row;
    return {
      ...entry,
      hostelName: row.hostelName || hostelNames.get(idOf(row.hostelId)),
      ...(row.kind === 'allocation' ? {
        status: allocationStatus(row),
        openedByName: row.openedByName || userNames.get(idOf(openedBy)),
        endedByName: row.endedByName || userNames.get(idOf(endedBy)),
      } : { actorName: row.actorName || userNames.get(idOf(actorId)) }),
    };
  });
}
export async function studentHostel(req, { studentId, identifier } = {}) {
  const access = await getHostelAccess(req);
  const { schoolId, actor, student, canManage, canConfigure } = access;
  const scope = scopeFor(schoolId, false);
  if (!scope || scope.legacy) return { allocation: null };
  if (!student && !canManage) throw academicError('You do not have access to student hostel details.', 403);
  if (student && studentId && studentId !== actor && studentId !== 'me') throw academicError('Student not found.', 404);
  const lookup = clean(identifier, 'student identifier');
  const target = student ? actor : studentId;
  const findByName = !target && lookup;
  const profiles = target && isId(target)
    ? await Student.find({ schoolId, _id: target }).select('name admissionNumber className section').lean()
    : findByName ? await Student.find({
      schoolId, $or: [
        ...(isId(lookup) ? [{ _id: lookup }] : []), { admissionNumber: lookup.toUpperCase() }, { name: lookup },
      ],
    }).collation({ locale: 'en', strength: 2 }).select('name admissionNumber className section').limit(2).lean() : [];
  if (profiles.length !== 1) throw academicError(profiles.length ? 'Use the student’s admission number to identify them.' : 'Student not found.', 404);
  const profile = profiles[0];
  if (student && lookup && ![idOf(profile), keyOf(profile.admissionNumber), keyOf(profile.name)].includes(keyOf(lookup))) {
    throw academicError('Student not found.', 404);
  }
  const sessionFilter = scope.readOnly ? { sessionId: scope.sessionId } : { active: true };
  const row = await HostelAllocation.findOne({
    schoolId, studentId: profile._id, ...sessionFilter, ...(student ? {} : hostelFilter(access)),
  }).sort({ createdAt: -1 }).lean();
  if (!row && !student && studentId && !scope.readOnly) {
    const { reason } = await newAssignmentStatus(req, access, scope, profile._id);
    return { student: profile, allocation: null, assignment: { canAssign: !reason, reason } };
  }
  if (!row && !student && !canConfigure) throw academicError('No allocation was found in your assigned hostels.', 404);
  if (!row) return { student: profile, allocation: null };
  const hostel = await Hostel.findOne({ schoolId, _id: row.hostelId }).select('name contactPhone wardens').lean();
  const room = row.active && !scope.readOnly
    ? await HostelRoom.findOne({ schoolId, _id: row.roomId }).select('block number roomType beds').lean() : null;
  const bed = room?.beds.find((item) => idOf(item) === idOf(row.bedId));
  const wardens = hostel ? await User.find({ schoolId, _id: { $in: hostel.wardens }, isActive: { $ne: false } }).select('name').lean() : [];
  const allocation = {
    status: allocationStatus(row), sessionName: row.sessionName,
    assignedAt: row.assignedAt || row.createdAt, endedAt: row.endedAt,
    needsRollover: Boolean(!scope.readOnly && idOf(row.sessionId) !== scope.sessionId),
    hostelName: room && hostel ? hostel.name : row.hostelName,
    block: room ? room.block : row.block, room: room ? room.number : row.room,
    roomType: room ? room.roomType : row.roomType, bed: bed ? bed.label : row.bed,
    contactPhone: hostel?.contactPhone, wardens: wardens.map((warden) => warden.name),
  };
  return { student: profile, allocation };
}
