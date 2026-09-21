import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "uploads", "fallback_db.json");

// Initialize dummy records
const initialDb = {
  users: [
    {
      id: "u1",
      username: "superadmin",
      email: "admin@school.com",
      role: "super-admin",
      name: "Albus Dumbledore",
      profileId: "staff1",
      isActive: true,
      phone: "+1 555-0101",
      gender: "Male",
      designation: "Head Administrator",
      department: "Executive Management",
      qualification: "Ph.D. Education Administration",
      address: "High Tower Suite 1, Academic Wing",
      salary: 120000,
    },
    {
      id: "u2",
      username: "principal",
      email: "principal@school.com",
      role: "principal",
      name: "Minerva McGonagall",
      profileId: "staff2",
      isActive: true,
      phone: "+1 555-0102",
      gender: "Female",
      designation: "Principal & Academic Dean",
      department: "Academics",
      qualification: "M.Ed., M.Sc. Mathematics",
      address: "Gryphon House, North Campus",
      salary: 95000,
    },
    {
      id: "u8",
      username: "director",
      email: "director@school.com",
      role: "school-admin",
      name: "Arthur Weasley",
      profileId: "staff5",
      isActive: true,
      phone: "+1 555-0108",
      gender: "Male",
      designation: "Executive Director",
      department: "Board of Directors",
      qualification: "MBA, M.A. Public Administration",
      address: "The Burrow, Devon",
      salary: 110000,
    },
    {
      id: "u3",
      username: "teacher",
      email: "teacher@school.com",
      role: "teacher",
      name: "Severus Snape",
      profileId: "t1",
      isActive: true,
      phone: "+1 555-0103",
      gender: "Male",
      designation: "Senior Chemistry Teacher",
      department: "Science",
      qualification: "M.Sc. Chemistry, B.Ed.",
      address: "Spinner End 12, River District",
      salary: 75000,
      isClassTeacher: true,
      classTeacherOf: "Class 10 - Section A",
      classesAssigned: ["Class 10", "Class 11"],
      sectionsAssigned: ["Section A", "Section B"],
      subjectsAssigned: ["Potions", "Chemistry"],
    },
    {
      id: "u4",
      username: "accountant",
      email: "accountant@school.com",
      role: "accountant",
      name: "Lucius Malfoy",
      profileId: "staff3",
      isActive: true,
      phone: "+1 555-0104",
      gender: "Male",
      designation: "Chief Finance Officer",
      department: "Finance & Accounts",
      qualification: "CPA, B.Com Honors",
      address: "Malfoy Manor, Wiltshire",
      salary: 85000,
    },
    {
      id: "u5",
      username: "librarian",
      email: "librarian@school.com",
      role: "librarian",
      name: "Irma Pince",
      profileId: "staff4",
      isActive: true,
      phone: "+1 555-0105",
      gender: "Female",
      designation: "Chief Librarian",
      department: "Central Library",
      qualification: "Master of Library Science (M.Lib)",
      address: "St. Jude Crescent 44",
      salary: 60000,
    },
    {
      id: "u9",
      username: "peon",
      email: "peon@school.com",
      role: "peon",
      name: "Argus Filch",
      profileId: "staff6",
      isActive: true,
      phone: "+1 555-0109",
      gender: "Male",
      designation: "Head Caretaker & Support Staff",
      department: "Campus Operations",
      qualification: "High School Diploma",
      address: "East Gate Lodge, Campus Gate",
      salary: 35000,
    },
    {
      id: "u6",
      username: "student",
      email: "student@school.com",
      role: "student",
      name: "Harry Potter",
      profileId: "s1",
      isActive: true,
    },
    {
      id: "u7",
      username: "parent",
      email: "parent@school.com",
      role: "parent",
      name: "James Potter",
      profileId: "p1",
      isActive: true,
    },
  ],
  students: [
    {
      id: "s1",
      user: "u6",
      name: "Harry Potter",
      rollNumber: "101",
      admissionNumber: "ADM202601",
      classId: "c1",
      sectionId: "sec1",
      dob: "2010-07-31",
      gender: "Male",
      bloodGroup: "O+",
      address: "4 Privet Drive, Surrey",
      contactNumber: "9876543210",
      parentName: "James Potter",
      parentContact: "9876543211",
      parentEmail: "parent@school.com",
      aadhaarNumber: "1234-5678-9012",
      documents: [],
      academicHistory: [
        {
          school: "Little Whinging Primary",
          class: "5th",
          year: "2024",
          percentage: "88%",
        },
      ],
    },
    {
      id: "s2",
      user: null,
      name: "Hermione Granger",
      rollNumber: "102",
      admissionNumber: "ADM202602",
      classId: "c1",
      sectionId: "sec1",
      dob: "2010-09-19",
      gender: "Female",
      bloodGroup: "A+",
      address: "Heathgate, Hampstead, London",
      contactNumber: "9876543215",
      parentName: "Dr. Granger",
      parentContact: "9876543216",
      parentEmail: "grangers@gmail.com",
      aadhaarNumber: "2345-6789-0123",
      documents: [],
      academicHistory: [],
    },
    {
      id: "s3",
      user: null,
      name: "Ron Weasley",
      rollNumber: "103",
      admissionNumber: "ADM202603",
      classId: "c1",
      sectionId: "sec1",
      dob: "2010-03-01",
      gender: "Male",
      bloodGroup: "B+",
      address: "The Burrow, Ottery St Catchpole",
      contactNumber: "9876543220",
      parentName: "Arthur Weasley",
      parentContact: "9876543221",
      parentEmail: "weasleys@gmail.com",
      aadhaarNumber: "3456-7890-1234",
      documents: [],
      academicHistory: [],
    },
  ],
  teachers: [
    {
      id: "t1",
      user: "u3",
      name: "Severus Snape",
      employeeId: "EMP001",
      qualification: "M.Sc. Potions, Ph.D.",
      designation: "Senior Professor",
      subjectsAssigned: ["sub1", "sub2"],
      classesAssigned: ["c1"],
      salary: 85000,
      attendanceRate: 98,
      leaves: [],
    },
    {
      id: "t2",
      user: null,
      name: "Filius Flitwick",
      employeeId: "EMP002",
      qualification: "M.A. Charms",
      designation: "Professor",
      subjectsAssigned: ["sub3"],
      classesAssigned: ["c1", "c2"],
      salary: 75000,
      attendanceRate: 95,
      leaves: [],
    },
  ],
  classes: [
    { id: "c1", name: "Class 10", code: "C10", room: "Room 301" },
    { id: "c2", name: "Class 11", code: "C11", room: "Room 402" },
  ],
  sections: [
    { id: "sec1", name: "Section A", classId: "c1", classTeacher: "t1" },
    { id: "sec2", name: "Section B", classId: "c1", classTeacher: "t2" },
  ],
  subjects: [
    {
      id: "sub1",
      name: "Potions",
      code: "POT101",
      type: "practical",
      credits: 4,
    },
    {
      id: "sub2",
      name: "Defense Against the Dark Arts",
      code: "DADA101",
      type: "theory",
      credits: 4,
    },
    {
      id: "sub3",
      name: "Charms",
      code: "CHM101",
      type: "practical",
      credits: 3,
    },
  ],
  attendance: [
    {
      id: "a1",
      date: "2026-06-05",
      classId: "c1",
      records: [
        { memberId: "s1", status: "present" },
        { memberId: "s2", status: "present" },
        { memberId: "s3", status: "absent" },
      ],
    },
  ],
  exams: [
    {
      id: "e1",
      name: "Term 1 Mid-Term",
      term: "Term 1",
      date: "2026-06-15",
      status: "upcoming",
    },
    {
      id: "e2",
      name: "Annual Final Assessment",
      term: "Term 2",
      date: "2026-11-20",
      status: "upcoming",
    },
  ],
  results: [
    {
      id: "r1",
      examId: "e1",
      studentId: "s1",
      marks: [
        { subjectId: "sub1", obtained: 85, total: 100 },
        { subjectId: "sub2", obtained: 92, total: 100 },
      ],
      gpa: 3.8,
      remarks: "Excellent performance",
    },
    {
      id: "r2",
      examId: "e1",
      studentId: "s2",
      marks: [
        { subjectId: "sub1", obtained: 99, total: 100 },
        { subjectId: "sub2", obtained: 98, total: 100 },
      ],
      gpa: 4.0,
      remarks: "Outstanding",
    },
  ],
  fees: [
    {
      id: "f1",
      studentId: "s1",
      amountPaid: 15000,
      amountPending: 5000,
      status: "partial",
      dueDate: "2026-06-15",
      transactions: [{ date: "2026-05-10", amount: 15000, method: "Online" }],
    },
    {
      id: "f2",
      studentId: "s2",
      amountPaid: 20000,
      amountPending: 0,
      status: "paid",
      dueDate: "2026-06-15",
      transactions: [
        { date: "2026-05-08", amount: 20000, method: "Bank Transfer" },
      ],
    },
    {
      id: "f3",
      studentId: "s3",
      amountPaid: 0,
      amountPending: 20000,
      status: "unpaid",
      dueDate: "2026-06-15",
      transactions: [],
    },
  ],
  inventory: [
    {
      id: "inv1",
      name: "Advanced Potions Guidebook",
      sku: "BK-POT-01",
      category: "Books",
      quantity: 45,
      unit: "pcs",
      minStockLevel: 10,
      price: 450,
      vendorId: "v1",
    },
    {
      id: "inv2",
      name: "Dell Optiplex Desktops",
      sku: "HW-PC-02",
      category: "Computers",
      quantity: 2,
      unit: "units",
      minStockLevel: 5,
      price: 45000,
      vendorId: "v2",
    }, // Low stock!
    {
      id: "inv3",
      name: "Glass Beakers 500ml",
      sku: "LB-BKR-05",
      category: "Lab Equipment",
      quantity: 120,
      unit: "pcs",
      minStockLevel: 20,
      price: 75,
      vendorId: "v1",
    },
    {
      id: "inv4",
      name: "Wooden Single Desks",
      sku: "FN-DSK-01",
      category: "Furniture",
      quantity: 80,
      unit: "units",
      minStockLevel: 5,
      price: 1200,
      vendorId: "v3",
    },
    {
      id: "inv5",
      name: "Nylon Footballs Size 5",
      sku: "SP-FTB-05",
      quantity: 3,
      unit: "pcs",
      category: "Sports Items",
      minStockLevel: 5,
      price: 650,
      vendorId: "v3",
    }, // Low stock!
  ],
  vendors: [
    {
      id: "v1",
      name: "Flourish & Blotts Corp",
      contactPerson: "Mr. Flourish",
      phone: "111-222-3333",
      email: "sales@flourish.com",
      address: "Diagon Alley, London",
    },
    {
      id: "v2",
      name: "RGES Tech Solutions",
      contactPerson: "John Doe",
      phone: "444-555-6666",
      email: "support@aegistech.com",
      address: "Tech Park, London",
    },
    {
      id: "v3",
      name: "Spud & Sons Supplies",
      contactPerson: "Arthur Spud",
      phone: "777-888-9999",
      email: "spuds@supplies.com",
      address: "High Street, Surrey",
    },
  ],
  purchases: [
    {
      id: "p1",
      orderNumber: "PO-2026-001",
      vendorId: "v1",
      items: [{ name: "Advanced Potions Guidebook", qty: 50, cost: 300 }],
      totalAmount: 15000,
      status: "approved",
      orderDate: "2026-05-15",
    },
    {
      id: "p2",
      orderNumber: "PO-2026-002",
      vendorId: "v2",
      items: [{ name: "Dell Optiplex Desktops", qty: 10, cost: 40000 }],
      totalAmount: 400000,
      status: "pending",
      orderDate: "2026-06-01",
    },
  ],
  expenses: [
    {
      id: "exp1",
      title: "Monthly Electricity Bill",
      amount: 24000,
      category: "Utilities",
      date: "2026-05-28",
      refInvoice: "INV-ELE-89",
    },
    {
      id: "exp2",
      title: "Science Lab Glassware",
      amount: 9500,
      category: "Academic Supplies",
      date: "2026-05-15",
      refInvoice: "INV-LB-990",
    },
    {
      id: "exp3",
      title: "Staff Salaried Payroll",
      amount: 620000,
      category: "Payroll",
      date: "2026-06-01",
      refInvoice: "PAY-2026-06",
    },
  ],
  academicSessions: [
    {
      _id: "sess-1",
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isCurrent: false,
      status: "completed",
    },
    {
      _id: "sess-2",
      sessionName: "2026-2027",
      startDate: "2026-04-01",
      endDate: "2027-03-31",
      isCurrent: true,
      status: "active",
    },
  ],
  library: [
    {
      id: "lib1",
      bookId: "b1",
      studentId: "s1",
      issueDate: "2026-05-25",
      dueDate: "2026-06-08",
      returnDate: null,
      fine: 0,
    },
    {
      id: "lib2",
      bookId: "b2",
      studentId: "s2",
      issueDate: "2026-05-10",
      dueDate: "2026-05-24",
      returnDate: "2026-05-24",
      fine: 0,
    },
    {
      id: "lib3",
      bookId: "b3",
      studentId: "s3",
      issueDate: "2026-04-15",
      dueDate: "2026-04-29",
      returnDate: null,
      fine: 35,
    }, // Late book!
  ],
  books: [
    {
      id: "b1",
      title: "Standard Book of Spells, Grade 1",
      isbn: "978-0747532699",
      author: "Miranda Goshawk",
      category: "Spellwork",
      totalQty: 10,
      issuedQty: 1,
    },
    {
      id: "b2",
      title: "A History of Magic",
      isbn: "978-0747558194",
      author: "Bathilda Bagshot",
      category: "History",
      totalQty: 5,
      issuedQty: 0,
    },
    {
      id: "b3",
      title: "Fantastic Beasts and Where to Find Them",
      isbn: "978-0747554660",
      author: "Newt Scamander",
      category: "Magizoology",
      totalQty: 8,
      issuedQty: 1,
    },
  ],
  transport: [
    {
      id: "tr1",
      routeName: "Route Alpha (Hampstead - London)",
      busNumber: "BUS-GRIF-01",
      driverName: "Hagrid R.",
      driverContact: "0987654322",
      stops: ["Hampstead Heath", "Highgate", "Kings Cross"],
      fare: 2500,
      assignedStudents: ["s2"],
    },
    {
      id: "tr2",
      routeName: "Route Beta (Surrey - London)",
      busNumber: "BUS-SLYT-02",
      driverName: "Stan Shunpike",
      driverContact: "0987654323",
      stops: ["Little Whinging", "Guildford", "Victoria"],
      fare: 3500,
      assignedStudents: ["s1", "s3"],
    },
  ],
  notifications: [
    {
      id: "n1",
      title: "Mid-Term Examinations Schedule",
      message:
        "Mid-term exams start from June 15th. Please download timetables.",
      date: "2026-06-04",
      type: "academic",
    },
    {
      id: "n2",
      title: "Low Stock Alert: Computers",
      message: "Dell Optiplex Desktops stock falls below minimum level.",
      date: "2026-06-03",
      type: "inventory",
    },
  ],
  parents: [
    {
      id: "p1",
      user: "u7",
      name: "James Potter",
      phone: "9876543211",
      email: "parent@school.com",
      children: ["s1"],
      status: "active",
    },
  ],
  auditLogs: [],
  classTimetables: [],
  onlineClasses: [],
  homework: [],
  exams: [
    {
      id: "ex-1",
      _id: "ex-1",
      name: "Mid-Term Evaluation — Islamic Studies & Quranic Sciences",
      title: "Mid-Term Evaluation — Islamic Studies & Quranic Sciences",
      term: "Term 1 (Mid-Term)",
      session: "2025-2026",
      date: "2026-09-15",
      startDate: "2026-09-15",
      endDate: "2026-09-25",
      status: "upcoming",
      totalStudents: 1248,
      subjectsCount: 8,
      createdAt: "2026-08-01",
      duration: "2 Hours 30 Mins",
      totalMarks: 100,
      passMarks: 40,
      venue: "Main Examination Hall & Block A Rooms",
      supervisor: "Sheikh Abdullah Al-Hafiz",
      description: "Comprehensive evaluation covering Quranic Tajweed, Hadith Studies, and Fiqh fundamentals.",
      classes: ["Grade 9 - Section A", "Grade 10 - Section A"],
      classNames: ["Grade 9 - Section A", "Grade 10 - Section A"],
      subjectSchedule: [
        { subjectName: "Quranic Sciences & Tajweed", subjectCode: "ISL-101", maxMarks: 100, passMarks: 40 },
        { subjectName: "Classical Arabic Grammar", subjectCode: "ARB-102", maxMarks: 100, passMarks: 40 },
        { subjectName: "Islamic History", subjectCode: "HIS-106", maxMarks: 100, passMarks: 40 },
      ],
    },
    {
      id: "ex-2",
      _id: "ex-2",
      name: "Annual Science & Practical Examination",
      title: "Annual Science & Practical Examination",
      term: "Annual Session",
      session: "2025-2026",
      date: "2026-09-20",
      startDate: "2026-09-20",
      endDate: "2026-09-28",
      status: "upcoming",
      totalStudents: 380,
      subjectsCount: 4,
      createdAt: "2026-08-02",
      duration: "3 Hours",
      totalMarks: 100,
      passMarks: 35,
      venue: "Physics & Chemistry Science Laboratories",
      supervisor: "Prof. Mohammed Zakir",
      description: "Practical and written assessment for Physics, Chemistry, and Biology laboratories.",
      classes: ["Grade 11 - Section A", "Grade 12 - Section A"],
      classNames: ["Grade 11 - Section A", "Grade 12 - Section A"],
      subjectSchedule: [
        { subjectName: "Physics Theory & Lab", subjectCode: "PHY-104", maxMarks: 100, passMarks: 35 },
        { subjectName: "Chemistry Lab Experiments", subjectCode: "CHM-107", maxMarks: 100, passMarks: 35 },
      ],
    },
  ],
  results: [],
  settings: {
    companyLogo: "",
    schoolName: "Hogwarts Academy of Excellence",
    academicYear: "2026-2027",
    contactEmail: "info@hogwarts.edu",
    currencySymbol: "$",
    enableSmsAlerts: false,
  },
};

