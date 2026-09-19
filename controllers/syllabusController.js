import ClassSyllabus from "../models/ClassSyllabus.js";
import { checkFallback } from "../config/db.js";
import { FallbackDb } from "../services/dbFallback.js";

// Standard default syllabus templates generator
export const getDefaultCurriculumForClass = (classIdentifier) => {
  const norm = String(classIdentifier || "").toLowerCase().trim();
  let cleanName = classIdentifier;

  // Derive human friendly name
  if (norm.includes("nur")) cleanName = "Nursery";
  else if (norm.includes("lkg")) cleanName = "LKG";
  else if (norm.includes("ukg")) cleanName = "UKG";
  else if (norm.includes("passout")) cleanName = "Passout";
  else {
    const numMatch = norm.match(/\d+/);
    if (numMatch) {
      cleanName = `Class ${numMatch[0]}`;
    }
  }

  const yr = new Date().getFullYear();
  const academicYear = `${yr}-${yr + 1}`;

  // Check grade level
  const num = parseInt((norm.match(/\d+/) || [])[0] || "0", 10);

  let subjects = [];

  if (norm.includes("nur") || norm.includes("lkg") || norm.includes("ukg")) {
    subjects = [
      {
        subjectName: "English Alphabet & Rhymes",
        subjectCode: "ENG-PRE",
        bookName: "Phonics & Rhymes Fun",
        author: "Early Learning Guild",
        publisher: "Scholastic Early Steps",
        maxMarks: 50,
        passMarks: 20,
      },
      {
        subjectName: "Mathematics (Numbers)",
        subjectCode: "MATH-PRE",
        bookName: "Numbers & Shapes Explorer",
        author: "Foundation Press",
        publisher: "Bright Kids Publishing",
        maxMarks: 50,
        passMarks: 20,
      },
      {
        subjectName: "General Awareness & EVS",
        subjectCode: "GA-PRE",
        bookName: "My First Picture World",
        author: "Flora Davis",
        publisher: "Oxford Toddler Series",
        maxMarks: 50,
        passMarks: 20,
      },
      {
        subjectName: "Art, Craft & Rhymes",
        subjectCode: "ART-PRE",
        bookName: "Colors & Creativity Part 1",
        author: "Creative Hands",
        publisher: "Rainbow Publications",
        maxMarks: 50,
        passMarks: 20,
      },
    ];
  } else if (num >= 1 && num <= 5) {
    subjects = [
      {
        subjectName: "English",
        subjectCode: `ENG-${num}01`,
        bookName: num === 1 ? "Our English" : `Marigold Part ${num}`,
        author: "NCERT / State Curriculum Panel",
        publisher: "National Council of Educational Research",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "Mathematics",
        subjectCode: `MATH-${num}01`,
        bookName: `Math Magic - Book ${num}`,
        author: "NCERT Primary Maths Panel",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "Hindi",
        subjectCode: `HIN-${num}01`,
        bookName: `Rimjhim Part ${num}`,
        author: "NCERT Language Wing",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "Environmental Studies (EVS)",
        subjectCode: `EVS-${num}01`,
        bookName: num === 1 ? "Our World & EVS" : `Looking Around - Grade ${num}`,
        author: "Environmental Sciences Team",
        publisher: "NCERT Books",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "Computer Science",
        subjectCode: `CS-${num}01`,
        bookName: `Cyber Hub & IT Basics - Vol ${num}`,
        author: "Tech Innovations Faculty",
        publisher: "EduTech Global",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "General Knowledge",
        subjectCode: `GK-${num}01`,
        bookName: `Knowledge Tree Grade ${num}`,
        author: "Global Quiz Guild",
        publisher: "Pearson Kids",
        maxMarks: 50,
        passMarks: 18,
      },
    ];
  } else if (num >= 6 && num <= 8) {
    subjects = [
      {
        subjectName: "English",
        subjectCode: `ENG-${num}01`,
        bookName: "Honeysuckle & A Pact with the Sun",
        author: "NCERT English Wing",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "Mathematics",
        subjectCode: `MATH-${num}01`,
        bookName: `Mathematics for Class ${num}`,
        author: "Dr. R.S. Aggarwal & NCERT",
        publisher: "NCERT & Bharti Bhawan",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "Science",
        subjectCode: `SCI-${num}01`,
        bookName: `Science & Technology Grade ${num}`,
        author: "Science Study Group",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "Social Science",
        subjectCode: `SST-${num}01`,
        bookName: "Our Pasts & The Earth: Our Habitat",
        author: "History & Geography Wing",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "Hindi",
        subjectCode: `HIN-${num}01`,
        bookName: `Vasant Part ${num - 5}`,
        author: "NCERT Hindi Parishad",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 35,
      },
      {
        subjectName: "Information Technology",
        subjectCode: `IT-${num}01`,
        bookName: `Code Craft & AI Horizons Grade ${num}`,
        author: "IIT Computer Dept Advisory",
        publisher: "EduTech Press",
        maxMarks: 100,
        passMarks: 35,
      },
    ];
  } else if (num >= 9 && num <= 10) {
    subjects = [
      {
        subjectName: "English Language & Literature",
        subjectCode: "ENG-184",
        bookName: num === 9 ? "Beehive & Moments" : "First Flight & Footprints Without Feet",
        author: "Central Board Language Committee",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 33,
      },
      {
        subjectName: "Mathematics",
        subjectCode: "MATH-041",
        bookName: `Mathematics Class ${num} (Standard & Basic)`,
        author: "NCERT & R.D. Sharma",
        publisher: "NCERT / Dhanpat Rai",
        maxMarks: 100,
        passMarks: 33,
      },
      {
        subjectName: "Science",
        subjectCode: "SCI-086",
        bookName: `Science - Theory & Practical Class ${num}`,
        author: "NCERT Science Department",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 33,
      },
      {
        subjectName: "Social Science",
        subjectCode: "SST-087",
        bookName: "India & Contemporary World / Democratic Politics",
        author: "NCERT Social Sciences",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 33,
      },
      {
        subjectName: "Hindi Course-A",
        subjectCode: "HIN-002",
        bookName: num === 9 ? "Kshitij Part 1 & Kritika Part 1" : "Kshitij Part 2 & Kritika Part 2",
        author: "NCERT",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 33,
      },
      {
        subjectName: "Information Technology",
        subjectCode: "IT-402",
        bookName: "Employability & Vocational Subject Skills",
        author: "CBSE Vocational Wing",
        publisher: "CBSE / NCERT",
        maxMarks: 100,
        passMarks: 33,
      },
    ];
  } else {
    // Senior secondary or default
    subjects = [
      {
        subjectName: "English Core",
        subjectCode: "ENG-301",
        bookName: "Hornbill & Snapshots",
        author: "NCERT",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 33,
      },
      {
        subjectName: "Physics",
        subjectCode: "PHY-042",
        bookName: "Physics Part I & II",
        author: "NCERT Physics Department",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 33,
      },
      {
        subjectName: "Chemistry",
        subjectCode: "CHEM-043",
        bookName: "Chemistry Part I & II",
        author: "NCERT Chemistry Department",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 33,
      },
      {
        subjectName: "Mathematics",
        subjectCode: "MATH-041",
        bookName: "Mathematics Part I & II",
        author: "NCERT",
        publisher: "NCERT",
        maxMarks: 100,
        passMarks: 33,
      },
      {
        subjectName: "Computer Science",
        subjectCode: "CS-083",
        bookName: "Computer Science with Python",
        author: "Sumita Arora",
        publisher: "Dhanpat Rai & Co.",
        maxMarks: 100,
        passMarks: 33,
      },
    ];
  }

  return {
    classId: classIdentifier,
    className: cleanName,
    academicYear,
    description: `Official Curriculum & Prescribed Books for ${cleanName}`,
    subjects,
    isDefaultTemplate: true,
  };
};

