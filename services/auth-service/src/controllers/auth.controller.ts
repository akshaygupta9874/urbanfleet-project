import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { UserService } from '../services/user.service.js';
import { TwoFactorService } from '../services/two-factor.service.js';

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
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.authService.login({
        ...req.body,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  refreshToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      const result = await this.authService.refreshAccessToken(refreshToken);
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      await this.authService.logout(refreshToken);
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
      res.status(200).json({ success: true, message: '2FA authentication successful' });
    } catch (err) { next(err); }
  };
}
