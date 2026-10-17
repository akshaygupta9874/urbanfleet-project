import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { validateRequest } from '@urbanfleet/common';
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  verifyTokenParamSchema,
} from '../validation/auth.validation.js';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  router.post('/register', validateRequest({ body: registerSchema }), controller.register);
  router.post('/login', validateRequest({ body: loginSchema }), controller.login);
  router.post('/verify-otp', validateRequest({ body: verifyOtpSchema }), controller.verifyOtp);
  router.post('/verify/:token', validateRequest({ params: verifyTokenParamSchema }), controller.verifyEmail);
  router.post('/refresh-token', controller.refreshToken);
  router.post('/refresh', controller.refreshToken);
  router.post('/logout', controller.logout);
  router.get('/me', controller.getProfile);
  if (controller.getUserById) {
    router.get('/users/:id', controller.getUserById);
  }
  if (controller.refreshCSRF) {
    router.post('/refresh-csrf', controller.refreshCSRF);
  }

  // 2FA Management Endpoints
  if (controller.enable2FA) {
    router.post('/2fa/initiate', controller.enable2FA);
  }
  if (controller.verify2FA) {
    router.post('/2fa/verify', controller.verify2FA);
  }
  if (controller.disable2FA) {
    router.post('/2fa/disable', controller.disable2FA);
  }
  if (controller.regenerateRecoveryCodes) {
    router.post('/2fa/recovery-codes', controller.regenerateRecoveryCodes);
  }

  return router;
}
