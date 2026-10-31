import { Router, Request } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { validateRequest, slidingWindowRateLimit } from '@urbanfleet/common';
import { authMiddleware, requireRole, requireAdminOrInternalService } from '../middlewares/auth.middleware.js';
import { Role } from '../db/client.js';
import { verifyCsrfToken } from '../middlewares/csrf.middleware.js';
import { authRedisClient } from '../redis/client.js';
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  verifyTokenParamSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  resendVerificationSchema,
  googleAuthSchema,
} from '../validation/auth.validation.js';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  // Sliding Window Rate Limiters
  const loginLimiter = slidingWindowRateLimit({
    redis: authRedisClient,
    limit: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:auth:login',
    keyGenerator: (req: Request) => `${req.ip}:${req.body?.email || 'anon'}`,
    failOpen: true,
  });

  const otpLimiter = slidingWindowRateLimit({
    redis: authRedisClient,
    limit: 5,
    windowSeconds: 300,
    keyPrefix: 'rl:auth:otp',
    keyGenerator: (req: Request) => `${req.body?.email || req.body?.userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  const registerLimiter = slidingWindowRateLimit({
    redis: authRedisClient,
    limit: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:auth:register',
    failOpen: true,
  });

  const recoveryLimiter = slidingWindowRateLimit({
    redis: authRedisClient,
    limit: 5,
    windowSeconds: 300,
    keyPrefix: 'rl:auth:recovery',
    keyGenerator: (req: Request) => `${req.body?.email || req.ip || 'anon'}`,
    failOpen: true,
  });

  const passwordChangeLimiter = slidingWindowRateLimit({
    redis: authRedisClient,
    limit: 5,
    windowSeconds: 300,
    keyPrefix: 'rl:auth:pwd-change',
    keyGenerator: (req: Request) => `${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  // Public Health Endpoint
  router.get('/health', (_req, res) => res.status(200).json({ status: 'UP', service: 'auth-service' }));

  // Public Identity Endpoints
  router.post('/register', registerLimiter, validateRequest({ body: registerSchema }), controller.register);
  router.post('/login', loginLimiter, validateRequest({ body: loginSchema }), controller.login);
  if (controller.googleAuth) {
    router.post('/google', loginLimiter, validateRequest({ body: googleAuthSchema }), controller.googleAuth);
  }
  router.post('/verify-otp', otpLimiter, validateRequest({ body: verifyOtpSchema }), controller.verifyOtp);
  router.post('/verify/:token', validateRequest({ params: verifyTokenParamSchema }), controller.verifyEmail);
  router.get('/verify/:token', validateRequest({ params: verifyTokenParamSchema }), controller.verifyEmail);
  // Refresh Token & Session Revocation (Canonical transport: HttpOnly Cookie)
  router.post('/refresh', controller.refreshToken);
  router.post('/refresh-token', controller.refreshToken);
  router.post('/logout', controller.logout);

  // Password & Email Recovery Endpoints
  if (controller.forgotPassword) {
    router.post('/forgot-password', recoveryLimiter, validateRequest({ body: forgotPasswordSchema }), controller.forgotPassword);
  }
  if (controller.resetPassword) {
    router.post('/reset-password', recoveryLimiter, validateRequest({ body: resetPasswordSchema }), controller.resetPassword);
  }
  if (controller.resendVerificationEmail) {
    router.post('/resend-verification', recoveryLimiter, validateRequest({ body: resendVerificationSchema }), controller.resendVerificationEmail);
  }

  // Authenticated Profile & User Endpoints
  if (controller.grantDriverRole) {
    router.post('/internal/users/:id/driver-role', requireAdminOrInternalService, controller.grantDriverRole);
  }
  router.get('/me', authMiddleware, controller.getProfile);
  if (controller.getUserById) {
    router.get('/users/:id', requireAdminOrInternalService, controller.getUserById);
    router.get('/internal/users/:id', requireAdminOrInternalService, controller.getUserById);
  }
  if (controller.changePassword) {
    router.post('/change-password', authMiddleware, passwordChangeLimiter, verifyCsrfToken, validateRequest({ body: changePasswordSchema }), controller.changePassword);
  }
  if (controller.refreshCSRF) {
    router.post('/refresh-csrf', authMiddleware, controller.refreshCSRF);
  }

  // Active Session Management Endpoints
  if (controller.listSessions) {
    router.get('/sessions', authMiddleware, controller.listSessions);
  }
  if (controller.revokeSession) {
    router.delete('/sessions/:id', authMiddleware, controller.revokeSession);
  }
  if (controller.logoutAllOtherSessions) {
    router.post('/sessions/logout-all', authMiddleware, controller.logoutAllOtherSessions);
  }

  return router;
}
