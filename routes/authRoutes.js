import express from 'express';
import {
  login,
  signup,
  logout,
  refresh,
  getMe,
  getSetupStatus,
  sendSetupOtp,
  verifySetupOtp,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/setup-status', getSetupStatus);
router.post('/send-otp', sendSetupOtp);
router.post('/verify-otp', verifySetupOtp);
router.post('/login', login);
router.post('/signup', signup);
router.post('/logout', logout);
router.post('/refresh', refresh);
router.get('/me', protect, getMe);

export default router;
