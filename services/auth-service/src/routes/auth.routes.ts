import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { createAuthMiddleware } from '@urbanfleet/common';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware();

  // Public Routes
  router.post('/register', controller.register);
  router.post('/login', controller.login);
  router.post('/refresh-token', controller.refreshToken);
  router.post('/logout', controller.logout);
  router.post('/forgot-password', controller.forgotPassword);
  router.post('/reset-password', controller.resetPassword);
  router.post('/verify-email', controller.verifyEmail);
  router.post('/resend-verification', controller.resendVerificationEmail);
  router.post('/2fa/login', controller.login2FA);

  // Authenticated Routes
  router.get('/me', authMiddleware as any, controller.getProfile);
  router.patch('/me', authMiddleware as any, controller.updateProfile);
  router.post('/change-password', authMiddleware as any, controller.changePassword);
  router.post('/2fa/enable', authMiddleware as any, controller.enable2FA);
  router.post('/2fa/verify', authMiddleware as any, controller.verify2FA);
  router.post('/2fa/disable', authMiddleware as any, controller.disable2FA);

  return router;
}
