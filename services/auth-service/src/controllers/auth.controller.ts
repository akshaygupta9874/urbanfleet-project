import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { UserService } from '../services/user.service.js';
import { TwoFactorService } from '../services/two-factor.service.js';
import { getCookieOptions, getCsrfCookieOptions, clearCookieOptions } from '../utils/cookie.js';
import { generateCSRFToken, refreshCSRFToken, revokeCSRFToken } from '../middlewares/csrf.middleware.js';
import { UnauthorizedError, AuthenticatedRequest } from '@urbanfleet/common';
import asyncHandler from '../middlewares/asyncHandler.js';

export class AuthController {
  constructor(
    private authService: AuthService,
    private userService: UserService,
    private twoFactorService: TwoFactorService
  ) {}

  register = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.authService.register({
      ...req.body,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // 1. Set httpOnly refresh cookie (XSS mitigation)
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));
    }

    // 2. Set double-submit anti-CSRF token cookie
    const csrfToken = await generateCSRFToken(result.user.id, res);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        csrfToken,
      },
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  });

  login = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.authService.login({
      ...req.body,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    if (result.requires2FA) {
      return res.status(200).json({
        success: true,
        data: {
          requiresTwoFactor: true,
          userId: result.userId,
          message: 'Two-Factor Authentication required. Please provide TOTP token.'
        }
      });
    }

    // 1. Set httpOnly refresh cookie
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));
    }

    // 2. Set CSRF cookie
    const csrfToken = await generateCSRFToken(result.user!.id, res);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        csrfToken,
      },
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  });

  refreshToken = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Refresh token is strictly and only extracted from httpOnly cookies
    const token = req.cookies?.refreshToken;
    if (!token) {
      throw new UnauthorizedError('Please provide refresh token');
    }
    const result = await this.authService.refreshAccessToken(token);

    // Rotate httpOnly refresh token cookie
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));
    }

    // Rotate CSRF token cookie
    const csrfToken = await refreshCSRFToken(result.user.id, res);

    res.status(200).json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        csrfToken,
      },
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  });

  logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Refresh token is strictly read from cookies
    const token = req.cookies?.refreshToken;
    if (token) {
      await this.authService.logout(token);
    }

    const userId = req.user?.userId || req.user?.id || req.userId;
    if (userId) {
      await revokeCSRFToken(userId, res);
    }

    // Clear cookies with matching path & domain
    res.clearCookie('refreshToken', clearCookieOptions());
    res.clearCookie('csrfToken', getCsrfCookieOptions());

    res.status(200).json({ success: true, message: 'Logged out successfully' });
  });

  changePassword = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    await this.authService.changePassword(userId, oldPassword, newPassword);
    res.status(200).json({ success: true, message: 'Password updated successfully' });
  });

  forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    const result = await this.authService.requestPasswordReset(email);
    res.status(200).json({ success: true, data: result });
  });

  resetPassword = asyncHandler(async (req: Request, res: Response) => {
    const { token, newPassword } = req.body;
    const result = await this.authService.resetPassword(token, newPassword);
    res.status(200).json({ success: true, data: result });
  });

  verifyEmail = asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.body;
    const result = await this.authService.verifyEmail(token);
    res.status(200).json({ success: true, data: result });
  });

  resendVerificationEmail = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    const result = await this.authService.resendVerificationToken(email);
    res.status(200).json({ success: true, data: result });
  });

  getProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const profile = await this.userService.getUserById(userId);
    res.status(200).json({ success: true, data: profile });
  });

  getUserById = asyncHandler(async (req: Request, res: Response) => {
    const profile = await this.userService.getUserById(req.params.id);
    res.status(200).json({ success: true, data: profile });
  });

  updateProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const updated = await this.userService.updateUser(userId, req.body);
    res.status(200).json({ success: true, data: updated });
  });

  enable2FA = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const result = await this.twoFactorService.generateSecret(userId);
    res.status(200).json({ success: true, data: result });
  });

  verify2FA = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const { token } = req.body;
    const result = await this.twoFactorService.enable2FA(userId, token);
    res.status(200).json({ success: true, data: result });
  });

  disable2FA = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const { token } = req.body;
    const result = await this.twoFactorService.disable2FA(userId, token);
    res.status(200).json({ success: true, data: result });
  });

  verifyOtp = asyncHandler(async (req: Request, res: Response, next: NextFunction) => this.login2FA(req, res, next));

  login2FA = asyncHandler(async (req: Request, res: Response) => {
    const { userId, token } = req.body;
    const isValid = await this.twoFactorService.verifyToken(userId, token);
    if (!isValid) return res.status(401).json({ success: false, message: 'Invalid 2FA code' });

    // Generate CSRF cookie for authenticated 2FA session
    const csrfToken = await generateCSRFToken(userId, res);
    res.status(200).json({ success: true, message: '2FA authentication successful', data: { csrfToken } });
  });

  refreshCSRF = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    const csrfToken = await refreshCSRFToken(userId, res);
    res.status(200).json({
      success: true,
      message: 'CSRF Token Refreshed',
      data: { csrfToken }
    });
  });
}
