import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { validateRequest } from '@urbanfleet/common';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { verifyCsrfToken } from '../middlewares/csrf.middleware.js';
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  verifyTokenParamSchema,
  verify2FASchema,
  disable2FASchema,
  regenerateRecoveryCodesSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  resendVerificationSchema,
} from '../validation/auth.validation.js';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  // Public Identity Endpoints
  router.post('/register', validateRequest({ body: registerSchema }), controller.register);
  router.post('/login', validateRequest({ body: loginSchema }), controller.login);
  router.post('/verify-otp', validateRequest({ body: verifyOtpSchema }), controller.verifyOtp);
  router.post('/verify/:token', validateRequest({ params: verifyTokenParamSchema }), controller.verifyEmail);
  router.get('/verify/:token', validateRequest({ params: verifyTokenParamSchema }), controller.verifyEmail);
  router.post('/refresh-token', controller.refreshToken);
  router.post('/refresh', controller.refreshToken);
  router.post('/logout', controller.logout);

  // Password & Email Recovery Endpoints
  if (controller.forgotPassword) {
    router.post('/forgot-password', validateRequest({ body: forgotPasswordSchema }), controller.forgotPassword);
  }
  if (controller.resetPassword) {
    router.post('/reset-password', validateRequest({ body: resetPasswordSchema }), controller.resetPassword);
  }
  if (controller.resendVerificationEmail) {
    router.post('/resend-verification', validateRequest({ body: resendVerificationSchema }), controller.resendVerificationEmail);
  }

  // Authenticated Profile & User Endpoints
  router.get('/me', authMiddleware, controller.getProfile);
  if (controller.getUserById) {
    router.get('/users/:id', authMiddleware, controller.getUserById);
  }
  if (controller.changePassword) {
    router.post('/change-password', authMiddleware, verifyCsrfToken, validateRequest({ body: changePasswordSchema }), controller.changePassword);
  }
  if (controller.refreshCSRF) {
    router.post('/refresh-csrf', authMiddleware, controller.refreshCSRF);
  }

  // 2FA Management Endpoints (Requires Authentication & Anti-CSRF)
  if (controller.enable2FA) {
    router.post('/2fa/initiate', authMiddleware, verifyCsrfToken, controller.enable2FA);
  }
  if (controller.verify2FA) {
    router.post('/2fa/verify', authMiddleware, verifyCsrfToken, validateRequest({ body: verify2FASchema }), controller.verify2FA);
  }
  if (controller.disable2FA) {
    router.post('/2fa/disable', authMiddleware, verifyCsrfToken, validateRequest({ body: disable2FASchema }), controller.disable2FA);
  }
  if (controller.regenerateRecoveryCodes) {
    router.post('/2fa/recovery-codes', authMiddleware, verifyCsrfToken, validateRequest({ body: regenerateRecoveryCodesSchema }), controller.regenerateRecoveryCodes);
  }

  return router;
}
