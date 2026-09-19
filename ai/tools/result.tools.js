/**
 * @file result.tools.js
 * @description AI Tool definitions and executors for Results, Marksheets, and Grade Analytics.
 */

import Result from '../../models/Result.js';
import Exam from '../../models/Exam.js';
import Student from '../../models/Student.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';
import { getDefaultCurriculumForClass } from '../../controllers/syllabusController.js';

export const resultToolDefinitions = [
  {
    name: 'getClassResults',
    description:
      'View student results and marks for a specific examination and class/section. Returns list of students, obtained marks, total %, grades, rank, and publish status.',
    parameters: {
      type: 'object',
      properties: {
        examId: { type: 'string', description: 'Exam ID or exam name (e.g. "Testing 2", "Mid-Term").' },
        className: { type: 'string', description: 'Class name e.g. "Class 10", "Class 12 - Section A".' },
        section: { type: 'string', description: 'Section filter e.g. "Section A", "Section D", or "All".' },
        status: { type: 'string', description: '"draft" | "published".' },
      },
      required: ['examId'],
    },
  },
  {
    name: 'getStudentMarksheet',
    description:
      'Retrieve a detailed marksheet and performance report for an individual student by student name, roll number, or ID.',
    parameters: {
      type: 'object',
      properties: {
        studentIdentifier: { type: 'string', description: 'Student name, admission number, or roll number.' },
        examId: { type: 'string', description: 'Optional exam ID or name to get specific exam report card.' },
      },
      required: ['studentIdentifier'],
    },
  },
  {
    name: 'enterStudentMarks',
    description:
      'Record or enter marks for a student in an examination. Automatically calculates total, percentage, GPA, grade, and pass/fail status.',
    parameters: {
      type: 'object',
      properties: {
        examId: { type: 'string', description: 'The exam ID or name.' },
        studentName: { type: 'string', description: 'Student full name or admission number.' },
        className: { type: 'string', description: 'Class name e.g. "Class 10", "Class 12".' },
        section: { type: 'string', description: 'Section e.g. "Section A".' },
        marks: {
          type: 'array',
          description: 'Array of subject marks.',
          items: {
            type: 'object',
            properties: {
              subjectName: { type: 'string', description: 'Subject name e.g. "Mathematics", "English".' },
              bookName: { type: 'string', description: 'Prescribed book name e.g. "Math Magic", "Our English".' },
              obtained: { type: 'number', description: 'Marks obtained by student.' },
              maxMarks: { type: 'number', description: 'Maximum marks (default 100).' },
              passMarks: { type: 'number', description: 'Passing marks (default 35).' },
            },
            required: ['subjectName', 'obtained'],
          },
        },
        remarks: { type: 'string', description: 'Teacher remarks e.g. "Excellent analytical skills".' },
      },
      required: ['examId', 'studentName', 'marks'],
    },
  },
  {
    name: 'bulkAssignExamMarks',
    description:
      'Bulk generate and enter marks for all students in an exam across all sections (or a specific section). Use when the user requests to "pass all students with random marks", "auto enter marks for class", or "set random passing marks in draft". Executes instantly in one step for all students.',
    parameters: {
      type: 'object',
      properties: {
        examId: { type: 'string', description: 'Exam ID or name e.g. "Testing 2" or "6aae4b928bbc07d271ed30c5" (required).' },
        className: { type: 'string', description: 'Target class name e.g. "Class 12". Defaults to exam classes.' },
        section: { type: 'string', description: 'Specific section e.g. "Section A" or "All" for all sections (default: "All").' },
        passAll: { type: 'boolean', description: 'If true, generates marks guaranteeing every student passes (default: true).' },
        minMarks: { type: 'number', description: 'Minimum marks per subject (default: passing mark + 5, e.g. 40).' },
        maxMarks: { type: 'number', description: 'Maximum marks per subject (default: 95).' },
        status: { type: 'string', description: '"draft" | "published" (default "draft").' },
      },
      required: ['examId'],
    },
  },
  {
    name: 'publishExamResults',
    description:
      'Publish and declare exam results for a class or section so that students, parents, and teachers can view and download report cards.',
    parameters: {
      type: 'object',
      properties: {
        examId: { type: 'string', description: 'Exam ID or name.' },
        className: { type: 'string', description: 'Class name e.g. "Class 10" or "Class 12".' },
        section: { type: 'string', description: 'Section filter e.g. "Section A" or "All".' },
      },
      required: ['examId'],
    },
  },
  {
    name: 'getExamAnalytics',
    description:
      'Get comprehensive performance analytics for an exam: top rankers (toppers), highest percentage, class average, pass rate, and grade distribution (A+, A, B, C, D, F).',
    parameters: {
      type: 'object',
      properties: {
        examId: { type: 'string', description: 'Exam ID or name.' },
        className: { type: 'string', description: 'Optional class name to filter analytics.' },
      },
      required: ['examId'],
    },
  },
];

