import School from '../models/School.js';
import CommonProduct from '../models/CommonProduct.js';
import CommonCategory from '../models/CommonCategory.js';
import RGESAdmin from '../models/RGESAdmin.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import { generateTokens } from '../middleware/auth.js';
import { invalidateSchoolsCache } from '../middleware/tenant.js';
import {
  classMasterGrades,
  configureSession,
  curriculumCollections,
  initializeSchoolCurriculum,
  orderedGrades,
  saveSchoolCurriculum,
  saveSessionConfiguration,
  schoolClassOptions,
  sessionsInDateOrder,
} from '../services/academicSessionService.js';
import { readProcurement, writeProcurement } from '../services/procurementStore.js';
import { checkFallback } from '../config/db.js';
import { escapeRegex } from '../utils/commonUtil.js';
import { procurementError } from '../utils/procurementValues.js';
import { sendCreated, sendError, sendSuccess, sendUnauthorized } from '../utils/responseUtil.js';

const trim = (value) => typeof value === 'string' ? value.trim() : '';
const cleanSlug = (value) => trim(value).toLowerCase();
const validSlug = (value) => /^[a-z0-9_]{3,30}$/.test(value);

function adminError(error, message) {
  if (error.statusCode) return { message: error.message, status: error.statusCode };
  if (error.code === 11000) {
    if (error.keyPattern?.sessionName && !error.keyPattern.schoolId) {
      return {
        message: 'A legacy database index requires session names to be unique across schools. Contact RGES support to update the index.',
        status: 409,
      };
    }
    return { message: 'A school or provisioning record with these values already exists.', status: 409 };
  }
  if (error.name === 'ValidationError') return { message: error.message, status: 400 };
  console.error(message, error.name, error.code);
  return { message, status: 500 };
}

const handle = (message, action) => async (req, res) => {
  try {
    return await action(req, res);
  } catch (error) {
    const failure = adminError(error, message);
    return sendError(res, failure.message, failure.status);
  }
};

function requireDatabase() {
  if (checkFallback()) throw procurementError('Connect to MongoDB to manage schools.', 503);
}

export const adminLogin = handle('Unable to sign in to RGES Admin.', async (req, res) => {
  requireDatabase();
  const email = trim(req.body?.email).toLowerCase();
  const password = req.body?.password;
  if (!email || typeof password !== 'string' || !password) {
    throw procurementError('Enter your email and password.');
  }

  let admin = await RGESAdmin.findOne({ email });
  const bootstrapEmail = trim(process.env.RGES_ADMIN_EMAIL).toLowerCase();
  const bootstrapPassword = process.env.RGES_ADMIN_PASSWORD;
  if (!admin && bootstrapEmail && bootstrapPassword && email === bootstrapEmail && password === bootstrapPassword) {
    try {
      admin = await RGESAdmin.create({ email, password, name: 'RGES Super Admin', permissions: ['all'] });
    } catch (error) {
      if (error.code !== 11000) throw error;
      admin = await RGESAdmin.findOne({ email });
    }
  }
  if (!admin?.isActive || !(await admin.comparePassword(password))) {
    return sendUnauthorized(res, 'Invalid credentials.');
  }

  admin.lastLogin = new Date();
  await admin.save();
  const { accessToken } = generateTokens(admin);
  const user = { id: admin._id, name: admin.name, email: admin.email, role: admin.role };
  return sendSuccess(res, 'Signed in.', { accessToken, user }, 200, { accessToken, user });
});

export const getOnboardingClasses = (_req, res) =>
  sendSuccess(res, undefined, { classes: classMasterGrades() });

