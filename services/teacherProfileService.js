import Teacher from '../models/Teacher.js';
import { checkFallback } from '../config/db.js';
import { getSchool, readProcurement, writeProcurement } from './procurementStore.js';
import { generateSecurePassword, isValidObjectId, normalizeEmail } from '../utils/commonUtil.js';
import { procurementError, recordId, recordIds } from '../utils/procurementValues.js';

const facultyRoles = ['teacher', 'head-teacher', 'hod', 'coordinator'];
const managerRoles = ['super-admin', 'superadmin', 'school-admin', 'admin', 'principal'];
const loginRestrictions = ['none', 'school-network', 'office-hours'];
const loginRestrictionAliases = new Map([
  ['no-restriction', 'none'],
  ['no-restrictions', 'none'],
  ['school-network-only', 'school-network'],
  ['office-hours-only', 'office-hours'],
]);
const requiredFields = ['firstName', 'lastName', 'email', 'phone', 'designation'];
const textFields = [
  ...requiredFields, 'employeeId', 'alternatePhone', 'address', 'gender', 'bloodGroup',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'aadhaarNumber',
  'qualification', 'specialization', 'department', 'experience', 'employmentType', 'role', 'status', 'loginRestriction',
];
const privateFields = ['aadhaarNumber', 'aadhaarFileName', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation'];
const idOf = (value) => String(value?.toHexString?.() || value?._id || value?.id || value || '');

export function canViewPrivateTeacherDetails(req, teacher) {
  const user = req.user;
  const role = String(user?.role || '').trim().toLowerCase().replaceAll('_', '-');
  return managerRoles.includes(role) || Boolean(
    (user?.profileId && idOf(user.profileId) === idOf(teacher)) ||
    (teacher.user && idOf(teacher.user) === idOf(user))
  );
}

export function teacherProfileResponse(teacher, showPrivate = false) {
  const profile = { ...(teacher.toObject ? teacher.toObject() : teacher) };
  for (const key of ['photoFile', 'aadhaarFile', 'password', 'confirmPassword', 'tempPassword', 'refreshToken', 'userDetails', 'permissions']) delete profile[key];
  if (!showPrivate) for (const key of privateFields) delete profile[key];
  return profile;
}

export async function findTeacherProfile(req, id, fileField) {
  const store = readProcurement(req);
  if (checkFallback()) {
    return await store.get('teachers', id) || await store.one('teachers', { employeeId: id.toUpperCase() });
  }
  const filter = { schoolId: getSchool(req), ...(isValidObjectId(id) ? { _id: id } : { employeeId: id.toUpperCase() }) };
  const query = Teacher.findOne(filter);
  if (fileField) query.select('+' + fileField);
  return query.lean();
}

function booleanValue(value, field) {
  if ([true, 'true', 'yes', '1', 1].includes(value)) return true;
  if ([false, 'false', 'no', '0', 0, '', null].includes(value)) return false;
  throw procurementError(field + ' must be true or false.');
}

function profileFields(raw, creating) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw procurementError('Enter a valid teacher record.');
  const input = { ...raw };
  if (creating && !input.firstName && typeof input.name === 'string') {
    const [firstName, ...last] = input.name.trim().split(/\s+/);
    input.firstName = firstName;
    input.lastName ||= last.join(' ') || '-';
  }
  if (!Object.hasOwn(input, 'phone') && Object.hasOwn(input, 'contactNumber')) input.phone = input.contactNumber;
  if (!Object.hasOwn(input, 'experience') && Object.hasOwn(input, 'experienceYears')) input.experience = input.experienceYears;
  const fields = {};
  for (const key of textFields) {
    if (!Object.hasOwn(input, key)) continue;
    fields[key] = String(input[key] ?? '').trim();
  }
  if ('email' in fields) fields.email = normalizeEmail(fields.email);
  if ('employeeId' in fields) fields.employeeId = fields.employeeId.toUpperCase();
  if (creating) {
    fields.role ||= 'teacher';
    fields.status ||= 'active';
    fields.loginRestriction ||= 'none';
  }
  for (const key of requiredFields) {
    if (creating && key === 'email' && !fields.email) continue;
    if ((creating || key in fields) && !fields[key]) throw procurementError('First name, last name, email, phone, and designation are required.');
  }
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw procurementError('Enter a valid teacher email.');
  if ('role' in fields && !facultyRoles.includes(fields.role)) throw procurementError('Choose a faculty role.');
  if ('status' in fields && !['active', 'inactive'].includes(fields.status)) throw procurementError('Choose active or inactive status.');
  if ('loginRestriction' in fields) {
    const key = fields.loginRestriction.toLowerCase().replace(/[\s_\p{Pd}]+/gu, '-');
    const restriction = loginRestrictionAliases.get(key) ?? key;
    if (!loginRestrictions.includes(restriction)) {
      throw procurementError('Login restriction must be None, School network, or Office hours.');
    }
    fields.loginRestriction = restriction;
  }
  if ('gender' in fields && !['', 'Male', 'Female', 'Other'].includes(fields.gender)) throw procurementError('Choose a valid gender.');
  if (fields.aadhaarNumber) {
    fields.aadhaarNumber = fields.aadhaarNumber.replace(/[\s-]/g, '');
    if (!/^\d{12}$/.test(fields.aadhaarNumber)) throw procurementError('Enter a 12-digit Aadhaar number.');
  }
  for (const key of ['dob', 'joiningDate', 'accountExpiryDate']) {
    if (!Object.hasOwn(input, key)) continue;
    const source = input[key];
    const value = source ? new Date(source) : null;
    if (value && (Number.isNaN(value.valueOf()) ||
      (/^\d{4}-\d{2}-\d{2}$/.test(source) && value.toISOString().slice(0, 10) !== source))) {
      throw procurementError('Enter a valid date for ' + key + '.');
    }
    fields[key] = value?.toISOString() ?? null;
  }
  if (creating && !fields.joiningDate) fields.joiningDate = new Date().toISOString();
  if (Object.hasOwn(input, 'salary')) {
    const amount = Number(input.salary || 0);
    if (!Number.isFinite(amount) || amount < 0) throw procurementError('Enter a valid salary.');
    fields.salary = amount;
  }
  for (const key of ['forcePasswordChange', 'twoFactorEnabled']) {
    if (Object.hasOwn(input, key)) fields[key] = booleanValue(input[key], key);
  }
  return fields;
}