export const resultToolExecutors = {
  async getClassResults(args, context) {
    const { examId, className, section, status } = args;

    // Resolve exam
    let exam = null;
    if (checkFallback()) {
      exam = FallbackDb.findById('exams', examId) ||
        (FallbackDb.find('exams') || []).find((e) => e.name?.toLowerCase().includes(examId.toLowerCase()));
    } else {
      exam = await Exam.findById(examId).catch(() => null);
      if (!exam) exam = await Exam.findOne({ name: new RegExp(examId, 'i') });
    }

    const resolvedExamId = exam ? (exam._id || exam.id) : examId;

    if (checkFallback()) {
      let results = (FallbackDb.find('results') || []).filter(
        (r) => String(r.examId) === String(resolvedExamId)
      );
      if (className) {
        const baseClass = className.split(/\s*[-–—|]\s*/)[0].trim().toLowerCase();
        results = results.filter((r) =>
          String(r.className || r.class || '').toLowerCase().includes(baseClass)
        );
      }
      if (section && section !== 'All' && section !== 'all') {
        results = results.filter((r) =>
          String(r.section || '').toLowerCase() === section.toLowerCase()
        );
      }
      if (status) results = results.filter((r) => r.status === status);

      return {
        success: true,
        examName: exam?.name || 'Examination',
        count: results.length,
        results: results.map(formatResult),
      };
    }

    const filter = { examId: resolvedExamId };
    if (className) {
      const baseClass = className.split(/\s*[-–—|]\s*/)[0].trim();
      filter.$or = [
        { className: new RegExp(baseClass, 'i') },
        { classId: className },
      ];
    }
    if (section && section !== 'All' && section !== 'all') {
      filter.section = new RegExp(`^${section.replace(/section\s*/i, '').trim()}$|^${section}$`, 'i');
    }
    if (status) filter.status = status;

    const results = await Result.find(filter).sort({ rank: 1, percentage: -1 });

    return {
      success: true,
      examName: exam?.name || 'Examination',
      count: results.length,
      results: results.map(formatResult),
    };
  },

  async getStudentMarksheet(args, context) {
    const { studentIdentifier, examId } = args;

    // Resolve student
    let student = null;
    if (checkFallback()) {
      student = (FallbackDb.find('students') || []).find((s) =>
        s.name?.toLowerCase().includes(studentIdentifier.toLowerCase()) ||
        s.admissionNumber?.toLowerCase() === studentIdentifier.toLowerCase() ||
        String(s.rollNumber) === String(studentIdentifier)
      );
    } else {
      student = await Student.findOne({
        $or: [
          { name: new RegExp(studentIdentifier, 'i') },
          { admissionNumber: studentIdentifier.toUpperCase() },
          { email: studentIdentifier.toLowerCase() },
        ],
      });
    }

    if (!student) {
      return { success: false, error: `Student "${studentIdentifier}" not found in student registry.` };
    }

    const studentId = student._id || student.id;

    if (checkFallback()) {
      let results = (FallbackDb.find('results') || []).filter(
        (r) => String(r.studentId) === String(studentId)
      );
      if (examId) {
        results = results.filter((r) => String(r.examId).includes(examId));
      }
      return {
        success: true,
        student: {
          name: student.name,
          rollNumber: student.rollNumber,
          admissionNumber: student.admissionNumber,
          class: student.class || student.className,
          section: student.section || student.sectionName,
        },
        resultsCount: results.length,
        results: results.map(formatResult),
      };
    }

    const filter = { studentId };
    if (examId) filter.examId = examId;

    const results = await Result.find(filter)
      .populate('examId', 'name term session')
      .sort({ createdAt: -1 });

    return {
      success: true,
      student: {
        name: student.name,
        rollNumber: student.rollNumber,
        admissionNumber: student.admissionNumber,
        class: student.class || student.className,
        section: student.section || student.sectionName,
      },
      resultsCount: results.length,
      results: results.map(formatResult),
    };
  },

  async enterStudentMarks(args, context) {
    const { examId, studentName, className, section, marks = [], remarks } = args;

    // Resolve exam
    let exam = null;
    if (checkFallback()) {
      exam = FallbackDb.findById('exams', examId) ||
        (FallbackDb.find('exams') || []).find((e) => e.name?.toLowerCase().includes(examId.toLowerCase()));
    } else {
      exam = await Exam.findById(examId).catch(() => null);
      if (!exam) exam = await Exam.findOne({ name: new RegExp(examId, 'i') });
    }

    if (!exam) return { success: false, error: `Exam "${examId}" not found.` };
    const resolvedExamId = exam._id || exam.id;

    // Resolve student
    let student = null;
    if (checkFallback()) {
      student = (FallbackDb.find('students') || []).find((s) =>
        s.name?.toLowerCase().includes(studentName.toLowerCase()) ||
        s.admissionNumber?.toLowerCase() === studentName.toLowerCase()
      );
    } else {
      student = await Student.findOne({
        $or: [
          { name: new RegExp(studentName, 'i') },
          { admissionNumber: studentName.toUpperCase() },
        ],
      });
    }

    if (!student) return { success: false, error: `Student "${studentName}" not found.` };
    const resolvedStudentId = student._id || student.id;

    // Calculate marks summary
    let totalObtained = 0;
    let totalMax = 0;
    let anyFailed = false;

    const enrichedMarks = marks.map((m) => {
      const obt = Number(m.obtained) || 0;
      const mx = Number(m.maxMarks) || 100;
      const pass = Number(m.passMarks) || 35;
      totalObtained += obt;
      totalMax += mx;
      if (obt < pass) anyFailed = true;

      return {
        subjectName: m.subjectName,
        bookName: m.bookName || '',
        obtained: obt,
        maxMarks: mx,
        passMarks: pass,
        grade: calculateGrade((obt / mx) * 100),
      };
    });

    const percentage = totalMax > 0 ? parseFloat(((totalObtained / totalMax) * 100).toFixed(1)) : 0;
    const grade = calculateGrade(percentage);
    const gpa = parseFloat((percentage / 9.5).toFixed(1));

    const resultPayload = {
      examId: resolvedExamId,
      studentId: resolvedStudentId,
      studentName: student.name,
      studentEmail: student.email || '',
      admissionNumber: student.admissionNumber,
      rollNumber: student.rollNumber,
      classId: className || student.className || 'Class 10',
      className: className || student.className || 'Class 10',
      section: section || student.section || 'Section A',
      marks: enrichedMarks,
      totalMarks: totalObtained,
      totalMaxMarks: totalMax,
      percentage,
      grade,
      gpa,
      isPassed: !anyFailed,
      remarks: remarks || `Scored ${percentage}% with grade ${grade}`,
      status: 'draft',
    };

    if (checkFallback()) {
      const existing = (FallbackDb.find('results') || []).find(
        (r) => String(r.examId) === String(resolvedExamId) && String(r.studentId) === String(resolvedStudentId)
      );
      if (existing) {
        FallbackDb.update('results', existing.id || existing._id, resultPayload);
      } else {
        FallbackDb.create('results', resultPayload);
      }
    } else {
      await Result.findOneAndUpdate(
        { examId: resolvedExamId, studentId: resolvedStudentId },
        resultPayload,
        { upsert: true, new: true }
      );
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'UPDATE',
      module: 'results',
      recordId: resolvedExamId,
      details: `AI entered marks for student ${student.name} in exam ${exam.name}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Marks recorded for ${student.name}: ${totalObtained}/${totalMax} (${percentage}%, Grade: ${grade}).`,
      result: resultPayload,
    };
  },

  async publishExamResults(args, context) {
    const { examId, className, section } = args;

    // Resolve exam
    let exam = null;
    if (checkFallback()) {
      exam = FallbackDb.findById('exams', examId) ||
        (FallbackDb.find('exams') || []).find((e) => e.name?.toLowerCase().includes(examId.toLowerCase()));
    } else {
      exam = await Exam.findById(examId).catch(() => null);
      if (!exam) exam = await Exam.findOne({ name: new RegExp(examId, 'i') });
    }

    if (!exam) return { success: false, error: `Exam "${examId}" not found.` };
    const resolvedExamId = exam._id || exam.id;

    let publishedCount = 0;

    if (checkFallback()) {
      const allResults = FallbackDb.find('results') || [];
      allResults.forEach((r) => {
        if (String(r.examId) === String(resolvedExamId)) {
          if (!section || section === 'All' || String(r.section || '').toLowerCase() === section.toLowerCase()) {
            FallbackDb.update('results', r.id || r._id, { status: 'published' });
            publishedCount++;
          }
        }
      });
    } else {
      const filter = { examId: resolvedExamId };
      if (section && section !== 'All') {
        filter.section = new RegExp(`^${section.replace(/section\s*/i, '').trim()}$|^${section}$`, 'i');
      }
      const res = await Result.updateMany(filter, { $set: { status: 'published' } });
      publishedCount = res.modifiedCount;
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'PUBLISH',
      module: 'results',
      recordId: resolvedExamId,
      details: `AI published ${publishedCount} results for exam ${exam.name}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Successfully declared and published ${publishedCount} results for "${exam.name}". Students can now view their report cards.`,
    };
  },

  async getExamAnalytics(args, context) {
    const { examId, className } = args;

    let exam = null;
    if (checkFallback()) {
      exam = FallbackDb.findById('exams', examId) ||
        (FallbackDb.find('exams') || []).find((e) => e.name?.toLowerCase().includes(examId.toLowerCase()));
    } else {
      exam = await Exam.findById(examId).catch(() => null);
      if (!exam) exam = await Exam.findOne({ name: new RegExp(examId, 'i') });
    }

    if (!exam) return { success: false, error: `Exam "${examId}" not found.` };
    const resolvedExamId = exam._id || exam.id;

    let results = [];
    if (checkFallback()) {
      results = (FallbackDb.find('results') || []).filter(
        (r) => String(r.examId) === String(resolvedExamId)
      );
      if (className) {
        results = results.filter((r) =>
          String(r.className || r.class || '').toLowerCase().includes(className.toLowerCase())
        );
      }
    } else {
      const filter = { examId: resolvedExamId };
      if (className) filter.className = new RegExp(className, 'i');
      results = await Result.find(filter).sort({ percentage: -1 });
    }

    if (!results.length) {
      return {
        success: true,
        examName: exam.name,
        message: 'No results recorded yet for this exam.',
        stats: { totalStudents: 0 },
      };
    }

    const totalStudents = results.length;
    const passedCount = results.filter((r) => r.isPassed !== false && r.percentage >= 35).length;
    const failedCount = totalStudents - passedCount;
    const passPercentage = parseFloat(((passedCount / totalStudents) * 100).toFixed(1));

    const totalPctSum = results.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0);
    const averageScore = parseFloat((totalPctSum / totalStudents).toFixed(1));

    // Grade Distribution
    const gradeDistribution = { 'A+': 0, 'A': 0, 'B+': 0, 'B': 0, 'C': 0, 'D': 0, 'F': 0 };
    results.forEach((r) => {
      const g = r.grade || 'F';
      if (gradeDistribution[g] !== undefined) gradeDistribution[g]++;
      else gradeDistribution['F']++;
    });

    // Toppers (top 3)
    const sorted = [...results].sort((a, b) => (b.percentage || 0) - (a.percentage || 0));
    const toppers = sorted.slice(0, 3).map((r, i) => ({
      rank: i + 1,
      name: r.studentName,
      percentage: `${r.percentage}%`,
      grade: r.grade,
      section: r.section || 'A',
    }));

    return {
      success: true,
      examName: exam.name,
      stats: {
        totalStudents,
        passedStudents: passedCount,
        failedStudents: failedCount,
        passRate: `${passPercentage}%`,
        classAverage: `${averageScore}%`,
        highestScore: `${sorted[0]?.percentage || 0}%`,
        toppers,
        gradeDistribution,
      },
    };
  },

  async bulkAssignExamMarks(args, context) {
    const {
      examId,
      className,
      section = 'All',
      passAll = true,
      minMarks,
      maxMarks = 95,
      status = 'draft',
    } = args;

    // 1. Resolve exam
    let exam = null;
    if (checkFallback()) {
      exam = FallbackDb.findById('exams', examId) ||
        (FallbackDb.find('exams') || []).find((e) => e.name?.toLowerCase().includes(examId.toLowerCase()));
    } else {
      exam = await Exam.findById(examId).catch(() => null);
      if (!exam) exam = await Exam.findOne({ name: new RegExp(examId, 'i') });
    }

    if (!exam) return { success: false, error: `Exam "${examId}" not found.` };
    const resolvedExamId = exam._id || exam.id;

    // 2. Resolve subjects
    let subjects = (exam.subjectSchedule || []).map((s) => ({
      subjectName: s.subjectName,
      subjectCode: s.subjectCode || '',
      bookName: s.bookName || '',
      maxMarks: Number(s.maxMarks) || 100,
      passMarks: Number(s.passMarks) || 33,
    }));

    const targetClassStr = className || exam.classes?.[0] || 'Class 12';
    const baseClass = targetClassStr.split(/\s*[-–—|]\s*/)[0].trim();

    if (!subjects.length) {
      const def = getDefaultCurriculumForClass(baseClass || 'Class 12');
      subjects = (def.subjects || []).map((s) => ({
        subjectName: s.subjectName,
        subjectCode: s.subjectCode || '',
        bookName: s.bookName || '',
        maxMarks: Number(s.maxMarks) || 100,
        passMarks: Number(s.passMarks) || 33,
      }));
    }

    let studentList = [];

    if (checkFallback()) {
      let allStudents = FallbackDb.find('students') || [];
      if (baseClass) {
        allStudents = allStudents.filter((s) =>
          String(s.class || s.className || s.classId || '').toLowerCase().includes(baseClass.toLowerCase())
        );
      }
      if (section && section !== 'All' && section !== 'all') {
        allStudents = allStudents.filter((s) =>
          String(s.section || s.sectionName || '').toLowerCase() === section.toLowerCase()
        );
      }

      const existingResults = (FallbackDb.find('results') || []).filter(
        (r) => String(r.examId) === String(resolvedExamId)
      );

      const studentMap = new Map();
      allStudents.forEach((s) =>
        studentMap.set(String(s.id || s._id), {
          id: s.id || s._id,
          name: s.name || `${s.firstName || ''} ${s.lastName || ''}`.trim(),
          email: s.email,
          admissionNumber: s.admissionNumber,
          rollNumber: s.rollNumber,
          className: s.className || s.class || baseClass,
          section: s.section || s.sectionName || 'A',
        })
      );

      existingResults.forEach((r) => {
        const sid = String(r.studentId);
        if (!studentMap.has(sid)) {
          studentMap.set(sid, {
            id: r.studentId,
            name: r.studentName,
            email: r.studentEmail,
            admissionNumber: r.admissionNumber,
            rollNumber: r.rollNumber,
            className: r.className || baseClass,
            section: r.section || 'A',
          });
        }
      });

      studentList = Array.from(studentMap.values());
      let processedCount = 0;

      for (const st of studentList) {
        let totalObt = 0;
        let totalMx = 0;
        const enrichedMarks = subjects.map((sub) => {
          const p = sub.passMarks || 33;
          const mx = sub.maxMarks || 100;
          const lower = passAll ? Math.max(p + 3, minMarks || p + 7) : (minMarks || 25);
          const upper = Math.min(mx, maxMarks || 95);
          const obt = Math.floor(Math.random() * (upper - lower + 1)) + lower;
          totalObt += obt;
          totalMx += mx;
          return {
            subjectName: sub.subjectName,
            subjectCode: sub.subjectCode || '',
            bookName: sub.bookName || '',
            obtained: obt,
            maxMarks: mx,
            passMarks: p,
            isPassed: obt >= p,
            grade: calculateGrade((obt / mx) * 100),
          };
        });

        const pct = parseFloat(((totalObt / totalMx) * 100).toFixed(1));
        const gr = calculateGrade(pct);
        const gpa = parseFloat((pct / 9.5).toFixed(1));

        const resultDoc = {
          examId: resolvedExamId,
          examName: exam.name,
          examTerm: exam.term,
          examSession: exam.session || '2026-2027',
          studentId: st.id,
          studentName: st.name,
          studentEmail: st.email || '',
          admissionNumber: st.admissionNumber || '',
          rollNumber: st.rollNumber ?? null,
          classId: st.className,
          className: st.className,
          section: st.section,
          marks: enrichedMarks,
          totalObtained: totalObt,
          totalMarks: totalObt,
          totalMaxMarks: totalMx,
          percentage: pct,
          grade: gr,
          gpa,
          isPassed: true,
          status: status || 'draft',
        };

        const existing = (FallbackDb.find('results') || []).find(
          (r) => String(r.examId) === String(resolvedExamId) && String(r.studentId) === String(st.id)
        );
        if (existing) {
          FallbackDb.update('results', existing.id || existing._id, resultDoc);
        } else {
          FallbackDb.create('results', resultDoc);
        }
        processedCount++;
      }

      return {
        success: true,
        message: `Successfully assigned random passing marks to ${processedCount} students for exam "${exam.name}" in ${status} status.`,
        examName: exam.name,
        processedCount,
        status,
        subjectsCount: subjects.length,
      };
    }

    // MongoDB Mode
    const studentQuery = {};
    if (baseClass) {
      studentQuery.$or = [
        { className: new RegExp(baseClass, 'i') },
        { class: new RegExp(baseClass, 'i') },
        { classId: new RegExp(baseClass, 'i') },
      ];
    }
    if (section && section !== 'All' && section !== 'all') {
      studentQuery.section = new RegExp(`^${section.replace(/section\s*/i, '').trim()}$|^${section}$`, 'i');
    }

    const [allDbStudents, existingDbResults] = await Promise.all([
      Student.find(studentQuery).select('name firstName lastName email admissionNumber rollNumber class className section'),
      Result.find({ examId: resolvedExamId }),
    ]);

    const studentMap = new Map();
    allDbStudents.forEach((s) => {
      studentMap.set(String(s._id), {
        id: s._id,
        name: s.name || `${s.firstName || ''} ${s.lastName || ''}`.trim(),
        email: s.email,
        admissionNumber: s.admissionNumber,
        rollNumber: s.rollNumber,
        className: s.className || s.class || baseClass,
        section: s.section || 'A',
      });
    });

    existingDbResults.forEach((r) => {
      const sid = String(r.studentId);
      if (!studentMap.has(sid)) {
        studentMap.set(sid, {
          id: r.studentId,
          name: r.studentName,
          email: r.studentEmail,
          admissionNumber: r.admissionNumber,
          rollNumber: r.rollNumber,
          className: r.className || baseClass,
          section: r.section || 'A',
        });
      }
    });

    studentList = Array.from(studentMap.values());

    if (!studentList.length) {
      return {
        success: false,
        error: `No students found for exam "${exam.name}" in class "${targetClassStr}".`,
      };
    }

    const bulkOps = [];
    const sampleResults = [];

    studentList.forEach((st, idx) => {
      let totalObt = 0;
      let totalMx = 0;
      const enrichedMarks = subjects.map((sub) => {
        const p = sub.passMarks || 33;
        const mx = sub.maxMarks || 100;
        const lower = passAll ? Math.max(p + 3, minMarks || p + 8) : (minMarks || 25);
        const upper = Math.min(mx, maxMarks || 95);
        const obt = Math.floor(Math.random() * (upper - lower + 1)) + lower;
        totalObt += obt;
        totalMx += mx;
        return {
          subjectName: sub.subjectName,
          subjectCode: sub.subjectCode || '',
          bookName: sub.bookName || '',
          obtained: obt,
          maxMarks: mx,
          passMarks: p,
          isPassed: obt >= p,
          grade: calculateGrade((obt / mx) * 100),
        };
      });

      const pct = parseFloat(((totalObt / totalMx) * 100).toFixed(1));
      const gr = calculateGrade(pct);
      const gpa = parseFloat((pct / 9.5).toFixed(1));

      const resultPayload = {
        examId: resolvedExamId,
        examName: exam.name,
        examTerm: exam.term,
        examSession: exam.session || '2026-2027',
        studentId: st.id,
        studentName: st.name,
        studentEmail: st.email || '',
        admissionNumber: st.admissionNumber || '',
        rollNumber: st.rollNumber ?? null,
        classId: st.className,
        className: st.className,
        section: st.section,
        marks: enrichedMarks,
        totalObtained: totalObt,
        totalMarks: totalObt,
        totalMaxMarks: totalMx,
        percentage: pct,
        grade: gr,
        gpa,
        isPassed: true,
        failedSubjects: [],
        remarks: `Scored ${pct}% with grade ${gr}`,
        status: status || 'draft',
      };

      if (idx < 5) {
        sampleResults.push({
          studentName: st.name,
          section: st.section,
          total: `${totalObt}/${totalMx}`,
          percentage: `${pct}%`,
          grade: gr,
        });
      }

      bulkOps.push({
        updateOne: {
          filter: { examId: resolvedExamId, studentId: st.id },
          update: { $set: resultPayload },
          upsert: true,
        },
      });
    });

    if (bulkOps.length > 0) {
      await Result.bulkWrite(bulkOps);
    }

    try {
      const allRes = await Result.find({ examId: resolvedExamId }).sort({ percentage: -1 });
      const rankOps = allRes.map((r, i) => ({
        updateOne: {
          filter: { _id: r._id },
          update: { $set: { rank: i + 1 } },
        },
      }));
      if (rankOps.length > 0) {
        await Result.bulkWrite(rankOps);
      }
    } catch (_) {}

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'UPDATE',
      module: 'results',
      recordId: resolvedExamId,
      details: `AI bulk assigned random passing marks to ${studentList.length} students in exam ${exam.name}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Successfully assigned random passing marks to all ${studentList.length} students across sections in exam "${exam.name}". All results saved in ${status} status.`,
      examName: exam.name,
      totalStudents: studentList.length,
      status,
      sampleResults,
    };
  },
};

function calculateGrade(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 35) return 'D';
  return 'F';
}

function formatResult(r) {
  return {
    id: r._id || r.id,
    studentName: r.studentName,
    rollNumber: r.rollNumber ?? '—',
    admissionNumber: r.admissionNumber,
    section: r.section || 'A',
    totalMarks: `${r.totalMarks || 0} / ${r.totalMaxMarks || 100}`,
    percentage: `${r.percentage || 0}%`,
    grade: r.grade || '—',
    gpa: r.gpa || '—',
    isPassed: r.isPassed !== false,
    rank: r.rank || '—',
    status: r.status || 'draft',
  };
}
