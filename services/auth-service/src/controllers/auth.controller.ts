import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { UserService } from '../services/user.service.js';
import { TwoFactorService } from '../services/two-factor.service.js';
import { getCookieOptions, getCsrfCookieOptions, clearCookieOptions } from '../utils/cookie.js';
import { generateCSRFToken, refreshCSRFToken, revokeCSRFToken } from '../middlewares/csrf.middleware.js';
import { UnauthorizedError } from '@urbanfleet/common';

export class AuthController {
  constructor(
    private authService: AuthService,
    private userService: UserService,
    private twoFactorService: TwoFactorService
  ) {}

  register = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.authService.register({
        ...req.body,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      // 1. Set httpOnly refresh cookie (XSS mitigation)
      if (result.refreshToken) {
        res.cookie('refreshToken', result.refreshToken, getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));
      }

      // 2. Generate and set CSRF cookie
      const csrfToken = await generateCSRFToken(result.user.id, res);

      res.status(201).json({ success: true, data: { ...result, csrfToken } });
    } catch (err) { next(err); }
  };

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.authService.login({
        ...req.body,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      if (result.requires2FA) {
        return res.status(200).json({ success: true, data: result });
      }

      // 1. Set httpOnly refresh cookie (XSS mitigation)
      if (result.refreshToken) {
        res.cookie('refreshToken', result.refreshToken, getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));
      }

      // 2. Generate and set CSRF cookie
      const csrfToken = await generateCSRFToken(result.user!.id, res);

      res.status(200).json({ success: true, data: { ...result, csrfToken } });
    } catch (err) { next(err); }
  };

  refreshToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.refreshToken || req.body?.refreshToken;
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

      res.status(200).json({ success: true, data: { ...result, csrfToken } });
    } catch (err) { next(err); }
  };

  logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.refreshToken || req.body?.refreshToken;
      if (token) {
        await this.authService.logout(token);
      }

      const userId = (req as any).user?.userId || req.body?.userId;
      if (userId) {
        await revokeCSRFToken(userId, res);
      }

      // Clear cookies with matching path & domain
      res.clearCookie('refreshToken', clearCookieOptions());
      res.clearCookie('csrfToken', getCsrfCookieOptions());

      res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (err) { next(err); }
  };

  changePassword = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { oldPassword, newPassword } = req.body;
      await this.authService.changePassword(req.user.userId, oldPassword, newPassword);
      res.status(200).json({ success: true, message: 'Password updated successfully' });
    } catch (err) { next(err); }
  };

  forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      const result = await this.authService.requestPasswordReset(email);
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, newPassword } = req.body;
      const result = await this.authService.resetPassword(token, newPassword);
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body;
      const result = await this.authService.verifyEmail(token);
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  resendVerificationEmail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      const result = await this.authService.resendVerificationToken(email);
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  getProfile = async (req: any, res: Response, next: NextFunction) => {
    try {
      const profile = await this.userService.getUserById(req.user.userId);
      res.status(200).json({ success: true, data: profile });
    } catch (err) { next(err); }
  };

  getUserById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await this.userService.getUserById(req.params.id);
      res.status(200).json({ success: true, data: profile });
    } catch (err) { next(err); }
  };

  updateProfile = async (req: any, res: Response, next: NextFunction) => {
    try {
      const updated = await this.userService.updateUser(req.user.userId, req.body);
      res.status(200).json({ success: true, data: updated });
    } catch (err) { next(err); }
  };

  enable2FA = async (req: any, res: Response, next: NextFunction) => {
    try {
      const result = await this.twoFactorService.generateSecret(req.user.userId);
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  verify2FA = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body;
      const result = await this.twoFactorService.enable2FA(req.user.userId, token);
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  disable2FA = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body;
      const result = await this.twoFactorService.disable2FA(req.user.userId, token);
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  verifyOtp = async (req: Request, res: Response, next: NextFunction) => this.login2FA(req, res, next);

  login2FA = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, token } = req.body;
      const isValid = await this.twoFactorService.verifyToken(userId, token);
      if (!isValid) return res.status(401).json({ success: false, message: 'Invalid 2FA code' });

      // Generate CSRF cookie for authenticated 2FA session
      const csrfToken = await generateCSRFToken(userId, res);
      res.status(200).json({ success: true, message: '2FA authentication successful', data: { csrfToken } });
    } catch (err) { next(err); }
  };

  refreshCSRF = async (req: any, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId || req.body?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
      }
      const csrfToken = await refreshCSRFToken(userId, res);
      res.status(200).json({
        success: true,
        message: 'CSRF Token Refreshed',
        data: { csrfToken }
      });
    } catch (err) { next(err); }
  };
}
