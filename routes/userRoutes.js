import express from 'express';
import {
  getUsers,
  getRoles,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  resetUserPassword,
  deleteUser
} from '../controllers/userController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

// All user management routes require authentication and Admin privileges
router.use(protect);
router.use(authorize('super-admin', 'school-admin', 'admin'));

// Fetch all roles with counts
router.get('/roles', getRoles);

// User CRUD endpoints
router.get('/', getUsers);
router.post('/', createUser);
router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

// Quick status & password actions
router.patch('/:id/status', toggleUserStatus);
router.patch('/:id/reset-password', resetUserPassword);

export default router;
