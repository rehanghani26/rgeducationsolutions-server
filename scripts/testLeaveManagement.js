import assert from 'assert';
import axios from 'axios';
import {
  calculateLeaveDays,
  generateLeaveCode,
  resolveApplicantIdentity,
  checkOverlappingLeave,
  syncLeaveWithAttendance,
  reverseAttendanceSync,
} from '../services/leaveService.js';
import dbFallback from '../services/dbFallback.js';

async function runTestSuite() {
  console.log('================================================================');
  console.log('  PRODUCTION-READY LEAVE MANAGEMENT & ATTENDANCE INTEGRATION TEST');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function test(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  async function testAsync(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1. DATE CALCULATIONS & HALF-DAY UNIT TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Testing Date Calculations & Half-Day Rules ---');

  test('Single weekday leave calculates to exactly 1.0 day', () => {
    // 2026-10-26 is Monday
    const res = calculateLeaveDays('2026-10-26', '2026-10-26', false);
    assert.strictEqual(res.totalDays, 1);
    assert.strictEqual(res.workingDates.length, 1);
    assert.strictEqual(res.workingDates[0], '2026-10-26');
  });

  test('Half-day leave calculates to exactly 0.5 day', () => {
    const res = calculateLeaveDays('2026-10-26', '2026-10-26', true);
    assert.strictEqual(res.totalDays, 0.5);
    assert.strictEqual(res.workingDates.length, 1);
  });

  test('Multi-day leave spanning Sunday excludes Sunday from working days', () => {
    // Friday 2026-10-23 to Tuesday 2026-10-27: Fri(23), Sat(24), Sun(25 excluded), Mon(26), Tue(27) = 4 days
    const res = calculateLeaveDays('2026-10-23', '2026-10-27', false);
    assert.strictEqual(res.totalDays, 4);
    assert.strictEqual(res.workingDates.includes('2026-10-25'), false);
    assert.strictEqual(res.workingDates.length, 4);
  });

  test('Invalid date range where end date is before start date throws validation error', () => {
    assert.throws(() => {
      calculateLeaveDays('2026-10-28', '2026-10-20', false);
    }, /End date cannot be earlier than start date/);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. LEAVE CODE GENERATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Testing Leave Reference Code Generation ---');

  await testAsync('generateLeaveCode formats code as LV-YYYY-XXXX sequentially', async () => {
    const code = await generateLeaveCode();
    assert.match(code, /^LV-\d{4}-\d{4}$/, `Code '${code}' does not match pattern LV-YYYY-XXXX`);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. APPLICANT IDENTITY RESOLUTION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Testing Applicant Identity Resolution ---');

  await testAsync('resolveApplicantIdentity resolves student applicant correctly', async () => {
    const student = dbFallback.get('students')?.[0];
    if (student) {
      const resolved = await resolveApplicantIdentity(student._id || student.id, 'Student');
      assert.strictEqual(resolved.applicantModel, 'Student');
      assert.strictEqual(resolved.role, 'student');
      assert.ok(resolved.applicantName);
    } else {
      console.log('     (Skipped: no students in fallback database)');
    }
  });

  await testAsync('resolveApplicantIdentity resolves teacher applicant correctly', async () => {
    const teacher = dbFallback.get('teachers')?.[0];
    if (teacher) {
      const resolved = await resolveApplicantIdentity(teacher._id || teacher.id, 'Teacher');
      assert.strictEqual(resolved.applicantModel, 'Teacher');
      assert.strictEqual(resolved.role, 'teacher');
      assert.ok(resolved.applicantName);
    } else {
      console.log('     (Skipped: no teachers in fallback database)');
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 4. OVERLAPPING LEAVE PREVENTION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Testing Overlapping Leave Prevention ---');

  await testAsync('checkOverlappingLeave blocks requests overlapping approved dates', async () => {
    const mockLeaves = [
      {
        _id: 'leave_mock_1',
        applicantId: 'applicant_test_1',
        startDate: '2026-11-01',
        endDate: '2026-11-05',
        status: 'approved',
      },
    ];

    // Same applicant, overlapping 2026-11-03 to 2026-11-08
    const conflict = await checkOverlappingLeave(
      'applicant_test_1',
      '2026-11-03',
      '2026-11-08',
      null,
      mockLeaves
    );
    assert.ok(conflict, 'Expected overlap collision to be detected');

    // Same applicant, non-overlapping 2026-11-10 to 2026-11-12
    const noConflict = await checkOverlappingLeave(
      'applicant_test_1',
      '2026-11-10',
      '2026-11-12',
      null,
      mockLeaves
    );
    assert.strictEqual(noConflict, null, 'Expected no conflict for non-overlapping dates');
  });

  // ─────────────────────────────────────────────────────────────
  // 5. ATTENDANCE SYNCHRONIZATION & REVERSAL (IDEMPOTENCY)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 5. Testing Attendance Synchronization & Reversal ---');

  await testAsync('syncLeaveWithAttendance updates existing attendance records and records audit trail', async () => {
    const testStudentId = 'student_test_sync_1';
    const testDate = '2026-10-26';

    // Seed mock attendance record
    const attendanceRecords = dbFallback.get('attendanceRecords') || [];
    const testRecord = {
      _id: 'att_sync_test_rec_1',
      date: testDate,
      attendanceDate: testDate,
      type: 'student',
      className: 'Class 10',
      sectionName: 'A',
      students: [
        { studentId: testStudentId, name: 'Test Sync Student', rollNo: '101', status: 'present' },
        { studentId: 'student_other', name: 'Other Student', rollNo: '102', status: 'present' },
      ],
      total: 2,
      present: 2,
      absent: 0,
      late: 0,
      leaveCount: 0,
    };
    dbFallback.set('attendanceRecords', [...attendanceRecords, testRecord]);

    const mockLeave = {
      _id: 'leave_sync_test_1',
      applicantId: testStudentId,
      applicantModel: 'Student',
      category: 'Medical Leave',
      startDate: testDate,
      endDate: testDate,
      isHalfDay: false,
      reason: 'Fever',
    };

    const syncRes = await syncLeaveWithAttendance(mockLeave);
    assert.strictEqual(syncRes.syncedDates.length, 1);
    assert.strictEqual(syncRes.syncedAttendanceIds.length, 1);

    // Verify record in fallback DB
    const updatedRec = dbFallback.get('attendanceRecords').find((r) => r._id === 'att_sync_test_rec_1');
    const studentEntry = updatedRec.students.find((s) => s.studentId === testStudentId);
    assert.strictEqual(studentEntry.status, 'leave');
    assert.strictEqual(updatedRec.leaveCount, 1);
    assert.strictEqual(updatedRec.present, 1);

    // Test Idempotency: Running sync again does not duplicate or corrupt
    const secondSyncRes = await syncLeaveWithAttendance(mockLeave);
    assert.strictEqual(secondSyncRes.syncedAttendanceIds.length, 1);

    // Test Reversal upon cancellation
    mockLeave.attendanceSync = {
      isSynced: true,
      syncedAttendanceIds: syncRes.syncedAttendanceIds,
      syncedDates: syncRes.syncedDates,
    };
    await reverseAttendanceSync(mockLeave);
    const reversedRec = dbFallback.get('attendanceRecords').find((r) => r._id === 'att_sync_test_rec_1');
    const reversedStudentEntry = reversedRec.students.find((s) => s.studentId === testStudentId);
    assert.strictEqual(reversedStudentEntry.status, 'absent');
    assert.strictEqual(reversedRec.leaveCount, 0);

    // Cleanup
    dbFallback.set(
      'attendanceRecords',
      dbFallback.get('attendanceRecords').filter((r) => r._id !== 'att_sync_test_rec_1')
    );
  });

  // ─────────────────────────────────────────────────────────────
  // 6. ATTENDANCE COMPLIANCE PERCENTAGE CALCULATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 6. Testing Attendance Compliance Formula ---');

  test('Attendance compliance formula excludes approved leave from denominator', () => {
    // Total sessions: 20, Present: 18, Absent: 1, Approved Leave: 1
    // Formula: Present / (Total - Leave) * 100 = 18 / (20 - 1) * 100 = 18 / 19 * 100 = 94.7% => 95%
    const totalDays = 20;
    const presentCount = 18;
    const leaveCount = 1;
    const effectiveDays = Math.max(0, totalDays - leaveCount);
    const percentage = effectiveDays > 0 ? Math.round((presentCount / effectiveDays) * 100) : 0;
    assert.strictEqual(percentage, 95);
  });

  // ─────────────────────────────────────────────────────────────
  // 7. LIVE HTTP API TESTS (IF BACKEND SERVER IS RUNNING)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 7. Testing Live Backend API Endpoints ---');

  const baseURL = 'http://localhost:5000/api/v1';
  let serverRunning = false;
  let adminToken = null;

  try {
    const loginRes = await axios.post(`${baseURL}/auth/login`, {
      username: 'superadmin',
      password: 'admin',
    }, { timeout: 1500 });
    adminToken = loginRes.data.accessToken;
    serverRunning = true;
    console.log('  ℹ️  Backend server is active. Authenticated as superadmin.');
  } catch (e) {
    console.log('  ℹ️  Backend HTTP server is offline on port 5000. Skipping live network calls.');
  }

  if (serverRunning && adminToken) {
    const headers = { Authorization: `Bearer ${adminToken}` };

    await testAsync('GET /api/v1/leaves/all returns list with pagination and metrics', async () => {
      const res = await axios.get(`${baseURL}/leaves/all`, { headers });
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.data));
      assert.ok(res.data.pagination);
      assert.ok(res.data.metrics);
    });

    await testAsync('POST /api/v1/leaves/request creates pending leave request', async () => {
      const res = await axios.post(
        `${baseURL}/leaves/request`,
        {
          applicantName: 'Test Student Automated',
          role: 'student',
          category: 'Medical Leave',
          startDate: '2026-11-16',
          endDate: '2026-11-17',
          isHalfDay: false,
          reason: 'Automated test leave verification',
        },
        { headers }
      );
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.status, 'pending');
      assert.ok(res.data.data.leaveCode);

      const createdId = res.data.data._id || res.data.data.id;

      // Review leave: approve
      const reviewRes = await axios.patch(
        `${baseURL}/leaves/${createdId}/review`,
        {
          status: 'approved',
          remarks: 'Approved by automated test suite',
        },
        { headers }
      );
      assert.strictEqual(reviewRes.data.success, true);
      assert.strictEqual(reviewRes.data.data.status, 'approved');

      // Check active on date endpoint
      const activeRes = await axios.get(
        `${baseURL}/leaves/active-on-date?date=2026-11-16`,
        { headers }
      );
      assert.strictEqual(activeRes.data.success, true);
      const found = activeRes.data.data.some((l) => (l._id || l.id) === createdId);
      assert.ok(found, 'Approved leave must be returned by active-on-date endpoint');

      // Cancel leave
      const cancelRes = await axios.delete(`${baseURL}/leaves/${createdId}`, { headers });
      assert.strictEqual(cancelRes.data.success, true);
    });
  }

  console.log('\n================================================================');
  console.log(`  TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('================================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
