import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import { checkFallback } from "../config/db.js";
import { FallbackDb } from "../services/dbFallback.js";
import {
  parsePagination,
  paginateResult,
  paginateArray,
} from "../utils/paginateQuery.js";
import { logActivity } from "../utils/activityLogger.js";

export const getAttendanceRecords = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { classId, date, type } = req.query;

    if (checkFallback()) {
      let list = FallbackDb.find("attendance") || [];
      if (classId) list = list.filter((a) => a.classId === classId);
      if (date)
        list = list.filter(
          (a) =>
            new Date(a.date).toDateString() === new Date(date).toDateString()
        );
      if (type) list = list.filter((a) => a.type === type);
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return res.json({
        success: true,
        records: data,
        ...paginateResult(data, total, { page, limit }),
      });
    }

    const filter = {};
    if (classId && mongoose.Types.ObjectId.isValid(classId)) {
      filter.classId = classId;
    }
    if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        filter.date = {
          $gte: new Date(d.setHours(0, 0, 0, 0)),
          $lt: new Date(d.setHours(23, 59, 59, 999)),
        };
      }
    }
    if (type) filter.type = type;

    const [records, total] = await Promise.all([
      Attendance.find(filter)
        .populate("classId", "name code")
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit),
      Attendance.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      records,
      ...paginateResult(records, total, { page, limit }),
    });
  } catch (error) {
    console.error("getAttendanceRecords error:", error);
    return res.json({
      success: true,
      records: [],
      page: 1,
      limit: 20,
      total: 0,
      pages: 1,
    });
  }
};

export const getAttendanceById = async (req, res) => {
  try {
    const { id } = req.params;
    let record = null;
    if (checkFallback()) {
      record = FallbackDb.findById("attendance", id);
    } else {
      if (mongoose.Types.ObjectId.isValid(id)) {
        record = await Attendance.findById(id).populate("classId", "name code");
      }
      if (!record) {
        record = FallbackDb.findById("attendance", id);
      }
    }

    if (!record)
      return res
        .status(404)
        .json({ success: false, message: "Attendance record not found" });
    return res.json({ success: true, record });
  } catch (error) {
    console.error("getAttendanceById error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createAttendance = async (req, res) => {
  try {
    const {
      date,
      classId,
      sectionId,
      className,
      sectionName,
      classSection,
      takenBy,
      students,
      records,
      attendance,
      type,
    } = req.body;
    const rawList = students || attendance || records || [];
    if (!date || !rawList.length) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Date and students attendance list are required",
        });
    }

    const formattedStudents = rawList.map((item) => ({
      studentId: item.studentId || item.id || item._id,
      name: item.name || "",
      rollNo: item.rollNo ?? item.roll ?? "",
      status: (item.status || "present").toLowerCase(),
      remarks: item.remarks || "",
    }));

    const presentCount = formattedStudents.filter(
      (s) => s.status === "present"
    ).length;
    const absentCount = formattedStudents.filter(
      (s) => s.status === "absent"
    ).length;
    const lateCount = formattedStudents.filter(
      (s) => s.status === "late"
    ).length;
    const totalCount = formattedStudents.length;

    const takenByObj =
      typeof takenBy === "object" && takenBy !== null
        ? {
            userId: takenBy.userId || req.user?._id || req.user?.id || "USER_ID",
            name: takenBy.name || req.user?.name || "shadab md",
          }
        : {
            userId: req.user?._id || req.user?.id || "USER_ID",
            name: takenBy || req.user?.name || "shadab md",
          };

    const createData = {
      date: new Date(date),
      type: type || "student",
      classId: classId || undefined,
      sectionId: sectionId || undefined,
      className,
      sectionName,
      classSection:
        classSection ||
        (className && sectionName ? `${className} - ${sectionName}` : undefined),
      takenBy: takenByObj,
      total: totalCount,
      present: presentCount,
      absent: absentCount,
      late: lateCount,
      students: formattedStudents,
      records: formattedStudents.map((s) => ({
        ...s,
        memberId: s.studentId,
        memberModel: "Student",
      })),
      attendance: formattedStudents,
    };

    let record;
    if (checkFallback()) {
      record = FallbackDb.create("attendance", createData);
    } else {
      record = await Attendance.create(createData);
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "CREATE",
      module: "attendance",
      recordId: record.id || record._id,
      details: `Marked attendance for ${formattedStudents.length} students`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res
      .status(201)
      .json({ success: true, message: "Attendance recorded", record });
  } catch (error) {
    console.error("createAttendance error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Server error" });
  }
};