// Normalize classId helper (e.g. "cls-1" or "Class 1" or "1" => "cls-1")
const normalizeClassId = (raw) => {
  if (!raw) return "";
  const str = String(raw).trim().toLowerCase();
  if (str.includes("nur")) return "cls-nur";
  if (str.includes("lkg")) return "cls-lkg";
  if (str.includes("ukg")) return "cls-ukg";
  if (str.includes("passout")) return "cls-passout";
  const num = str.match(/\d+/);
  if (num) return `cls-${num[0]}`;
  return str.replace(/\s+/g, "-");
};

/**
 * GET /api/v1/syllabus
 * List all saved syllabuses
 */
export const getAllSyllabus = async (req, res) => {
  try {
    if (checkFallback()) {
      const list = FallbackDb.find("syllabus") || [];
      return res.json({ success: true, count: list.length, syllabuses: list });
    }

    const syllabuses = await ClassSyllabus.find({}).sort({ className: 1 });
    return res.json({
      success: true,
      count: syllabuses.length,
      syllabuses,
    });
  } catch (error) {
    console.error("getAllSyllabus error:", error);
    return res.status(500).json({ success: false, message: "Server error fetching syllabuses" });
  }
};

/**
 * GET /api/v1/syllabus/:classId
 * Get syllabus for a specific class (or default template if none configured yet)
 */
