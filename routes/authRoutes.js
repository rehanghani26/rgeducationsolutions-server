import express from 'express';
import { login, signup, logout, refresh, getMe } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.post('/signup', signup);
router.post('/logout', logout);
router.post('/refresh', refresh);
router.get('/me', protect, getMe);

export default router;
