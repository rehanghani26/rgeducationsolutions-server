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
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        filter.$or = [
          { date: { $gte: start, $lte: end } },
          { attendanceDate: { $gte: start, $lte: end } },
        ];
      }
    }
    if (type) filter.type = type;

    const [records, total] = await Promise.all([
      Attendance.find(filter)
        .populate("classId", "name code")
        .sort({ date: -1, attendanceTakenDate: -1, createdAt: -1 })
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
      attendanceDate,
      attendanceTakenDate,
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
    if (!rawList.length) {
      return res.status(400).json({
        success: false,
        message: "Students attendance list is required",
      });
    }

    const inputDate = date || attendanceDate || new Date();
    const attDateObj = new Date(inputDate);
    if (isNaN(attDateObj.getTime())) {
      return res.status(400).json({
        success: false,
        message: "A valid attendance date is required",
      });
    }

    // Normalized start/end of the chosen attendance date (supports past, present)
    const startOfDay = new Date(attDateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(attDateObj);
    endOfDay.setHours(23, 59, 59, 999);

    // Exact timestamp when the teacher/admin is recording/submitting this attendance
    const takenAt = attendanceTakenDate
      ? new Date(attendanceTakenDate)
      : new Date();

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

    const attendancePayload = {
      date: startOfDay,
      attendanceDate: startOfDay,
      attendanceTakenDate: takenAt,
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
      // Check fallback DB for existing record on that date & class
      const existing = (FallbackDb.find("attendance") || []).find((a) => {
        const d = new Date(a.date || a.attendanceDate);
        return (
          d >= startOfDay &&
          d <= endOfDay &&
          (a.classId === classId || a.className === className) &&
          (!sectionName || a.sectionName === sectionName || a.sectionId === sectionId)
        );
      });
      if (existing) {
        record = FallbackDb.update("attendance", existing.id || existing._id, attendancePayload);
      } else {
        record = FallbackDb.create("attendance", attendancePayload);
      }
    } else {
      // Find if an attendance record already exists for this date, type, class & section
      const matchCriteria = {
        $or: [
          { date: { $gte: startOfDay, $lte: endOfDay } },
          { attendanceDate: { $gte: startOfDay, $lte: endOfDay } },
        ],
        type: type || "student",
      };

      if (classId) {
        matchCriteria.classId = classId;
      } else if (className) {
        matchCriteria.className = className;
      }

      if (sectionId) {
        matchCriteria.sectionId = sectionId;
      } else if (sectionName) {
        matchCriteria.sectionName = sectionName;
      }

      const existingRecord = await Attendance.findOne(matchCriteria);

      if (existingRecord) {
        // Update existing attendance record instead of throwing E11000 duplicate key error
        existingRecord.date = startOfDay;
        existingRecord.attendanceDate = startOfDay;
        existingRecord.attendanceTakenDate = takenAt;
        existingRecord.total = totalCount;
        existingRecord.present = presentCount;
        existingRecord.absent = absentCount;
        existingRecord.late = lateCount;
        existingRecord.students = formattedStudents;
        existingRecord.records = formattedStudents.map((s) => ({
          ...s,
          memberId: s.studentId,
          memberModel: "Student",
        }));
        existingRecord.attendance = formattedStudents;
        existingRecord.takenBy = takenByObj;
        if (className) existingRecord.className = className;
        if (sectionName) existingRecord.sectionName = sectionName;
        if (classSection) existingRecord.classSection = classSection;

        record = await existingRecord.save();
      } else {
        record = await Attendance.create(attendancePayload);
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "CREATE",
      module: "attendance",
      recordId: record.id || record._id,
      details: `Recorded attendance for ${formattedStudents.length} students (Session Date: ${startOfDay.toISOString().split("T")[0]}, Taken On: ${takenAt.toISOString()})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res
      .status(201)
      .json({ success: true, message: "Attendance recorded successfully", record });
  } catch (error) {
    console.error("createAttendance error:", error);

    // Gracefully handle MongoDB E11000 duplicate key error by upserting
    if (error.code === 11000) {
      try {
        const inputDate = req.body.date || req.body.attendanceDate || new Date();
        const startOfDay = new Date(inputDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(inputDate);
        endOfDay.setHours(23, 59, 59, 999);

        const updateData = {
          date: startOfDay,
          attendanceDate: startOfDay,
          attendanceTakenDate: req.body.attendanceTakenDate ? new Date(req.body.attendanceTakenDate) : new Date(),
          takenBy: req.body.takenBy,
          students: req.body.students,
          records: req.body.records || req.body.students,
          attendance: req.body.attendance || req.body.students,
          total: req.body.total,
          present: req.body.present,
          absent: req.body.absent,
          late: req.body.late,
        };

        const updated = await Attendance.findOneAndUpdate(
          {
            $or: [
              { date: { $gte: startOfDay, $lte: endOfDay } },
              { attendanceDate: { $gte: startOfDay, $lte: endOfDay } },
            ],
            classId: req.body.classId || undefined,
          },
          { $set: updateData },
          { new: true }
        );

        if (updated) {
          return res.status(200).json({
            success: true,
            message: "Attendance updated successfully",
            record: updated,
          });
        }
      } catch (upsertErr) {
        console.error("Upsert fallback error:", upsertErr);
      }
    }

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

    const { date, startDate, endDate, year, month, status } = req.query;

    // Build Date Filter Condition
    let dateFilter = null;

    if (date) {
      // Specific single date
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        dateFilter = { start, end };
      }
    } else if (startDate || endDate) {
      // Date range
      const start = startDate ? new Date(startDate) : new Date(0);
      start.setHours(0, 0, 0, 0);
      const end = endDate ? new Date(endDate) : new Date();
      end.setHours(23, 59, 59, 999);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        dateFilter = { start, end };
      }
    } else if (year || month) {
      // Year & Month filter
      const targetYear = parseInt(year, 10) || new Date().getFullYear();
      if (month) {
        const targetMonth = parseInt(month, 10);
        const start = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
        const end = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
        dateFilter = { start, end };
      } else {
        const start = new Date(targetYear, 0, 1, 0, 0, 0, 0);
        const end = new Date(targetYear, 11, 31, 23, 59, 59, 999);
        dateFilter = { start, end };
      }
    }

    let logs = [];
    if (checkFallback()) {
      const allRecords = FallbackDb.find("attendance") || [];
      allRecords.forEach((att) => {
        const d = new Date(att.attendanceDate || att.date);
        if (dateFilter && (d < dateFilter.start || d > dateFilter.end)) {
          return;
        }

        const studentList = att.students || att.attendance || att.records || [];
        const item = studentList.find(
          (r) =>
            String(r.studentId) === String(studentId) ||
            String(r.memberId) === String(studentId) ||
            String(r.id) === String(studentId) ||
            String(r._id) === String(studentId) ||
            (r.rollNo && String(r.rollNo) === String(studentId))
        );

        if (item) {
          const rawStatus = (item.status || "present").toLowerCase();
          if (status && status !== "all" && rawStatus !== status.toLowerCase()) {
            return;
          }

          const formattedStatus =
            rawStatus === "present"
              ? "Present"
              : rawStatus === "absent"
                ? "Absent"
                : rawStatus === "late"
                  ? "Late"
                  : rawStatus === "half day" || rawStatus === "halfday"
                    ? "Half Day"
                    : rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);

          const attDateStr = d.toISOString().split("T")[0];
          const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
          const takenDate = att.attendanceTakenDate || att.createdAt || att.date;

          logs.push({
            id: att._id || att.id,
            date: attDateStr,
            dayName,
            attendanceDate: att.attendanceDate || att.date,
            attendanceTakenDate: takenDate,
            isPastDate:
              new Date(att.attendanceDate || att.date).toDateString() !==
              new Date(takenDate).toDateString(),
            status: formattedStatus,
            remarks: item.remarks || "—",
            className: att.className || "—",
            sectionName: att.sectionName || "—",
            classSection: att.classSection || (att.className ? `${att.className} - ${att.sectionName || "A"}` : "—"),
            markedBy: att.takenBy?.name || "Administration",
          });
        }
      });
    } else {
      const queryFilter = {
        $or: [
          { "students.studentId": studentId },
          { "records.memberId": mongoose.Types.ObjectId.isValid(studentId) ? studentId : null },
          { "records.studentId": studentId },
          { "attendance.studentId": studentId },
          { "students._id": mongoose.Types.ObjectId.isValid(studentId) ? studentId : null },
        ],
      };

      if (dateFilter) {
        queryFilter.$and = [
          {
            $or: [
              { date: { $gte: dateFilter.start, $lte: dateFilter.end } },
              { attendanceDate: { $gte: dateFilter.start, $lte: dateFilter.end } },
            ],
          },
        ];
      }

      const attList = await Attendance.find(queryFilter).sort({ date: -1, attendanceTakenDate: -1 });

      attList.forEach((att) => {
        const studentList = att.students || att.attendance || att.records || [];
        const item = studentList.find(
          (r) =>
            String(r.studentId) === String(studentId) ||
            String(r.memberId) === String(studentId) ||
            String(r.id) === String(studentId) ||
            String(r._id) === String(studentId) ||
            (r.rollNo && String(r.rollNo) === String(studentId))
        );

        if (item) {
          const rawStatus = (item.status || "present").toLowerCase();
          if (status && status !== "all" && rawStatus !== status.toLowerCase()) {
            return;
          }

          const formattedStatus =
            rawStatus === "present"
              ? "Present"
              : rawStatus === "absent"
                ? "Absent"
                : rawStatus === "late"
                  ? "Late"
                  : rawStatus === "half day" || rawStatus === "halfday"
                    ? "Half Day"
                    : rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);

          const d = new Date(att.attendanceDate || att.date);
          const attDateStr = d.toISOString().split("T")[0];
          const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
          const takenDate = att.attendanceTakenDate || att.createdAt || att.date;

          logs.push({
            id: att._id || att.id,
            date: attDateStr,
            dayName,
            attendanceDate: att.attendanceDate || att.date,
            attendanceTakenDate: takenDate,
            isPastDate:
              new Date(att.attendanceDate || att.date).toDateString() !==
              new Date(takenDate).toDateString(),
            status: formattedStatus,
            remarks: item.remarks || "—",
            className: att.className || "—",
            sectionName: att.sectionName || "—",
            classSection: att.classSection || (att.className ? `${att.className} - ${att.sectionName || "A"}` : "—"),
            markedBy: att.takenBy?.name || "Administration",
          });
        }
      });
    }

    // Sort logs descending by session date
    logs.sort((a, b) => new Date(b.date) - new Date(a.date));

    const presentCount = logs.filter(
      (l) => l.status.toLowerCase() === "present"
    ).length;
    const absentCount = logs.filter(
      (l) => l.status.toLowerCase() === "absent"
    ).length;
    const lateCount = logs.filter(
      (l) => l.status.toLowerCase() === "late"
    ).length;
    const halfDayCount = logs.filter(
      (l) => l.status.toLowerCase() === "half day"
    ).length;

    const totalDays = logs.length;
    const effectivePresent = presentCount + halfDayCount * 0.5;
    const percentage = totalDays
      ? `${Math.round((effectivePresent / totalDays) * 100)}%`
      : "0%";

    return res.json({
      success: true,
      studentId,
      filter: {
        date: date || null,
        startDate: startDate || null,
        endDate: endDate || null,
        year: year || null,
        month: month || null,
        status: status || "all",
      },
      summary: {
        totalDays,
        presentCount,
        absentCount,
        lateCount,
        halfDayCount,
        percentage,
      },
      logs,
    });
  } catch (error) {
    console.error("getStudentAttendance error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
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
      rawRecords = await Attendance.find({}).sort({ date: -1, attendanceTakenDate: -1 });
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
          attendanceDate: att.attendanceDate || att.date,
          attendanceTakenDate: att.attendanceTakenDate || att.createdAt,
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
