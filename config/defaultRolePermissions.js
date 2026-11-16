/**
 * @file defaultRolePermissions.js
 * @description Out-of-the-box factory defaults for all system roles in RGES.
 * Serves as the single source of truth when no custom tenant override exists in DB.
 */

export const ALL_SYSTEM_MODULES = [
  { id: 'dashboard', name: 'Dashboard & Overview', category: 'Core' },
  { id: 'students', name: 'Student Management', category: 'Core' },
  { id: 'teachers', name: 'Teacher & Faculty Directory', category: 'Core' },
  { id: 'academics', name: 'Academics & Classroom', category: 'Academics' },
  { id: 'attendance', name: 'Attendance Management', category: 'Academics' },
  { id: 'leave', name: 'Leave Management Hub', category: 'Academics & HR' },
  { id: 'exams', name: 'Exams & Schedules', category: 'Academics' },
  { id: 'results', name: 'Results & Marksheets', category: 'Academics' },
  { id: 'syllabus', name: 'Class Syllabus & Books', category: 'Academics' },
  { id: 'online-classes', name: 'Virtual Online Classes', category: 'Learning' },
  { id: 'homework', name: 'Homework & Assignments', category: 'Learning' },
  { id: 'fees', name: 'Fees & Finance Records', category: 'Finance' },
  { id: 'budget', name: 'Session Budget Allocation', category: 'Finance & Planning' },
  { id: 'payroll', name: 'Staff Payroll & Salaries', category: 'HR & Finance' },
  { id: 'inventory', name: 'Inventory & Supplies', category: 'Logistics' },
  { id: 'vendors', name: 'Vendor Procurement', category: 'Logistics' },
  { id: 'library', name: 'Central Library Catalog', category: 'Logistics' },
  { id: 'transport', name: 'Transport & Fleet Routes', category: 'Logistics' },
  { id: 'hostel', name: 'Hostel & Dormitories', category: 'Logistics' },
  { id: 'certificates', name: 'Certificates & ID Cards', category: 'Administration' },
  { id: 'notifications', name: 'Notice Board & Alerts', category: 'Communication' },
  { id: 'reports', name: 'Institutional Reports', category: 'Management' },
  { id: 'user-management', name: 'Staff User Management', category: 'System' },
  { id: 'audit-logs', name: 'Audit Security Logs', category: 'Security' },
  { id: 'profile', name: 'My Profile & Account', category: 'Core' },
  { id: 'settings', name: 'School Settings & Setup', category: 'Management' },
];

