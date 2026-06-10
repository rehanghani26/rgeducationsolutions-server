/**
 * seedStudents.js
 * ───────────────
 * Inserts 25 dummy student records via the REST API.
 * Password for every student account: 123456
 *
 * Usage (from /server directory):
 *   node scripts/seedStudents.js
 *
 * Make sure the server is running on port 5000 first.
 */

const BASE_URL = 'http://localhost:5000/api/v1';

// ─── Admin credentials ───────────────────────────────────────────────────────
const ADMIN_USERNAME = 'superadmin';
const ADMIN_PASSWORD = 'admin';

// ─── Dummy data pools ────────────────────────────────────────────────────────
const firstNames = [
  'Aarav',    'Aisha',    'Rohan',   'Priya',  'Arjun',
  'Sneha',    'Vikram',   'Meera',   'Kabir',  'Ananya',
  'Dev',      'Zara',     'Ravi',    'Nisha',  'Karan',
  'Pooja',    'Amit',     'Divya',   'Siddharth','Kavya',
  'Rahul',    'Simran',   'Nikhil',  'Ritika', 'Harsh',
];

const lastNames = [
  'Sharma',   'Verma',    'Patel',   'Singh',  'Kumar',
  'Gupta',    'Mehta',    'Shah',    'Yadav',  'Joshi',
  'Nair',     'Reddy',    'Iyer',    'Bose',   'Das',
  'Malhotra', 'Saxena',   'Chopra',  'Khanna', 'Bajaj',
  'Tiwari',   'Sinha',    'Pandey',  'Rastogi','Agarwal',
];

const classes = ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'];
const genders  = ['Male', 'Female'];
const bloods   = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-'];

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone() {
  return '9' + String(Math.floor(100000000 + Math.random() * 900000000));
}

function randomDob() {
  const year  = 2008 + Math.floor(Math.random() * 5); // 2008–2012
  const month = String(Math.floor(1 + Math.random() * 12)).padStart(2, '0');
  const day   = String(Math.floor(1 + Math.random() * 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ─── Build 25 student payloads ───────────────────────────────────────────────
function buildStudents() {
  const students = [];
  for (let i = 0; i < 25; i++) {
    const firstName = firstNames[i];
    const lastName  = lastNames[i];
    const fullName  = `${firstName} ${lastName}`;
    const index     = String(i + 1).padStart(3, '0');
    const email     = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@fakeschool.com`;

    students.push({
      firstName,
      lastName,
      name           : fullName,
      email,
      password       : '123456',
      confirmPassword: '123456',
      gender         : i % 2 === 0 ? 'Male' : 'Female',
      dob            : randomDob(),
      bloodGroup     : randomPick(bloods),
      contactNumber  : randomPhone(),
      address        : `House ${i + 1}, Dummy Street, Fake City`,
      parentName     : `Parent of ${fullName}`,
      parentContact  : randomPhone(),
      parentEmail    : `parent.${firstName.toLowerCase()}${index}@fakeschool.com`,
      status         : 'active',
    });
  }
  return students;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────
async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method : 'POST',
    headers,
    body   : JSON.stringify(body),
  });

  let data;
  try { data = await res.json(); }
  catch { data = { raw: await res.text() }; }

  return { status: res.status, data };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔐  Logging in as superadmin …');

  // Login uses "username" field (not "email")
  const loginRes = await apiPost('/auth/login', {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  if (loginRes.status !== 200 || !loginRes.data?.accessToken) {
    console.error('❌  Login failed:', JSON.stringify(loginRes.data, null, 2));
    process.exit(1);
  }

  const token = loginRes.data.accessToken;
  console.log('✅  Logged in as:', loginRes.data.user?.name);
  console.log('');

  const students = buildStudents();
  let created = 0, failed = 0;

  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    process.stdout.write(`   [${String(i + 1).padStart(2, '0')}/25]  Creating "${s.name}" … `);

    const res = await apiPost('/students', s, token);

    if (res.status === 201 && res.data?.success) {
      const adm = res.data.accountCreated?.admissionNumber || res.data.student?.admissionNumber || '—';
      console.log(`✅  Admission: ${adm}`);
      created++;
    } else {
      console.log(`❌  ${res.data?.message || JSON.stringify(res.data)}`);
      failed++;
    }

    // Small delay to avoid hammering the server
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('');
  console.log('─'.repeat(55));
  console.log(`🎉  Done!  Created: ${created}  |  Failed: ${failed}`);
  console.log(`📌  Every student password: 123456`);
}

main().catch(err => {
  console.error('Unhandled error:', err.message || err);
  process.exit(1);
});