function attachmentFields(files = {}) {
  const fields = {};
  for (const [kind, field, metadata] of [
    ['photo', 'photoFile', 'photoName'], ['aadhaar', 'aadhaarFile', 'aadhaarFileName'],
  ]) {
    const file = files[kind]?.[0];
    if (!file) continue;
    const bytes = file.buffer;
    const magic = bytes.subarray(0, 12).toString('hex');
    let mimeType;
    if (kind === 'aadhaar' && magic.startsWith('255044462d')) mimeType = 'application/pdf';
    if (kind === 'photo') {
      if (magic.startsWith('ffd8ff')) mimeType = 'image/jpeg';
      else if (magic.startsWith('89504e470d0a1a0a')) mimeType = 'image/png';
      else if (magic.startsWith('52494646') && magic.endsWith('57454250')) mimeType = 'image/webp';
    }
    if (!mimeType) throw procurementError(kind === 'photo' ? 'Choose a JPG, PNG, or WebP photo.' : 'Choose a valid Aadhaar PDF.');
    const name = file.originalname.split(/[/\\]/).at(-1).replace(/[^\w.() -]/g, '_').slice(-120) || kind;
    fields[field] = { name, mimeType, data: bytes.toString('base64') };
    fields[metadata] = name;
  }
  return fields;
}

async function nextEmployeeId(store) {
  const pattern = /^TCH-\d+$/;
  const teachers = await store.find('teachers', { employeeId: pattern });
  const users = await store.find('users', { employeeId: pattern });
  const latest = [...teachers, ...users].reduce((max, item) => Math.max(max, Number(item.employeeId.slice(4))), 0);
  return 'TCH-' + String(latest + 1).padStart(4, '0');
}

async function ensureTeacherIdentity(store, profile, teacher) {
  for (const [collection, fields, existingId] of [
    ['teachers', { employeeId: profile.employeeId, email: profile.email }, idOf(teacher)],
    ['users', { employeeId: profile.employeeId, email: profile.email, username: profile.employeeId?.toLowerCase() }, idOf(teacher?.user)],
  ]) {
    for (const [key, value] of Object.entries(fields)) {
      if (!value) continue;
      const match = await store.one(collection, { [key]: value });
      if (match && !recordIds(match).includes(existingId)) throw procurementError('Teacher employee ID or email already exists.', 409);
    }
  }
}

function accountFields(teacher) {
  return {
    username: teacher.employeeId.toLowerCase(), employeeId: teacher.employeeId, email: teacher.email,
    role: teacher.role, name: teacher.name,
    profileId: recordId(teacher), isActive: teacher.status === 'active',
    forcePasswordChange: teacher.forcePasswordChange, accountExpiryDate: teacher.accountExpiryDate,
    loginRestriction: teacher.loginRestriction, twoFactorEnabled: teacher.twoFactorEnabled,
  };
}

export async function registerTeacher(req, raw, { files, allowGeneratedPassword = false } = {}) {
  const profile = { ...profileFields(raw, true), ...attachmentFields(files) };
  profile.name = profile.firstName + ' ' + profile.lastName;
  const generate = raw.generateRandomPassword === true || (allowGeneratedPassword && !raw.password);
  const password = generate ? generateSecurePassword('Tch@') : raw.password;
  if (typeof password !== 'string' || password.trim().length < 6) throw procurementError('Use at least 6 characters for the password.');
  if (!generate && raw.confirmPassword !== undefined && raw.confirmPassword !== password) {
    throw procurementError('Password and confirmation must match.');
  }
  return writeProcurement(req, ['teachers', 'users'], async (store) => {
    await store.lockAcademicSettings();
    const employeeId = profile.employeeId || await nextEmployeeId(store);
    const fields = { ...profile, employeeId, email: profile.email || employeeId.toLowerCase() + '@school.local' };
    await ensureTeacherIdentity(store, fields);
    const teacher = await store.create('teachers', fields);
    const user = await store.create('users', { ...accountFields(teacher), password, tempPassword: password });
    const updated = await store.update('teachers', recordId(teacher), { user: recordId(user) });
    return { teacher: updated, password };
  });
}

export async function saveTeacherProfile(req, id, raw, files) {
  const changes = { ...profileFields(raw, false), ...attachmentFields(files) };
  return writeProcurement(req, ['teachers', 'users'], async (store) => {
    await store.lockAcademicSettings();
    const teacher = await store.get('teachers', id) || await store.one('teachers', { employeeId: id.toUpperCase() });
    if (!teacher) throw procurementError('Teacher record not found.', 404);
    const merged = { ...teacher, ...changes };
    if (Object.hasOwn(changes, 'firstName') || Object.hasOwn(changes, 'lastName')) {
      changes.name = [merged.firstName, merged.lastName].filter(Boolean).join(' ');
    }
    if (['email', 'employeeId'].some((key) => key in changes)) await ensureTeacherIdentity(store, merged, teacher);
    const updated = await store.update('teachers', recordId(teacher), changes);
    if (updated.user) await store.update('users', updated.user, accountFields(updated));
    return updated;
  });
}