let db = { ...initialDb };

// Ensure upload directory exists
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Load database from file if exists
const loadData = () => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      db = JSON.parse(raw);
      if (!db.exams) db.exams = initialDb.exams;
      if (!db.results) db.results = [];
      saveData();
    } else {
      saveData();
    }
  } catch (err) {
    console.error("Failed to load fallback db file, using in-memory.", err);
  }
};

const saveData = () => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write to fallback db file.", err);
  }
};

loadData();

// Generic fallback helpers
export const FallbackDb = {
  find: (collection) => {
    return db[collection] || [];
  },

  findById: (collection, id) => {
    const coll = db[collection] || [];
    return coll.find((item) => item.id === id || item._id === id);
  },

  findOne: (collection, queryObj) => {
    const coll = db[collection] || [];
    return coll.find((item) => {
      return Object.entries(queryObj).every(([key, val]) => item[key] === val);
    });
  },

  create: (collection, data) => {
    if (!db[collection]) db[collection] = [];
    const newRecord = {
      id: data.id || Math.random().toString(36).substring(2, 9),
      _id: data._id || Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
      ...data,
    };
    db[collection].push(newRecord);
    saveData();
    return newRecord;
  },

  insert: (collection, data) => {
    return FallbackDb.create(collection, data);
  },

  insertMany: (collection, items = []) => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => FallbackDb.create(collection, item));
  },

  update: (collection, id, data) => {
    if (!db[collection]) return null;
    const index = db[collection].findIndex(
      (item) => item.id === id || item._id === id
    );
    if (index === -1) return null;

    db[collection][index] = {
      ...db[collection][index],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    saveData();
    return db[collection][index];
  },

  delete: (collection, id) => {
    if (!db[collection]) return false;
    const initialLen = db[collection].length;
    db[collection] = db[collection].filter(
      (item) => item.id !== id && item._id !== id
    );
    const success = db[collection].length < initialLen;
    if (success) {
      saveData();
    }
    return success;
  },

  getSettings: () => {
    return db.settings;
  },

  updateSettings: (newSettings) => {
    db.settings = { ...db.settings, ...newSettings };
    saveData();
    return db.settings;
  },
};
