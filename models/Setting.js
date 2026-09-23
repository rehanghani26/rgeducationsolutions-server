import mongoose from "mongoose";

const SettingSchema = new mongoose.Schema(
  {
    // School Information
    schoolName: {
      type: String,
      default: "RGES School & College ERP",
    },
    schoolCode: {
      type: String,
      default: "",
    },
    registrationNumber: {
      type: String,
      default: "",
    },
    affiliationNumber: {
      type: String,
      default: "",
    },
    schoolType: {
      type: String,
      enum: ["primary", "secondary", "senior", "college", "university"],
      default: "secondary",
    },
    establishedYear: {
      type: Number,
      default: new Date().getFullYear(),
    },
    academicYear: {
      type: String,
      default: "2026-2027",
    },

    // Contact Information
    contactEmail: {
      type: String,
      default: "admin@school.com",
    },
    schoolPhone: {
      type: String,
      default: "",
    },
    alternatePhone: {
      type: String,
      default: "",
    },
    websiteUrl: {
      type: String,
      default: "",
    },

    // Address Information
    addressLine1: {
      type: String,
      default: "",
    },
    addressLine2: {
      type: String,
      default: "",
    },
    city: {
      type: String,
      default: "",
    },
    state: {
      type: String,
      default: "",
    },
    country: {
      type: String,
      default: "",
    },
    postalCode: {
      type: String,
      default: "",
    },

    // Branding & Identity
    companyLogo: {
      type: String,
      default: "",
    },
    schoolLogo: {
      type: String,
      default: "",
    },
    schoolLogoPublicId: {
      type: String,
      default: "",
    },
    schoolLogoAssetId: {
      type: String,
      default: "",
    },
    schoolLogoName: {
      type: String,
      default: "",
    },
    schoolBanner: {
      type: String,
      default: "",
    },
    schoolBannerPublicId: {
      type: String,
      default: "",
    },
    schoolBannerAssetId: {
      type: String,
      default: "",
    },
    schoolBannerName: {
      type: String,
      default: "",
    },
    schoolMotto: {
      type: String,
      default: "",
    },
    principalName: {
      type: String,
      default: "",
    },
    currencySymbol: {
      type: String,
      default: "$",
    },

    // Official Institutional Document Templates (Finalized Formats)
    defaultDocumentTemplates: {
      studentIdCard: {
        templateId: { type: String, default: "student-id-classic" },
        customTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomDocumentTemplate", default: null },
        configuration: { type: mongoose.Schema.Types.Mixed, default: {} },
        name: { type: String, default: "Classic Student Card" },
        finalizedAt: { type: Date, default: Date.now },
        finalizedBy: { type: String, default: "System" },
      },
      teacherIdCard: {
        templateId: { type: String, default: "teacher-id-professional" },
        customTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomDocumentTemplate", default: null },
        configuration: { type: mongoose.Schema.Types.Mixed, default: {} },
        name: { type: String, default: "Professional Faculty Card" },
        finalizedAt: { type: Date, default: Date.now },
        finalizedBy: { type: String, default: "System" },
      },
      staffIdCard: {
        templateId: { type: String, default: "staff-id-corporate" },
        customTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomDocumentTemplate", default: null },
        configuration: { type: mongoose.Schema.Types.Mixed, default: {} },
        name: { type: String, default: "Corporate Staff Card" },
        finalizedAt: { type: Date, default: Date.now },
        finalizedBy: { type: String, default: "System" },
      },
      certificate: {
        templateId: { type: String, default: "certificate-classic" },
        customTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomDocumentTemplate", default: null },
        configuration: { type: mongoose.Schema.Types.Mixed, default: {} },
        name: { type: String, default: "Classic Institutional Certificate" },
        finalizedAt: { type: Date, default: Date.now },
        finalizedBy: { type: String, default: "System" },
      },
    },

    // Teacher Settings
    autoGenerateTeacherID: {
      type: Boolean,
      default: true,
    },
    teacherIDPrefix: {
      type: String,
      default: "T",
    },
    maxTeachersPerClass: {
      type: Number,
      default: 5,
    },

    // Student Settings
    autoGenerateAdmissionNumber: {
      type: Boolean,
      default: true,
    },
    admissionNumberPrefix: {
      type: String,
      default: "STU",
    },
    defaultStudentPassword: {
      type: String,
      default: "password",
    },
    maxStudentsPerSection: {
      type: Number,
      default: 50,
    },

    // Inventory Settings
    enableInventoryTracking: {
      type: Boolean,
      default: true,
    },
    lowStockAlert: {
      type: Boolean,
      default: true,
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
    },
    enableBarcode: {
      type: Boolean,
      default: false,
    },

    // Timesheet Settings
    enableTimesheet: {
      type: Boolean,
      default: true,
    },
    timesheetFrequency: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      default: "monthly",
    },
    overtimeMultiplier: {
      type: Number,
      default: 1.5,
    },
    attendanceRequirement: {
      type: Number,
      default: 85,
      min: 0,
      max: 100,
    },

    // Policy Settings
    enableLeavePolicy: {
      type: Boolean,
      default: true,
    },
    annualLeaveDays: {
      type: Number,
      default: 15,
    },
    sickLeaveDays: {
      type: Number,
      default: 10,
    },
    enablePerformanceReview: {
      type: Boolean,
      default: true,
    },
    reviewFrequency: {
      type: String,
      enum: ["monthly", "quarterly", "semi-annual", "annual"],
      default: "quarterly",
    },

    // Access Settings
    enableTwoFactor: {
      type: Boolean,
      default: false,
    },
    sessionTimeout: {
      type: Number,
      default: 30,
    },
    passwordExpiry: {
      type: Number,
      default: 90,
    },

    // Academic Settings
    defaultPassingPercentage: {
      type: Number,
      default: 40,
      min: 0,
      max: 100,
    },
    gradePointScale: {
      type: Number,
      default: 4.0,
    },
    enableGradeDistribution: {
      type: Boolean,
      default: true,
    },

    // Finance Settings
    enableInstallmentPayment: {
      type: Boolean,
      default: true,
    },
    lateFeesPercentage: {
      type: Number,
      default: 5,
    },
    enableAutoReminder: {
      type: Boolean,
      default: true,
    },
    reminderDaysBefore: {
      type: Number,
      default: 5,
    },

    // Notifications
    enableSmsAlerts: {
      type: Boolean,
      default: false,
    },
    enableEmailAlerts: {
      type: Boolean,
      default: true,
    },
    enablePushNotifications: {
      type: Boolean,
      default: false,
    },

    // Security Settings
    enableDataEncryption: {
      type: Boolean,
      default: true,
    },
    enableAuditLog: {
      type: Boolean,
      default: true,
    },

    // Backup Settings
    autoBackupEnabled: {
      type: Boolean,
      default: true,
    },
    backupFrequency: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      default: "daily",
    },

    // Public School Portal Settings
    portalSettings: {
      enabled: { type: Boolean, default: true },
      schoolName: { type: String, default: "Apex International Academy" },
      affiliation: {
        type: String,
        default: "Affiliated to Central Board & Cambridge Curriculum",
      },
      affiliationCode: { type: String, default: "SCH-2026-CBSE-9912" },
      tagline: {
        type: String,
        default: "Quality Education for a Better Future",
      },
      heroImage: {
        type: String,
        default:
          "https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=1600&auto=format&fit=crop",
      },
      heroSubtitle: {
        type: String,
        default:
          "Nurturing young minds towards excellence, character, and lifelong curiosity in a world-class environment.",
      },
      admissionBadge: {
        type: String,
        default: "Admissions Open for 2026-2027",
      },
      aboutTitle: { type: String, default: "About Our School" },
      aboutDescription: {
        type: String,
        default:
          "Our school provides quality education in a safe and friendly environment with experienced teachers and modern learning facilities.",
      },
      principalName: { type: String, default: "Dr. Eleanor Vance, Ph.D." },
      principalRole: { type: String, default: "Principal & Head of School" },
      principalMessage: {
        type: String,
        default:
          "Education is not merely the transmission of facts, but the ignition of curiosity, compassion, and leadership in every young mind that walks through our gates.",
      },
      principalImage: {
        type: String,
        default:
          "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=400&auto=format&fit=crop",
      },
      facilities: {
        type: Array,
        default: [
          {
            title: "Experienced Teachers",
            badge: "Experienced",
            description:
              "Passionate, certified faculty committed to student mentorship and academic success.",
            icon: "teachers",
            gradient: "from-blue-500 to-indigo-600",
          },
          {
            title: "Good Classrooms",
            badge: "Modern",
            description:
              "Spacious, climate-controlled, smart interactive digital board learning spaces.",
            icon: "classrooms",
            gradient: "from-emerald-500 to-teal-600",
          },
          {
            title: "Sports & Activities",
            badge: "Sports & Events",
            description:
              "Olympic-standard sports courts, football turf, performing arts, and annual fest.",
            icon: "activities",
            gradient: "from-amber-500 to-orange-600",
          },
        ],
      },
      extendedFacilities: {
        type: Array,
        default: [
          {
            title: "AI & Robotics Laboratories",
            desc: "Coding, AI literacy, 3D printing and STEM robotics workstations.",
            icon: "compass",
          },
          {
            title: "Central Media Library",
            desc: "Over 15,000 physical volumes and digital academic research journals.",
            icon: "book",
          },
          {
            title: "GPS-Tracked Safe Transport",
            desc: "Climate-controlled bus fleet with real-time GPS tracking and trained attendants.",
            icon: "bus",
          },
        ],
      },
      metrics: {
        type: Array,
        default: [
          { label: "Happy Students", value: "1,500+" },
          { label: "Board Exam Distinction", value: "98.8%" },
          { label: "Experienced Teachers", value: "50+" },
          { label: "Sports & Clubs", value: "25+" },
        ],
      },
      notices: {
        type: Array,
        default: [
          {
            title:
              "Admissions Open for Academic Year 2026-2027 (Limited Seats Available)",
            date: "Sep 05, 2026",
            tag: "Admissions",
            urgent: true,
          },
          {
            title:
              "Annual Inter-School Robotics & STEM Innovation Fair Next Friday",
            date: "Sep 12, 2026",
            tag: "Events",
            urgent: false,
          },
          {
            title:
              "Term 1 Comprehensive Assessment Schedule & Parent-Teacher Meeting",
            date: "Sep 20, 2026",
            tag: "Academic",
            urgent: false,
          },
        ],
      },
      academicWings: {
        type: Array,
        default: [
          {
            title: "Pre-Primary Wing (Early Years)",
            grades: "Playgroup to Kindergarten (Ages 3 – 5)",
            tag: "Play & Discovery",
            description:
              "A safe, sensory-rich play-based curriculum focusing on social skills, phonics, and motor coordination.",
            subjects: [
              "Phonics & Pre-Reading",
              "Sensory Play & Art",
              "Numbers & Shapes",
              "Music & Movement",
            ],
          },
          {
            title: "Primary School Wing",
            grades: "Grades 1 to 5 (Ages 6 – 10)",
            tag: "Foundations & Inquiry",
            description:
              "Building strong conceptual understanding in mathematics, languages, science, and collaborative projects.",
            subjects: [
              "Core Mathematics",
              "English Language Arts",
              "General Science",
              "Social Studies",
            ],
          },
          {
            title: "Middle School Wing",
            grades: "Grades 6 to 8 (Ages 11 – 13)",
            tag: "Exploration & Analysis",
            description:
              "Transitioning into independent analytical thinking, hands-on scientific experiments, and computer coding.",
            subjects: [
              "Physics, Chemistry, Biology",
              "Advanced Algebra",
              "Python & Digital Skills",
              "Debate & World Cultures",
            ],
          },
          {
            title: "Senior Secondary Wing",
            grades: "Grades 9 to 12 (Ages 14 – 18)",
            tag: "Career & College Prep",
            description:
              "Pre-university streams (Science, Commerce, Humanities) guided by experienced board educators.",
            subjects: [
              "Science: PCM / PCB",
              "Commerce & Accountancy",
              "Humanities & Social Sciences",
              "SAT / College Counseling",
            ],
          },
        ],
      },
      admissionSteps: {
        type: Array,
        default: [
          {
            step: "01",
            title: "Submit Online Inquiry",
            subtitle: "Quick & Transparent",
            description:
              "Fill out the simple admission inquiry form online. Our academic counselors will contact you within 24 hours.",
            badge: "Step 1: Get Started",
          },
          {
            step: "02",
            title: "Campus Tour & Assessment",
            subtitle: "Discover & Interact",
            description:
              "Experience our classrooms, sports complex, and labs. Students participate in a friendly, age-appropriate conversation.",
            badge: "Step 2: Experience",
          },
          {
            step: "03",
            title: "Enrollment & Welcome",
            subtitle: "Join the Family",
            description:
              "Finalize document verification, receive your ERP parent credentials, uniform kit, and attend orientation!",
            badge: "Step 3: Welcome",
          },
        ],
      },
      ageCriteria: {
        type: Array,
        default: [
          {
            grade: "Pre-Nursery / Playgroup",
            age: "2.5 – 3 Years",
            cutoff: "As of March 31, 2026",
          },
          {
            grade: "Kindergarten 1 (LKG)",
            age: "3.5 – 4 Years",
            cutoff: "As of March 31, 2026",
          },
          {
            grade: "Kindergarten 2 (UKG)",
            age: "4.5 – 5 Years",
            cutoff: "As of March 31, 2026",
          },
          {
            grade: "Grade 1",
            age: "5.5 – 6.5 Years",
            cutoff: "As of March 31, 2026",
          },
          {
            grade: "Grade 2 to Grade 5",
            age: "Age appropriate + Report card",
            cutoff: "Subject to seat availability",
          },
          {
            grade: "Grade 6 to Grade 10",
            age: "Diagnostic assessment & interview",
            cutoff: "Subject to seat availability",
          },
        ],
      },
      documents: {
        type: Array,
        default: [
          "Child’s Official Birth Certificate (Municipal copy)",
          "Recent passport-sized color photographs of student (4 copies)",
          "Photographs of Parents / Guardians (2 copies each)",
          "Academic progress report card from previous school",
          "Original Transfer Certificate (TC)",
          "Proof of residential address",
          "Immunization medical record",
        ],
      },
      galleryItems: {
        type: Array,
        default: [
          {
            id: 1,
            title: "Smart Digital Classrooms",
            category: "classrooms",
            tag: "Interactive Tech",
            img: "https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=800&auto=format&fit=crop",
          },
          {
            id: 2,
            title: "Advanced Science & Robotics Lab",
            category: "academics",
            tag: "Innovation & STEM",
            img: "https://images.unsplash.com/photo-1562774053-701939374585?q=80&w=800&auto=format&fit=crop",
          },
          {
            id: 3,
            title: "Annual Athletics & Football Field",
            category: "sports",
            tag: "Sports Complex",
            img: "https://images.unsplash.com/photo-1577495508048-b635879837f1?q=80&w=800&auto=format&fit=crop",
          },
          {
            id: 4,
            title: "Creative Performing Arts Center",
            category: "cultural",
            tag: "Music & Drama",
            img: "https://images.unsplash.com/photo-1511632765486-a01980e01a18?q=80&w=800&auto=format&fit=crop",
          },
        ],
      },
      faqs: {
        type: Array,
        default: [
          {
            q: "What curriculum and accreditation does the school follow?",
            a: "Our school follows a globally benchmarked dual curriculum combining high academic standards with STEM, humanities, and practical project-based learning.",
            tag: "Curriculum",
          },
          {
            q: "How does the school ensure student safety and campus security?",
            a: "We maintain 24/7 CCTV surveillance, biometric security gates, verified background checks for all faculty, and GPS-tracked school transport.",
            tag: "Safety & Security",
          },
          {
            q: "What is the teacher-to-student ratio in classrooms?",
            a: "We maintain an optimal ratio of 1:18 to ensure every child receives personalized attention, guidance, and emotional support.",
            tag: "Faculty & Mentorship",
          },
          {
            q: "What sports and extracurricular activities are offered?",
            a: "Students can participate in football, swimming, cricket, robotics, music, drama, debate, chess, and international Model UN conferences.",
            tag: "Sports & Arts",
          },
        ],
      },
      milestones: {
        type: Array,
        default: [
          {
            year: "2004",
            title: "Campus Founded",
            desc: "Started with 120 students and a vision for holistic schooling.",
          },
          {
            year: "2012",
            title: "STEM & Robotics Hub",
            desc: "Introduced 3D printing and coding for middle schoolers.",
          },
          {
            year: "2018",
            title: "National Sports Award",
            desc: "Recognized for top sporting infrastructure in the state.",
          },
          {
            year: "2026",
            title: "Global Dual Accreditation",
            desc: "Now serving over 1,500 students with 100% board distinctions.",
          },
        ],
      },
      departments: {
        type: Array,
        default: [
          {
            title: "Admissions & Campus Tours",
            phone: "+1 (555) 234-5678",
            email: "admissions@apexschool.edu",
            hours: "Mon – Sat: 8:00 AM – 4:00 PM",
          },
          {
            title: "Principal & Academic Office",
            phone: "+1 (555) 234-5680",
            email: "principal@apexschool.edu",
            hours: "By prior appointment only",
          },
          {
            title: "Transport & Safety Helpline",
            phone: "+1 (555) 234-5699",
            email: "transport@apexschool.edu",
            hours: "6:30 AM – 6:00 PM on school days",
          },
        ],
      },
      contact: {
        address: {
          type: String,
          default: "124 Academic Enclave, Knowledge Park, City Center",
        },
        phone: { type: String, default: "+1 (555) 234-5678" },
        email: { type: String, default: "admissions@apexschool.edu" },
        timing: {
          type: String,
          default:
            "Monday – Friday: 08:00 AM – 03:30 PM | Saturday: 08:30 AM – 12:30 PM",
        },
      },
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Setting", SettingSchema);