export const onboardSchool = handle('Failed to onboard school.', async (req, res) => {
  requireDatabase();
  const body = req.body || {};
  const schoolName = trim(body.schoolName);
  const contactEmail = trim(body.contactEmail).toLowerCase();
  const collectionName = cleanSlug(body.collectionName);
  const schoolCode = trim(body.schoolCode).toUpperCase()
    || (collectionName || schoolName).replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase();
  const requestedId = trim(body.schoolId).toUpperCase();
  const adminEmail = trim(body.adminEmail).toLowerCase() || contactEmail;
  const adminName = trim(body.adminName) || schoolName + ' Admin';
  const password = body.adminPassword;
  const academicSession = body.academicSession;
  const address = body.address || {};

  if (!schoolName || !contactEmail) throw procurementError('Enter the school name and official email.');
  if (!validSlug(collectionName)) throw procurementError('Use 3–30 lowercase letters, digits, or underscores for the school slug.');
  if (!schoolCode) throw procurementError('Enter a school code.');
  if (typeof password !== 'string' || !password.trim()) throw procurementError('Enter a temporary school administrator password.');
  if (!academicSession?.startDate) throw procurementError('Enter the initial academic session start date.');

  let schoolId = requestedId || schoolCode + '001';
  if (!requestedId) {
    const registeredCode = await School.exists({ schoolCode });
    if (registeredCode) throw procurementError('The school code is already registered.', 409);
    let suffix = 1;
    while (await School.exists({ $or: [{ _id: schoolId }, { schoolId }] })) {
      suffix += 1;
      schoolId = schoolCode + String(suffix).padStart(3, '0');
    }
  }
  const tenant = { schoolId, user: req.user };
  const result = await writeProcurement(tenant, curriculumCollections, async (store, transaction) => {
    const conflict = await School.findOne({
      $or: [{ _id: schoolId }, { schoolId }, { schoolCode }, { collectionName }],
    }).session(transaction).lean();
    if (conflict) throw procurementError('The school slug, code, or ID is already registered.', 409);

    const school = new School({
      _id: schoolId,
      schoolId,
      schoolName,
      collectionName,
      schoolCode,
      contactEmail,
      schoolPhone: body.schoolPhone,
      alternatePhone: body.alternatePhone,
      address,
      affiliationNumber: body.affiliationNumber,
      board: body.board,
      subscriptionPlan: body.subscriptionPlan,
      primaryAdmin: { name: adminName, email: adminEmail, phone: body.schoolPhone },
    });
    const admin = new User({
      schoolId,
      name: adminName,
      email: adminEmail,
      username: adminEmail,
      password,
      role: 'super-admin',
      permissions: ['all'],
      isActive: true,
      isEmailVerified: true,
    });
    const settings = new Setting({
      schoolId,
      schoolName,
      schoolCode,
      contactEmail,
      schoolPhone: body.schoolPhone,
      affiliationNumber: body.affiliationNumber,
      addressLine1: address.addressLine1,
      city: address.city,
      state: address.state,
      country: address.country,
      postalCode: address.postalCode,
    });
    await settings.save({ session: transaction });
    const classRange = await initializeSchoolCurriculum(store, body.classRange ?? academicSession);
    const { sessionName, startDate, endDate, notes } = academicSession;
    const { session, upcomingSession } = await configureSession(store, { sessionName, startDate, endDate, notes }, { initial: true, createdBy: req.user?.name });
    await admin.save({ session: transaction });
    school.primaryAdmin.userId = String(admin._id);
    await school.save({ session: transaction });
    return { school, session, upcomingSession, classRange };
  }, { allowFallback: false });

  invalidateSchoolsCache();
  return sendCreated(res, 'School onboarded. Current and upcoming sessions are scheduled.', {
    ...result,
    tenantDetails: { schoolId, schoolCode, adminLogin: adminEmail },
  });
});

export const checkSlugAvailability = handle('Unable to check the school slug.', async (req, res) => {
  const slug = cleanSlug(req.query.slug);
  const validFormat = validSlug(slug);
  const available = validFormat && !(await School.exists({ collectionName: slug }));
  const message = validFormat
    ? (available ? 'School slug is available.' : 'School slug is already in use.')
    : 'Use 3–30 lowercase letters, digits, or underscores.';
  const data = { slug, validFormat, available, message };
  return sendSuccess(res, message, data, 200, data);
});