export const ALL_ACTION_BUTTONS = [
  // Exams
  { id: 'CREATE_EXAM', label: 'Create Exam', module: 'exams' },
  { id: 'EDIT_EXAM', label: 'Edit Exam', module: 'exams' },
  { id: 'DELETE_EXAM', label: 'Delete Exam', module: 'exams' },
  { id: 'ENTER_MARKS', label: 'Enter / Edit Marks', module: 'exams' },
  { id: 'EXPORT_EXAMS', label: 'Export Exams Data', module: 'exams' },

  // Academics
  { id: 'CREATE_CLASS', label: 'Create Class', module: 'academics' },
  { id: 'CREATE_SECTION', label: 'Create Section', module: 'academics' },
  { id: 'CREATE_SUBJECT', label: 'Create Subject', module: 'academics' },
  { id: 'EDIT_CLASS', label: 'Edit Class', module: 'academics' },
  { id: 'DELETE_CLASS', label: 'Delete Class', module: 'academics' },
  { id: 'ASSIGN_CURRICULUM', label: 'Assign Curriculum', module: 'academics' },
  { id: 'EDIT_CURRICULUM', label: 'Edit Curriculum', module: 'academics' },
  { id: 'DELETE_CURRICULUM', label: 'Delete Curriculum', module: 'academics' },

  // Students
  { id: 'ADD_STUDENT', label: 'Add New Student', module: 'students' },
  { id: 'EDIT_STUDENT', label: 'Edit Student Details', module: 'students' },
  { id: 'DELETE_STUDENT', label: 'Delete Student', module: 'students' },
  { id: 'RESET_STUDENT_PASSWORD', label: 'Reset Student Password', module: 'students' },
  { id: 'EXPORT_STUDENTS', label: 'Export Students List', module: 'students' },
  { id: 'BULK_DELETE_STUDENTS', label: 'Bulk Delete Students', module: 'students' },

  // Teachers
  { id: 'ADD_TEACHER', label: 'Add New Teacher', module: 'teachers' },
  { id: 'EDIT_TEACHER', label: 'Edit Teacher Details', module: 'teachers' },
  { id: 'DELETE_TEACHER', label: 'Delete Teacher', module: 'teachers' },
  { id: 'RESET_TEACHER_PASSWORD', label: 'Reset Teacher Password', module: 'teachers' },
  { id: 'EXPORT_TEACHERS', label: 'Export Teachers List', module: 'teachers' },

  // Fees & Finance
  { id: 'COLLECT_FEE', label: 'Collect Fee Payment', module: 'fees' },
  { id: 'ADD_EXPENSE', label: 'Record New Expense', module: 'fees' },
  { id: 'EDIT_FEE_RECORD', label: 'Edit Fee Record', module: 'fees' },
  { id: 'DELETE_FEE_RECORD', label: 'Delete Fee Record', module: 'fees' },
  { id: 'EXPORT_FINANCE', label: 'Export Financial Reports', module: 'fees' },

  // Budget
  { id: 'SAVE_BUDGET', label: 'Allocate Session Budget', module: 'budget' },
  { id: 'REVISE_BUDGET', label: 'Perform Budget Revision', module: 'budget' },
  { id: 'EXPORT_BUDGET', label: 'Export Budget Details', module: 'budget' },

  // Inventory & Vendors
  { id: 'ADD_INVENTORY_ITEM', label: 'Add Item to Inventory', module: 'inventory' },
  { id: 'ADJUST_STOCK', label: 'Adjust Item Stock', module: 'inventory' },
  { id: 'ADD_VENDOR', label: 'Register New Vendor', module: 'vendors' },
  { id: 'CREATE_PURCHASE_ORDER', label: 'Create Purchase Order', module: 'inventory' },

  // Library
  { id: 'ADD_BOOK', label: 'Add Book to Library', module: 'library' },
  { id: 'ISSUE_BOOK', label: 'Issue Book to Student/Staff', module: 'library' },
  { id: 'RETURN_BOOK', label: 'Mark Book as Returned', module: 'library' },

  // Attendance
  { id: 'MARK_ATTENDANCE', label: 'Mark Daily Attendance', module: 'attendance' },
  { id: 'EXPORT_ATTENDANCE', label: 'Export Attendance Data', module: 'attendance' },

  // Timetable
  { id: 'ADD_PERIOD_SLOT', label: 'Add Period Slot', module: 'academics' },
  { id: 'EXPORT_TIMETABLE', label: 'Export Timetable', module: 'academics' },

  // Online Classes
  { id: 'SCHEDULE_ONLINE_CLASS', label: 'Schedule Online Class', module: 'online-classes' },
  { id: 'EDIT_ONLINE_CLASS', label: 'Edit Online Class', module: 'online-classes' },
  { id: 'DELETE_ONLINE_CLASS', label: 'Delete Online Class', module: 'online-classes' },
  { id: 'START_ONLINE_CLASS', label: 'Start Online Live Session', module: 'online-classes' },
  { id: 'JOIN_ONLINE_CLASS', label: 'Join Online Live Class', module: 'online-classes' },

  // Homework
  { id: 'ASSIGN_HOMEWORK', label: 'Assign Homework', module: 'homework' },
  { id: 'CREATE_HOMEWORK', label: 'Create Homework Task', module: 'homework' },
  { id: 'EDIT_HOMEWORK', label: 'Edit Homework', module: 'homework' },
  { id: 'DELETE_HOMEWORK', label: 'Delete Homework', module: 'homework' },
  { id: 'EVALUATE_HOMEWORK', label: 'Evaluate & Grade Homework', module: 'homework' },
  { id: 'SUBMIT_HOMEWORK', label: 'Submit Homework Solution', module: 'homework' },

  // Leave Hub
  { id: 'APPLY_LEAVE', label: 'Submit Leave Application', module: 'leave' },
  { id: 'APPROVE_LEAVE', label: 'Approve Leave Request', module: 'leave' },
  { id: 'REJECT_LEAVE', label: 'Reject Leave Request', module: 'leave' },
  { id: 'CANCEL_LEAVE', label: 'Cancel Leave Request', module: 'leave' },
  { id: 'EXPORT_LEAVES', label: 'Export Leave Records', module: 'leave' },

  // System & Settings
  { id: 'CREATE_NOTIFICATION', label: 'Post Institutional Notice', module: 'notifications' },
  { id: 'CREATE_CERTIFICATE', label: 'Generate & Issue Certificate', module: 'certificates' },
  { id: 'UPDATE_SETTINGS', label: 'Modify School Settings', module: 'settings' },
  { id: 'VIEW_AUDIT_LOGS', label: 'Inspect Security Audit Logs', module: 'audit-logs' },
  { id: 'BACKUP_DATABASE', label: 'Create System Backup', module: 'settings' },
];

