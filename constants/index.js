/**
 * @file index.js
 * @description Centralized server-side constant definitions across models, controllers, and services.
 */

// ─── User Roles ───────────────────────────────────────────────────────────────

export const ROLES = {
  SUPER_ADMIN:  'super-admin',
  SCHOOL_ADMIN: 'school-admin',
  DIRECTOR:     'director',
  PRINCIPAL:    'principal',
  TEACHER:      'teacher',
  HEAD_TEACHER: 'head-teacher',
  HOD:          'hod',
  COORDINATOR:  'coordinator',
  ACCOUNTANT:   'accountant',
  LIBRARIAN:    'librarian',
  PEON:         'peon',
  STUDENT:      'student',
  PARENT:       'parent',
};

export const ADMIN_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.SCHOOL_ADMIN,
  'admin',
  'superadmin',
  'super_admin',
  'school_admin',
  ROLES.DIRECTOR,
  ROLES.PRINCIPAL,
];

export const STAFF_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.SCHOOL_ADMIN,
  ROLES.DIRECTOR,
  ROLES.PRINCIPAL,
  ROLES.TEACHER,
  ROLES.HEAD_TEACHER,
  ROLES.HOD,
  ROLES.COORDINATOR,
  ROLES.ACCOUNTANT,
  ROLES.LIBRARIAN,
  ROLES.PEON,
];

export const EXCLUDED_PAYROLL_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.SCHOOL_ADMIN,
  'admin',
  ROLES.DIRECTOR,
  ROLES.STUDENT,
  ROLES.PARENT,
];

// ─── Months & Days ────────────────────────────────────────────────────────────

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const MONTH_OPTIONS = MONTH_NAMES.map((name, index) => ({
  value: String(index + 1),
  label: name,
  short: SHORT_MONTH_NAMES[index],
  index: index + 1,
  monthIndex: index,
}));

export const DAYS_OF_WEEK = [
  { id: 'monday',    value: 'monday',    name: 'Monday',    short: 'Mon', index: 1 },
  { id: 'tuesday',   value: 'tuesday',   name: 'Tuesday',   short: 'Tue', index: 2 },
  { id: 'wednesday', value: 'wednesday', name: 'Wednesday', short: 'Wed', index: 3 },
  { id: 'thursday',  value: 'thursday',  name: 'Thursday',  short: 'Thu', index: 4 },
  { id: 'friday',    value: 'friday',    name: 'Friday',    short: 'Fri', index: 5 },
  { id: 'saturday',  value: 'saturday',  name: 'Saturday',  short: 'Sat', index: 6 },
  { id: 'sunday',    value: 'sunday',    name: 'Sunday',    short: 'Sun', index: 0 },
];

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const DAY_NAMES_LOWER = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export const SCHOOL_DAYS = DAYS_OF_WEEK.slice(0, 6);
export const WEEKDAYS = SCHOOL_DAYS;

// ─── Demographics & Statuses ──────────────────────────────────────────────────

export const GENDER_OPTIONS = ['Male', 'Female', 'Other'];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  ABSENT: 'absent',
  LATE: 'late',
  HALF_DAY: 'half_day',
  LEAVE: 'leave',
};

export const FEE_STATUS = {
  PAID: 'paid',
  PARTIAL: 'partial',
  UNPAID: 'unpaid',
};

export const PAYMENT_MODES = [
  'Cash',
  'Cheque',
  'Bank Transfer',
  'Online',
  'UPI',
  'Credit / On Account',
];

export const LEAVE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

export const LEAVE_TYPES = [
  'Medical Leave',
  'Casual Leave',
  'Emergency Leave',
  'Family / Personal Event',
  'Academic Duty / Olympiad',
  'Maternity / Paternity',
  'Other',
];

export const STUDENT_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PASSOUT: 'Passout',
  GRADUATED: 'graduated',
};

// ─── Inventory & Vendor Constants ─────────────────────────────────────────────

export const INVENTORY_CATEGORIES = [
  'Stationery',
  'Lab Equipment',
  'Computers & IT',
  'Sports Items',
  'Uniforms & Badges',
  'Medical & First Aid',
  'Furniture',
  'Books & Publications',
  'Maintenance & Facilities',
  'General',
];

export const VENDOR_CATEGORIES = [
  'Stationery',
  'Lab Equipment',
  'IT Hardware',
  'Sports',
  'Uniforms',
  'Medical',
  'Furniture',
  'General',
];

export const PAYMENT_TERMS = ['Immediate', 'Net 15', 'Net 30', 'Net 60', 'Advance'];

// ─── Pagination Defaults ──────────────────────────────────────────────────────

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default {
  ROLES,
  ADMIN_ROLES,
  STAFF_ROLES,
  EXCLUDED_PAYROLL_ROLES,
  MONTH_NAMES,
  SHORT_MONTH_NAMES,
  MONTH_OPTIONS,
  DAYS_OF_WEEK,
  DAY_NAMES,
  DAY_NAMES_LOWER,
  SCHOOL_DAYS,
  WEEKDAYS,
  GENDER_OPTIONS,
  BLOOD_GROUPS,
  ATTENDANCE_STATUS,
  FEE_STATUS,
  PAYMENT_MODES,
  LEAVE_STATUS,
  LEAVE_TYPES,
  STUDENT_STATUS,
  INVENTORY_CATEGORIES,
  VENDOR_CATEGORIES,
  PAYMENT_TERMS,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
};