export const getSchools = handle('Failed to load schools.', async (req, res) => {
  const status = trim(req.query.status);
  const search = trim(req.query.search);
  const filter = {};
  if (['active', 'suspended', 'provisioning'].includes(status)) {
    filter.status = { $in: [status, status.toUpperCase()] };
  }
  if (search) {
    const match = new RegExp(escapeRegex(search), 'i');
    filter.$or = ['schoolName', 'collectionName', 'schoolCode', 'contactEmail']
      .map((key) => ({ [key]: match }));
  }
  const schools = await School.find(filter).sort({ createdAt: -1 }).lean();
  const data = { count: schools.length, schools };
  return sendSuccess(res, undefined, data, 200, data);
});

async function findSchool(id) {
  requireDatabase();
  const school = await School.findById(id).lean();
  if (!school) throw procurementError('School not found.', 404);
  return school;
}

export const getSchoolById = handle('Failed to load school details.', async (req, res) => {
  const school = await findSchool(req.params.id);
  const schoolId = school.schoolId || school._id;
  const store = readProcurement({ schoolId });
  const [studentsCount, teachersCount, usersCount, allSessions, curriculum] = await Promise.all([
    Student.countDocuments({ schoolId }),
    Teacher.countDocuments({ schoolId }),
    User.countDocuments({ schoolId }),
    store.find('academicSessions'),
    schoolClassOptions(store),
  ]);
  const classMaster = curriculum.classRange ? [] : await orderedGrades(store);
  const sessions = sessionsInDateOrder(allSessions);
  const session = sessions.find((item) => item.isCurrent) || null;
  const data = { school, stats: { studentsCount, teachersCount, usersCount }, session, sessions, ...curriculum, classMaster };
  return sendSuccess(res, undefined, data, 200, data);
});

export const setSchoolClasses = handle('Failed to save the school class range.', async (req, res) => {
  const school = await findSchool(req.params.id);
  const curriculum = await saveSchoolCurriculum({ schoolId: school.schoolId || school._id, body: req.body }, { allowFallback: false });
  return sendSuccess(res, 'School class range saved.', curriculum);
});

export const updateSchoolSession = handle('Failed to save the academic session.', async (req, res) => {
  const school = await findSchool(req.params.id);
  const data = await saveSessionConfiguration({
    schoolId: school.schoolId || school._id,
    user: req.user,
    body: { ...req.body, isCurrent: true },
  }, { id: req.body?.sessionId, allowFallback: false });
  return sendSuccess(res, 'Academic session saved.', data);
});

export const updateSchool = handle('Failed to update school profile.', async (req, res) => {
  const fields = [
    'schoolName', 'contactEmail', 'schoolPhone', 'alternatePhone', 'address',
    'affiliationNumber', 'board', 'schoolLogo', 'schoolMotto', 'subscriptionPlan',
  ];
  const changes = Object.fromEntries(fields.filter((field) => Object.hasOwn(req.body, field))
    .map((field) => [field, req.body[field]]));
  const school = await School.findByIdAndUpdate(req.params.id, { $set: changes }, { new: true, runValidators: true });
  if (!school) throw procurementError('School not found.', 404);
  invalidateSchoolsCache();
  return sendSuccess(res, 'School profile updated.', null, 200, { school });
});

export const toggleSchoolStatus = handle('Failed to update school status.', async (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) throw procurementError('Choose active or suspended.');
  const school = await School.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!school) throw procurementError('School not found.', 404);
  invalidateSchoolsCache();
  return sendSuccess(res, 'School status changed to ' + status + '.', null, 200, { school });
});

export const getCommonProducts = handle('Failed to load common products.', async (_req, res) => {
  const products = await CommonProduct.find().sort({ createdAt: -1 }).lean();
  return sendSuccess(res, undefined, { products }, 200, { products });
});

export const createCommonProduct = handle('Failed to create common product.', async (req, res) => {
  const product = await CommonProduct.create(req.body);
  return sendCreated(res, 'Common product created.', { product });
});

export const getCommonCategories = handle('Failed to load common categories.', async (_req, res) => {
  const categories = await CommonCategory.find().sort({ name: 1 }).lean();
  return sendSuccess(res, undefined, { categories }, 200, { categories });
});

export const createCommonCategory = handle('Failed to create common category.', async (req, res) => {
  const category = await CommonCategory.create(req.body);
  return sendCreated(res, 'Common category created.', { category });
});
