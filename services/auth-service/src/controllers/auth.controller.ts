import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { UserService } from '../services/user.service.js';
import { TwoFactorService } from '../services/two-factor.service.js';
import { getCookieOptions, getCsrfCookieOptions, clearCookieOptions } from '../utils/cookie.js';
import { generateCSRFToken, refreshCSRFToken, revokeCSRFToken } from '../middlewares/csrf.middleware.js';
import { UnauthorizedError, BadRequestError, ForbiddenError, AuthenticatedRequest } from '@urbanfleet/common';
import asyncHandler from '../middlewares/asyncHandler.js';

export class AuthController {
  private authService: AuthService;
  private userService: UserService;
  private twoFactorService: TwoFactorService;

  constructor(
    authService: AuthService,
    userService: UserService,
    twoFactorService: TwoFactorService
  ) {
    this.authService = authService;
    this.userService = userService;
    this.twoFactorService = twoFactorService;
  }

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
        csrfToken,
        tokens: {
          accessToken: result.accessToken,
        }
      },
      tokens: {
        accessToken: result.accessToken,
      },
      user: result.user,
      accessToken: result.accessToken,
    });
  });

  login = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.authService.login({
      ...req.body,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    if ((result as any).requires2FASetup && (result as any).userId) {
      const setup = await this.twoFactorService.initiateSetup((result as any).userId);
      return res.status(200).json({
        success: true,
        data: {
          requiresTwoFactorSetup: true,
          userId: (result as any).userId,
          qrCodeUrl: setup.qrCodeUrl,
          otpauthUri: setup.otpauthUri,
          expiresInSeconds: setup.expiresInSeconds,
          message: 'Admin policy requires Two-Factor Authentication. Please complete setup to activate your account.'
        }
      });
    }

    if (result.requires2FA && result.userId) {
      const challenge = await this.twoFactorService.initiateLoginChallenge(result.userId, req.ip);
      return res.status(200).json({
        success: true,
        data: {
          requiresTwoFactor: true,
          challengeToken: challenge.challengeToken,
          expiresInSeconds: challenge.expiresInSeconds,
          message: 'Two-Factor Authentication required. Please provide TOTP verification code or recovery code.'
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
        csrfToken,
        tokens: {
          accessToken: result.accessToken,
        }
      },
      tokens: {
        accessToken: result.accessToken,
      },
      user: result.user,
      accessToken: result.accessToken,
    });
  });

  googleAuth = asyncHandler(async (req: Request, res: Response) => {
    const { credential } = req.body;
    const result = await this.authService.googleAuth(
      credential,
      req.ip,
      req.headers['user-agent']
    );

    // 1. Set httpOnly refresh cookie
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));
    }

    // 2. Set CSRF cookie
    const csrfToken = await generateCSRFToken(result.user.id, res);

    res.status(200).json({
      success: true,
      message: 'Signed in with Google successfully.',
      data: {
        user: result.user,
        accessToken: result.accessToken,
        csrfToken,
        tokens: {
          accessToken: result.accessToken,
        },
      },
      tokens: {
        accessToken: result.accessToken,
      },
      user: result.user,
      accessToken: result.accessToken,
    });
  });

  login2FA = asyncHandler(async (req: Request, res: Response) => {

    let user: any = null;

    if (req.body.challengeToken) {
      if (req.body.recoveryCode) {
        const result = await this.twoFactorService.verifyRecoveryCode(
          req.body.challengeToken,
          req.body.recoveryCode,
          req.ip
        );
        user = result.user;
      } else {
        const code = req.body.code || req.body.token || req.body.otp;
        if (!code || typeof code !== 'string') {
          throw new BadRequestError('Verification code or recovery code is required');
        }
        user = await this.twoFactorService.verifyLoginChallenge(
          req.body.challengeToken,
          code,
          req.ip
        );
      }
    } else if (req.body.userId) {
      // Backward compatibility for legacy test callers
      const isValid = await this.twoFactorService.verifyToken(
        req.body.userId,
        req.body.code || req.body.token || req.body.otp
      );
      if (!isValid) return res.status(401).json({ success: false, message: 'Invalid 2FA code' });
      user = await this.userService.getUserById(req.body.userId);
    } else {
      throw new UnauthorizedError('2FA challenge token or credentials required');
    }

    const authResult = await this.authService.complete2FALogin(
      user,
      req.ip,
      req.headers['user-agent']
    );

    // Set httpOnly refresh cookie
    res.cookie('refreshToken', authResult.refreshToken, getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));

    // Generate CSRF cookie
    const csrfToken = await generateCSRFToken(user.id, res);

    res.status(200).json({
      success: true,
      message: '2FA authentication successful',
      data: {
        user: authResult.user,
        accessToken: authResult.accessToken,
        csrfToken,
        tokens: {
          accessToken: authResult.accessToken,
        }
      },
      tokens: {
        accessToken: authResult.accessToken,
      },
      user: authResult.user,
      accessToken: authResult.accessToken,
    });
  });

  verifyOtp = asyncHandler(async (req: Request, res: Response, next: NextFunction) => this.login2FA(req, res, next));

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
        csrfToken,
        tokens: {
          accessToken: result.accessToken,
        }
      },
      tokens: {
        accessToken: result.accessToken,
      },
      user: result.user,
      accessToken: result.accessToken,
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
    const token = req.params?.token || req.body?.token || (req.query?.token as string);
    if (!token) {
      throw new BadRequestError('Verification token is required');
    }
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

  getUserById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const callerId = req.user?.userId || req.user?.id || req.userId;
    const targetId = req.params.id;

    if (!callerId) {
      throw new UnauthorizedError('User unauthenticated');
    }

    const roles: string[] = req.role || req.user?.roles || (req.user?.role ? [req.user.role] : []);
    const isPrivileged = roles.includes('ADMIN') || callerId === 'internal-service';
    const isSelf = callerId === targetId;

    if (!isPrivileged && !isSelf) {
      throw new ForbiddenError('You are not authorized to view another user profile');
    }

    const profile = await this.userService.getUserById(targetId);
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
    const result = await this.twoFactorService.initiateSetup(userId);
    res.status(200).json({
      success: true,
      message: '2FA setup initiated successfully. Scan QR code with your authenticator app.',
      data: {
        qrCodeUrl: result.qrCodeUrl,
        otpauthUri: result.otpauthUri,
        expiresInSeconds: result.expiresInSeconds,
      }
    });
  });

  verify2FA = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const { token } = req.body;
    if (!token) {
      throw new BadRequestError('Verification token is required');
    }
    const result = await this.twoFactorService.verifyAndEnable(userId, token);
    res.status(200).json({
      success: true,
      message: '2FA enabled successfully',
      data: {
        recoveryCodes: result.recoveryCodes,
      }
    });
  });

  disable2FA = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const { password, code } = req.body;
    if (!password) {
      throw new BadRequestError('Password is required to disable 2FA');
    }
    await this.twoFactorService.disable2FA(userId, password, code);
    res.status(200).json({ success: true, message: '2FA disabled successfully' });
  });

  regenerateRecoveryCodes = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const { password } = req.body;
    if (!password) {
      throw new BadRequestError('Password is required to regenerate recovery codes');
    }
    const result = await this.twoFactorService.regenerateRecoveryCodes(userId, password);
    res.status(200).json({
      success: true,
      message: 'Recovery codes regenerated successfully',
      data: {
        recoveryCodes: result.recoveryCodes,
      }
    });
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
