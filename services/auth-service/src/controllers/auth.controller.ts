import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { UserService } from '../services/user.service.js';
import { getCookieOptions, getCsrfCookieOptions, clearCookieOptions } from '../utils/cookie.js';
import { generateCSRFToken, refreshCSRFToken, revokeCSRFToken } from '../middlewares/csrf.middleware.js';
import { UnauthorizedError, BadRequestError, ForbiddenError, AuthenticatedRequest, asyncHandler } from '@urbanfleet/common';

export class AuthController {
  private authService: AuthService;
  private userService: UserService;

  constructor(
    authService: AuthService,
    userService: UserService
  ) {
    this.authService = authService;
    this.userService = userService;
  }

  register = asyncHandler(async (req: Request, res: Response) => {
    const userAgent = req.body?.userAgent ?? req.body?.useragent;
    const ipAddress = req.body?.ipAddress ?? req.body?.ip;

    if (!userAgent || typeof userAgent !== 'string' || !userAgent.trim()) {
      throw new BadRequestError('userAgent is required in request body');
    }
    if (!ipAddress || typeof ipAddress !== 'string' || !ipAddress.trim()) {
      throw new BadRequestError('ipAddress is required in request body');
    }

    const result = await this.authService.register({
      ...req.body,
      ipAddress,
      userAgent
    });

    res.status(201).json({
      success: true,
      message: result.message || 'User registered successfully. Please verify your email before logging in.',
      data: {
        user: result.user,
      },
      user: result.user,
    });
  });

  login = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.authService.login({
      ...req.body,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email',
      data: {
        requiresOtp: true,
        userId: result.userId,
        email: result.email,
      },
    });
  });

  verifyOtp = asyncHandler(async (req: Request, res: Response) => {
    const { email, userId, otp } = req.body;
    const submittedOtp = otp;

    const result = await this.authService.verifyLoginOtp({
      email,
      userId,
      otp: submittedOtp,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie('refreshToken', result.refreshToken, getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));


    // Generate CSRF cookie
    const csrfToken = await generateCSRFToken(result.user.id, res);

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

  refreshToken = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
    const token = req.cookies?.refreshToken;
    if (token) {
      await this.authService.logout(token);
    }

    const userId = req.userId;
    if (userId) {
      await revokeCSRFToken(userId, res);
    }

    res.clearCookie('refreshToken', clearCookieOptions());
    res.clearCookie('csrfToken', getCsrfCookieOptions());

    res.status(200).json({ success: true, message: 'Logged out successfully' });
  });

  changePassword = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.userId;
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
    const token = req.params.token;
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
    const userId = req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const profile = await this.userService.getUserById(userId);
    res.status(200).json({ success: true, data: profile });
  });

  getUserById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const callerId = req.userId;
    const targetId = req.params.id;

    if (!callerId) {
      throw new UnauthorizedError('User unauthenticated');
    }

    const roles: string[] = req.roles || [];
    const isPrivileged = roles.includes('ADMIN');
    const isSelf = callerId === targetId;

    if (!isPrivileged && !isSelf) {
      throw new ForbiddenError('You are not authorized to view another user profile');
    }

    const profile = await this.userService.getUserById(targetId);
    res.status(200).json({ success: true, data: profile });
  });

  updateProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId;
    if (!userId) {
      throw new UnauthorizedError('User unauthenticated');
    }
    const updated = await this.userService.updateUser(userId, req.body);
    res.status(200).json({ success: true, data: updated });
  });

  grantDriverRole = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!(req.roles ?? []).includes('ADMIN')) {
      throw new ForbiddenError('Only administrators can grant driver access');
    }
    const userId = req.params.id;
    const user = await this.userService.addDriverRole(userId);
    res.status(200).json({ success: true, data: user });
  });

  refreshCSRF = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId;
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