export const DEFAULT_ROLE_PERMISSIONS = {
  'super-admin': {
    role: 'super-admin',
    modules: ['*'],
    actions: { '*': ['*'] },
    buttons: ALL_ACTION_BUTTONS.map((b) => b.id),
    viewScope: 'school_wide',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: true,
      canApproveLeaves: true,
      leaveApprovalScope: 'all',
      canViewBudget: true,
      canReviseBudget: true,
      canManageUsers: true,
    },
    isCustomized: false,
  },

  'school-admin': {
    role: 'school-admin',
    modules: [
      'dashboard', 'profile', 'students', 'teachers', 'academics', 'attendance',
      'exams', 'results', 'leave', 'payroll', 'fees', 'budget', 'inventory',
      'vendors', 'library', 'transport', 'hostel', 'certificates', 'notifications',
      'reports', 'settings', 'online-classes', 'homework', 'user-management'
    ],
    actions: {
      '*': ['create', 'read', 'update', 'delete', 'manage', 'approve']
    },
    buttons: ALL_ACTION_BUTTONS.filter((b) => b.id !== 'VIEW_AUDIT_LOGS' && b.id !== 'SUBMIT_HOMEWORK').map((b) => b.id),
    viewScope: 'school_wide',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: true,
      canApproveLeaves: true,
      leaveApprovalScope: 'all',
      canViewBudget: true,
      canReviseBudget: true,
      canManageUsers: true,
    },
    isCustomized: false,
  },

  principal: {
    role: 'principal',
    modules: [
      'dashboard', 'profile', 'students', 'teachers', 'academics', 'attendance',
      'exams', 'results', 'leave', 'payroll', 'fees', 'budget', 'inventory',
      'vendors', 'library', 'transport', 'hostel', 'certificates', 'notifications',
      'reports', 'settings', 'online-classes', 'homework'
    ],
    actions: {
      '*': ['create', 'read', 'update', 'manage', 'approve']
    },
    buttons: [
      'CREATE_EXAM', 'EDIT_EXAM', 'DELETE_EXAM', 'ENTER_MARKS', 'EXPORT_EXAMS',
      'CREATE_CLASS', 'CREATE_SECTION', 'CREATE_SUBJECT', 'EDIT_CLASS', 'ASSIGN_CURRICULUM', 'EDIT_CURRICULUM', 'DELETE_CURRICULUM',
      'ADD_STUDENT', 'EDIT_STUDENT', 'RESET_STUDENT_PASSWORD', 'EXPORT_STUDENTS',
      'ADD_TEACHER', 'EDIT_TEACHER', 'RESET_TEACHER_PASSWORD', 'EXPORT_TEACHERS',
      'COLLECT_FEE', 'EXPORT_FINANCE', 'SAVE_BUDGET', 'REVISE_BUDGET', 'EXPORT_BUDGET',
      'ADD_INVENTORY_ITEM', 'MARK_ATTENDANCE', 'EXPORT_ATTENDANCE', 'ADD_PERIOD_SLOT', 'EXPORT_TIMETABLE',
      'SCHEDULE_ONLINE_CLASS', 'EDIT_ONLINE_CLASS', 'DELETE_ONLINE_CLASS', 'START_ONLINE_CLASS', 'JOIN_ONLINE_CLASS',
      'ASSIGN_HOMEWORK', 'CREATE_HOMEWORK', 'EDIT_HOMEWORK', 'DELETE_HOMEWORK', 'EVALUATE_HOMEWORK',
      'APPLY_LEAVE', 'APPROVE_LEAVE', 'REJECT_LEAVE', 'CANCEL_LEAVE', 'EXPORT_LEAVES',
      'CREATE_NOTIFICATION', 'CREATE_CERTIFICATE', 'UPDATE_SETTINGS'
    ],
    viewScope: 'school_wide',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: true,
      canApproveLeaves: true,
      leaveApprovalScope: 'all',
      canViewBudget: true,
      canReviseBudget: true,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  director: {
    role: 'director',
    modules: [
      'dashboard', 'profile', 'students', 'teachers', 'academics', 'attendance',
      'exams', 'results', 'leave', 'payroll', 'fees', 'budget', 'inventory',
      'vendors', 'library', 'transport', 'hostel', 'certificates', 'notifications',
      'reports', 'settings', 'online-classes', 'homework'
    ],
    actions: {
      '*': ['create', 'read', 'update', 'manage', 'approve']
    },
    buttons: [
      'CREATE_EXAM', 'EDIT_EXAM', 'EXPORT_EXAMS', 'CREATE_CLASS', 'EDIT_CLASS',
      'ADD_STUDENT', 'EDIT_STUDENT', 'EXPORT_STUDENTS', 'ADD_TEACHER', 'EDIT_TEACHER', 'EXPORT_TEACHERS',
      'COLLECT_FEE', 'EXPORT_FINANCE', 'SAVE_BUDGET', 'REVISE_BUDGET', 'EXPORT_BUDGET',
      'MARK_ATTENDANCE', 'EXPORT_ATTENDANCE', 'SCHEDULE_ONLINE_CLASS', 'START_ONLINE_CLASS',
      'ASSIGN_HOMEWORK', 'APPLY_LEAVE', 'APPROVE_LEAVE', 'REJECT_LEAVE', 'CANCEL_LEAVE',
      'CREATE_NOTIFICATION', 'UPDATE_SETTINGS'
    ],
    viewScope: 'school_wide',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: true,
      canApproveLeaves: true,
      leaveApprovalScope: 'all',
      canViewBudget: true,
      canReviseBudget: true,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  teacher: {
    role: 'teacher',
    modules: [
      'dashboard', 'profile', 'students', 'academics', 'attendance',
      'exams', 'results', 'leave', 'payroll', 'library', 'notifications',
      'settings', 'online-classes', 'homework', 'certificates'
    ],
    actions: {
      students: ['read'],
      academics: ['read'],
      attendance: ['create', 'read', 'update'],
      exams: ['create', 'read', 'update'],
      results: ['create', 'read', 'update'],
      leave: ['create', 'read', 'cancel', 'approve'],
      payroll: ['read'],
      library: ['read'],
      notifications: ['read', 'create'],
      'online-classes': ['create', 'read', 'update', 'start', 'join'],
      homework: ['create', 'read', 'update', 'evaluate'],
      certificates: ['read', 'create'],
      settings: ['read'],
      profile: ['read', 'update'],
    },
    buttons: [
      'CREATE_EXAM', 'EDIT_EXAM', 'ENTER_MARKS', 'EXPORT_EXAMS',
      'ASSIGN_CURRICULUM', 'EDIT_CURRICULUM',
      'EXPORT_STUDENTS',
      'MARK_ATTENDANCE', 'EXPORT_ATTENDANCE',
      'EXPORT_TIMETABLE',
      'SCHEDULE_ONLINE_CLASS', 'EDIT_ONLINE_CLASS', 'START_ONLINE_CLASS', 'JOIN_ONLINE_CLASS',
      'ASSIGN_HOMEWORK', 'CREATE_HOMEWORK', 'EDIT_HOMEWORK', 'EVALUATE_HOMEWORK',
      'APPLY_LEAVE', 'APPROVE_LEAVE', 'REJECT_LEAVE', 'CANCEL_LEAVE', 'EXPORT_LEAVES',
      'CREATE_NOTIFICATION'
    ],
    viewScope: 'assigned_only',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: true,
      canApproveLeaves: true,
      leaveApprovalScope: 'class_students', // Class teachers can approve their section students
      canViewBudget: false,
      canReviseBudget: false,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  'head-teacher': {
    role: 'head-teacher',
    modules: [
      'dashboard', 'profile', 'students', 'teachers', 'academics', 'attendance',
      'exams', 'results', 'leave', 'payroll', 'library', 'notifications',
      'settings', 'online-classes', 'homework', 'certificates'
    ],
    actions: {
      '*': ['create', 'read', 'update', 'evaluate', 'approve']
    },
    buttons: [
      'CREATE_EXAM', 'EDIT_EXAM', 'ENTER_MARKS', 'EXPORT_EXAMS',
      'CREATE_SUBJECT', 'ASSIGN_CURRICULUM', 'EDIT_CURRICULUM',
      'EXPORT_STUDENTS', 'EXPORT_TEACHERS',
      'MARK_ATTENDANCE', 'EXPORT_ATTENDANCE', 'ADD_PERIOD_SLOT', 'EXPORT_TIMETABLE',
      'SCHEDULE_ONLINE_CLASS', 'EDIT_ONLINE_CLASS', 'START_ONLINE_CLASS', 'JOIN_ONLINE_CLASS',
      'ASSIGN_HOMEWORK', 'CREATE_HOMEWORK', 'EDIT_HOMEWORK', 'EVALUATE_HOMEWORK',
      'APPLY_LEAVE', 'APPROVE_LEAVE', 'REJECT_LEAVE', 'CANCEL_LEAVE', 'EXPORT_LEAVES',
      'CREATE_NOTIFICATION'
    ],
    viewScope: 'assigned_only',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: true,
      canApproveLeaves: true,
      leaveApprovalScope: 'class_students',
      canViewBudget: false,
      canReviseBudget: false,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  hod: {
    role: 'hod',
    modules: [
      'dashboard', 'profile', 'students', 'teachers', 'academics', 'attendance',
      'exams', 'results', 'leave', 'payroll', 'library', 'notifications',
      'settings', 'online-classes', 'homework', 'certificates'
    ],
    actions: {
      '*': ['create', 'read', 'update', 'evaluate', 'approve']
    },
    buttons: [
      'CREATE_EXAM', 'EDIT_EXAM', 'ENTER_MARKS', 'EXPORT_EXAMS',
      'CREATE_SUBJECT', 'ASSIGN_CURRICULUM', 'EDIT_CURRICULUM',
      'EXPORT_STUDENTS', 'EXPORT_TEACHERS',
      'MARK_ATTENDANCE', 'EXPORT_ATTENDANCE', 'ADD_PERIOD_SLOT', 'EXPORT_TIMETABLE',
      'SCHEDULE_ONLINE_CLASS', 'EDIT_ONLINE_CLASS', 'START_ONLINE_CLASS', 'JOIN_ONLINE_CLASS',
      'ASSIGN_HOMEWORK', 'CREATE_HOMEWORK', 'EDIT_HOMEWORK', 'EVALUATE_HOMEWORK',
      'APPLY_LEAVE', 'APPROVE_LEAVE', 'REJECT_LEAVE', 'CANCEL_LEAVE', 'EXPORT_LEAVES',
      'CREATE_NOTIFICATION'
    ],
    viewScope: 'assigned_only',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: true,
      canApproveLeaves: true,
      leaveApprovalScope: 'class_students',
      canViewBudget: false,
      canReviseBudget: false,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  coordinator: {
    role: 'coordinator',
    modules: [
      'dashboard', 'profile', 'students', 'teachers', 'academics', 'attendance',
      'exams', 'results', 'leave', 'payroll', 'notifications',
      'settings', 'online-classes', 'homework', 'certificates'
    ],
    actions: {
      '*': ['create', 'read', 'update', 'evaluate', 'approve']
    },
    buttons: [
      'CREATE_EXAM', 'ENTER_MARKS', 'ASSIGN_CURRICULUM', 'EDIT_CURRICULUM',
      'EXPORT_STUDENTS', 'EXPORT_TEACHERS', 'MARK_ATTENDANCE', 'EXPORT_ATTENDANCE',
      'SCHEDULE_ONLINE_CLASS', 'START_ONLINE_CLASS', 'JOIN_ONLINE_CLASS',
      'ASSIGN_HOMEWORK', 'CREATE_HOMEWORK', 'EDIT_HOMEWORK', 'EVALUATE_HOMEWORK',
      'APPLY_LEAVE', 'APPROVE_LEAVE', 'REJECT_LEAVE', 'CANCEL_LEAVE',
      'CREATE_NOTIFICATION'
    ],
    viewScope: 'assigned_only',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: true,
      canApproveLeaves: true,
      leaveApprovalScope: 'class_students',
      canViewBudget: false,
      canReviseBudget: false,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  accountant: {
    role: 'accountant',
    modules: [
      'dashboard', 'profile', 'attendance', 'leave', 'fees', 'budget',
      'payroll', 'inventory', 'vendors', 'transport', 'hostel',
      'reports', 'students', 'certificates', 'settings'
    ],
    actions: {
      fees: ['create', 'read', 'update', 'manage'],
      budget: ['read'],
      payroll: ['create', 'read', 'update'],
      inventory: ['create', 'read', 'update'],
      vendors: ['create', 'read', 'update'],
      students: ['read'],
      leave: ['create', 'read', 'cancel'],
      attendance: ['read'],
      profile: ['read', 'update'],
      settings: ['read'],
    },
    buttons: [
      'ADD_STUDENT', 'EXPORT_STUDENTS', 'EXPORT_TEACHERS',
      'COLLECT_FEE', 'ADD_EXPENSE', 'EDIT_FEE_RECORD', 'EXPORT_FINANCE',
      'EXPORT_BUDGET',
      'ADD_INVENTORY_ITEM', 'ADJUST_STOCK', 'ADD_VENDOR', 'CREATE_PURCHASE_ORDER',
      'EXPORT_ATTENDANCE', 'ADD_ROUTE', 'ADD_HOSTEL_ROOM',
      'APPLY_LEAVE', 'CANCEL_LEAVE', 'CREATE_NOTIFICATION'
    ],
    viewScope: 'school_wide',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: false,
      canApproveLeaves: false,
      leaveApprovalScope: 'none',
      canViewBudget: true,
      canReviseBudget: false,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  librarian: {
    role: 'librarian',
    modules: [
      'dashboard', 'profile', 'attendance', 'leave', 'payroll',
      'library', 'inventory', 'notifications', 'settings'
    ],
    actions: {
      library: ['create', 'read', 'update', 'manage'],
      inventory: ['create', 'read'],
      leave: ['create', 'read', 'cancel'],
      attendance: ['read'],
      profile: ['read', 'update'],
      settings: ['read'],
    },
    buttons: [
      'ADD_BOOK', 'ISSUE_BOOK', 'RETURN_BOOK',
      'ADD_INVENTORY_ITEM',
      'APPLY_LEAVE', 'CANCEL_LEAVE'
    ],
    viewScope: 'self_only',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: false,
      canApproveLeaves: false,
      leaveApprovalScope: 'none',
      canViewBudget: false,
      canReviseBudget: false,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  peon: {
    role: 'peon',
    modules: [
      'dashboard', 'profile', 'attendance', 'leave', 'payroll',
      'notifications', 'settings'
    ],
    actions: {
      leave: ['create', 'read', 'cancel'],
      attendance: ['read'],
      payroll: ['read'],
      profile: ['read', 'update'],
      settings: ['read'],
    },
    buttons: [
      'APPLY_LEAVE', 'CANCEL_LEAVE'
    ],
    viewScope: 'self_only',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: false,
      canApproveLeaves: false,
      leaveApprovalScope: 'none',
      canViewBudget: false,
      canReviseBudget: false,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  student: {
    role: 'student',
    modules: [
      'dashboard', 'profile', 'academics', 'attendance',
      'leave', 'exams', 'results', 'library', 'notifications',
      'certificates', 'online-classes', 'homework'
    ],
    actions: {
      academics: ['read'],
      attendance: ['read'],
      leave: ['create', 'read', 'cancel'],
      exams: ['read'],
      results: ['read'],
      library: ['read'],
      homework: ['read', 'submit'],
      'online-classes': ['read', 'join'],
      certificates: ['read'],
      notifications: ['read'],
      profile: ['read', 'update'],
    },
    buttons: [
      'EXPORT_TIMETABLE', 'JOIN_ONLINE_CLASS', 'SUBMIT_HOMEWORK',
      'APPLY_LEAVE', 'CANCEL_LEAVE'
    ],
    viewScope: 'self_only',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: false,
      canApproveLeaves: false,
      leaveApprovalScope: 'none',
      canViewBudget: false,
      canReviseBudget: false,
      canManageUsers: false,
    },
    isCustomized: false,
  },

  parent: {
    role: 'parent',
    modules: [
      'dashboard', 'profile', 'academics', 'attendance',
      'leave', 'fees', 'exams', 'results', 'notifications',
      'online-classes', 'homework', 'certificates'
    ],
    actions: {
      academics: ['read'],
      attendance: ['read'],
      leave: ['create', 'read', 'cancel'],
      fees: ['read', 'pay'],
      exams: ['read'],
      results: ['read'],
      homework: ['read'],
      'online-classes': ['read', 'join'],
      certificates: ['read'],
      notifications: ['read'],
      profile: ['read', 'update'],
    },
    buttons: [
      'JOIN_ONLINE_CLASS', 'APPLY_LEAVE', 'CANCEL_LEAVE'
    ],
    viewScope: 'self_only',
    workflowSettings: {
      canApplyLeaveSelf: true,
      canApplyLeaveOnBehalf: false,
      canApproveLeaves: false,
      leaveApprovalScope: 'none',
      canViewBudget: false,
      canReviseBudget: false,
      canManageUsers: false,
    },
    isCustomized: false,
  },
};

/**
 * Return default role configuration object for a given role identifier.
 */
export const getDefaultRolePermissions = (role) => {
  const norm = String(role || '').trim().toLowerCase().replace(/_/g, '-');
  return (
    DEFAULT_ROLE_PERMISSIONS[norm] ||
    DEFAULT_ROLE_PERMISSIONS['teacher'] ||
    DEFAULT_ROLE_PERMISSIONS['student']
  );
};
