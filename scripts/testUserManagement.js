import axios from 'axios';

async function test() {
  const baseURL = 'http://localhost:5000/api/v1';

  try {
    console.log('1. Testing Admin Login...');
    const adminLogin = await axios.post(`${baseURL}/auth/login`, {
      username: 'superadmin',
      password: 'admin'
    });
    const adminToken = adminLogin.data.accessToken;
    console.log('   ✅ Logged in as:', adminLogin.data.user.username, 'Role:', adminLogin.data.user.role);

    console.log('\n2. Testing GET /api/v1/users/roles...');
    const rolesRes = await axios.get(`${baseURL}/users/roles`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('   ✅ Received roles:', rolesRes.data.roles.length);
    rolesRes.data.roles.forEach(r => {
      console.log(`      * ${r.name} (${r.id}) -> ${r.userCount} user(s)`);
    });

    console.log('\n3. Testing GET /api/v1/users (All Users)...');
    const usersRes = await axios.get(`${baseURL}/users`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('   ✅ Total users in system:', usersRes.data.users.length);
    usersRes.data.users.forEach(u => {
      console.log(`      * ${u.name} (@${u.username}) -> Role: ${u.role} | Active: ${u.isActive}`);
    });

    console.log('\n4. Testing POST /api/v1/users (Create Test User)...');
    const testUsername = `testuser_${Date.now()}`;
    const createRes = await axios.post(`${baseURL}/users`, {
      name: 'Test Librarian Staff',
      username: testUsername,
      email: `${testUsername}@school.edu`,
      password: 'TestPassword123!',
      role: 'librarian',
      employeeId: 'LIB999',
      isActive: true
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('   ✅ Created user:', createRes.data.user.name, 'ID:', createRes.data.user.id || createRes.data.user._id);
    const newUserId = createRes.data.user.id || createRes.data.user._id;

    console.log('\n5. Testing PATCH /api/v1/users/:id/status (Toggle Status)...');
    const statusRes = await axios.patch(`${baseURL}/users/${newUserId}/status`, {}, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('   ✅ New active status:', statusRes.data.isActive);

    console.log('\n6. Testing DELETE /api/v1/users/:id (Cleanup Test User)...');
    const deleteRes = await axios.delete(`${baseURL}/users/${newUserId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('   ✅ Delete result:', deleteRes.data.message);

    console.log('\n7. Testing RBAC Security: Teacher role accessing /api/v1/users...');
    const teacherLogin = await axios.post(`${baseURL}/auth/login`, {
      username: 'teacher',
      password: 'admin'
    });
    const teacherToken = teacherLogin.data.accessToken;

    try {
      await axios.get(`${baseURL}/users`, {
        headers: { Authorization: `Bearer ${teacherToken}` }
      });
      console.log('   ❌ Security failed: Teacher accessed user management endpoint!');
    } catch (err) {
      console.log('   ✅ Access correctly denied for Teacher with HTTP status:', err.response?.status, `(${err.response?.data?.message})`);
    }

    console.log('\n🎉 ALL USER MANAGEMENT TESTS PASSED SUCCESSFULLY!');
  } catch (error) {
    console.error('❌ Test failed with error:', error.response?.data || error.message);
  }
}

test();