export const getAttendanceStats = async (req, res) => {
  try {
    const { classId, month, year } = req.query;
    const targetMonth = parseInt(month, 10) || new Date().getMonth() + 1;
    const targetYear = parseInt(year, 10) || new Date().getFullYear();

    let records = checkFallback()
      ? FallbackDb.find("attendance") || []
      : await Attendance.find(classId ? { classId } : {});

    records = records.filter((r) => {
      const d = new Date(r.date);
      return d.getMonth() + 1 === targetMonth && d.getFullYear() === targetYear;
    });

    let present = 0;
    let absent = 0;
    let late = 0;
    records.forEach((r) => {
      (r.records || []).forEach((rec) => {
        if (rec.status === "present") present++;
        else if (rec.status === "absent") absent++;
        else if (rec.status === "late") late++;
      });
    });

    const total = present + absent + late;
    const percentage = total ? Math.round((present / total) * 100) : 0;

    return res.json({
      success: true,
      stats: {
        present,
        absent,
        late,
        total,
        percentage,
        recordsCount: records.length,
      },
    });
  } catch (error) {
    console.error("getAttendanceStats error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getStudentAttendance = async (req, res) => {
  try {
    const studentId = req.params.studentId || req.query.studentId;
    if (!studentId) {
      return res
        .status(400)
        .json({ success: false, message: "Student ID is required" });
    }

    let logs = [];
    if (checkFallback()) {
      const allRecords = FallbackDb.find("attendance") || [];
      allRecords.forEach((att) => {
        const item = (att.students || att.attendance || att.records || []).find(
          (r) =>
            String(r.studentId) === String(studentId) ||
            String(r.memberId) === String(studentId) ||
            String(r.id) === String(studentId)
        );
        if (item) {
          logs.push({
            id: att._id || att.id,
            date: att.date ? new Date(att.date).toISOString().split("T")[0] : "—",
            status: item.status
              ? item.status.charAt(0).toUpperCase() + item.status.slice(1)
              : "Present",
            remarks: item.remarks || "—",
          });
        }
      });
    } else {
      const filter = {
        $or: [
          { "students.studentId": studentId },
          { "records.memberId": mongoose.Types.ObjectId.isValid(studentId) ? studentId : null },
          { "records.studentId": studentId },
          { "attendance.studentId": studentId },
        ],
      };
      const attList = await Attendance.find(filter).sort({ date: -1 });
      attList.forEach((att) => {
        const item = (att.students || att.attendance || att.records || []).find(
          (r) =>
            String(r.studentId) === String(studentId) ||
            String(r.memberId) === String(studentId) ||
            String(r.id) === String(studentId)
        );
        if (item) {
          logs.push({
            id: att._id || att.id,
            date: att.date ? new Date(att.date).toISOString().split("T")[0] : "—",
            status: item.status
              ? item.status.charAt(0).toUpperCase() + item.status.slice(1)
              : "Present",
            remarks: item.remarks || "—",
          });
        }
      });
    }

    const presentCount = logs.filter(
      (l) => l.status.toLowerCase() === "present"
    ).length;
    const absentCount = logs.filter(
      (l) => l.status.toLowerCase() === "absent"
    ).length;
    const lateCount = logs.filter(
      (l) => l.status.toLowerCase() === "late"
    ).length;
    const totalDays = logs.length;
    const percentage = totalDays
      ? Math.round((presentCount / totalDays) * 100)
      : 100;

    return res.json({
      success: true,
      studentId,
      summary: {
        totalDays,
        presentCount,
        absentCount,
        lateCount,
        percentage: `${percentage}%`,
      },
      logs,
    });
  } catch (error) {
    console.error("getStudentAttendance error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getMyAttendance = async (req, res) => {
  try {
    const role = req.user?.role || "student";
    const userId = req.user?._id?.toString() || req.user?.id?.toString() || req.user?.studentId;
    const userName = req.user?.name || req.user?.username;

    let logs = [];
    let rawRecords = [];

    if (checkFallback()) {
      rawRecords = FallbackDb.find("attendance") || [];
    } else {
      rawRecords = await Attendance.find({}).sort({ date: -1 });
    }

    rawRecords.forEach((att) => {
      const studentList = att.students || att.attendance || att.records || [];
      const item = studentList.find(
        (r) =>
          (userId && (
            String(r.studentId) === String(userId) ||
            String(r.memberId) === String(userId) ||
            String(r.id) === String(userId) ||
            String(r._id) === String(userId)
          )) ||
          (userName && r.name && r.name.toLowerCase() === userName.toLowerCase())
      );

      if (item) {
        const d = att.date ? new Date(att.date) : new Date();
        const dateStr = d.toISOString().split("T")[0];
        const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
        const rawStatus = item.status || "present";
        const statusFormatted = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();

        logs.push({
          id: att._id || att.id || `att-${logs.length + 1}`,
          date: dateStr,
          dayName,
          status: statusFormatted,
          checkIn: item.checkIn || (statusFormatted === "Present" ? "07:45 AM" : statusFormatted === "Late" ? "08:20 AM" : "—"),
          checkOut: item.checkOut || (statusFormatted === "Present" || statusFormatted === "Late" ? "03:30 PM" : "—"),
          remarks: item.remarks || (statusFormatted === "Present" ? "Full Day" : statusFormatted === "Absent" ? "Absent" : "On Time"),
          className: att.className || att.classSection || "Class 10-A",
          markedBy: att.takenBy?.name || "Administration",
        });
      }
    });

    // Sort logs by date descending
    logs.sort((a, b) => new Date(b.date) - new Date(a.date));

    const presentCount = logs.filter((l) => l.status.toLowerCase() === "present").length;
    const absentCount = logs.filter((l) => l.status.toLowerCase() === "absent").length;
    const halfDayCount = logs.filter((l) => l.status.toLowerCase() === "half day").length;
    const lateCount = logs.filter((l) => l.status.toLowerCase() === "late").length;
    const totalDays = logs.length;
    const effectiveDays = presentCount + halfDayCount * 0.5;
    const percentage = totalDays
      ? `${((effectiveDays / totalDays) * 100).toFixed(1)}%`
      : "N/A";

    return res.json({
      success: true,
      userRole: role,
      summary: {
        totalDays,
        presentCount,
        absentCount,
        halfDayCount,
        lateCount,
        percentage,
      },
      logs,
    });
  } catch (error) {
    console.error("getMyAttendance error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