export const getSyllabusByClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const normalized = normalizeClassId(classId);

    if (checkFallback()) {
      const list = FallbackDb.find("syllabus") || [];
      const found = list.find(
        (s) =>
          normalizeClassId(s.classId) === normalized ||
          String(s.className || "").toLowerCase() === String(classId).toLowerCase()
      );

      if (found) {
        return res.json({ success: true, syllabus: found });
      }

      // Return default template
      const defaultCurriculum = getDefaultCurriculumForClass(classId);
      return res.json({ success: true, syllabus: defaultCurriculum, isDefault: true });
    }

    // Try finding by exact classId or regex match
    let syllabus = await ClassSyllabus.findOne({
      $or: [
        { classId: classId },
        { classId: normalized },
        { className: new RegExp(`^${classId}$`, "i") },
      ],
    });

    if (!syllabus) {
      // Return default curriculum
      const defaultCurriculum = getDefaultCurriculumForClass(classId);
      return res.json({
        success: true,
        syllabus: defaultCurriculum,
        isDefault: true,
      });
    }

    return res.json({ success: true, syllabus, isDefault: false });
  } catch (error) {
    console.error("getSyllabusByClass error:", error);
    return res.status(500).json({ success: false, message: "Server error fetching class syllabus" });
  }
};

/**
 * PUT /api/v1/syllabus/:classId
 * Upsert class syllabus and subjects
 */
export const upsertClassSyllabus = async (req, res) => {
  try {
    const { classId } = req.params;
    const { className, academicYear, description, subjects } = req.body;

    const normalized = normalizeClassId(classId);
    const cleanClassName = className || classId;

    const validatedSubjects = (subjects || []).map((s) => ({
      subjectName: s.subjectName || "Subject",
      subjectCode: s.subjectCode || "",
      bookName: s.bookName || "",
      author: s.author || "",
      publisher: s.publisher || "",
      maxMarks: Number(s.maxMarks) || 100,
      passMarks: Number(s.passMarks) || 35,
    }));

    if (checkFallback()) {
      const list = FallbackDb.find("syllabus") || [];
      const existing = list.find(
        (s) =>
          normalizeClassId(s.classId) === normalized ||
          String(s.className || "").toLowerCase() === String(cleanClassName).toLowerCase()
      );

      let saved;
      if (existing) {
        saved = FallbackDb.update("syllabus", existing.id || existing._id, {
          className: cleanClassName,
          academicYear,
          description,
          subjects: validatedSubjects,
          updatedBy: req.user?.id,
        });
      } else {
        saved = FallbackDb.create("syllabus", {
          classId: normalized,
          className: cleanClassName,
          academicYear,
          description,
          subjects: validatedSubjects,
          updatedBy: req.user?.id,
        });
      }

      return res.json({
        success: true,
        message: `Curriculum and books for ${cleanClassName} saved successfully`,
        syllabus: saved,
      });
    }

    // MongoDB upsert
    const filter = {
      $or: [{ classId: normalized }, { classId: classId }, { className: cleanClassName }],
    };

    const updateData = {
      classId: normalized,
      className: cleanClassName,
      academicYear: academicYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
      description: description || `Prescribed curriculum and books for ${cleanClassName}`,
      subjects: validatedSubjects,
      updatedBy: req.user?._id || req.user?.id,
    };

    const syllabus = await ClassSyllabus.findOneAndUpdate(filter, updateData, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });

    return res.json({
      success: true,
      message: `Curriculum and books for ${cleanClassName} saved successfully`,
      syllabus,
    });
  } catch (error) {
    console.error("upsertClassSyllabus error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to save syllabus" });
  }
};

/**
 * POST /api/v1/syllabus/:classId/reset
 * Reset class syllabus to standard default
 */
export const resetClassSyllabus = async (req, res) => {
  try {
    const { classId } = req.params;
    const defaultTemplate = getDefaultCurriculumForClass(classId);

    // Call upsert with default template
    req.body = defaultTemplate;
    return upsertClassSyllabus(req, res);
  } catch (error) {
    console.error("resetClassSyllabus error:", error);
    return res.status(500).json({ success: false, message: "Failed to reset syllabus" });
  }
};
