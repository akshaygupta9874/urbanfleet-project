import { Request, Response } from "express";
import { AuthService } from "../services/auth.service.js";
import { UserService } from "../services/user.service.js";
import { verifyToken } from "../crypto/keys.js";
import { Role } from "../db/client.js";
import { hasRole } from "../middlewares/auth.middleware.js";
import {
  setRefreshTokenCookie,
  clearAuthCookies,
} from "../utils/cookie.js";
import { extractClientMetadata } from "../utils/client-metadata.js";
import {
  generateCSRFToken,
  refreshCSRFToken,
  revokeCSRFToken,
} from "../middlewares/csrf.middleware.js";
import {
  UnauthorizedError,
  BadRequestError,
  ForbiddenError,
  AuthenticatedRequest,
  asyncHandler,
} from "@urbanfleet/common";

export class AuthController {
  private authService: AuthService;
  private userService: UserService;

  constructor(authService: AuthService, userService: UserService) {
    this.authService = authService;
    this.userService = userService;
  }

  register = asyncHandler(async (req: Request, res: Response) => {
    const { userAgent, ipAddress } = extractClientMetadata(req);

    const result = await this.authService.register({
      ...req.body,
      userAgent,
      ipAddress,
    });

    const statusCode = result.isExistingUser ? 200 : 201;

    res.status(statusCode).json({
      success: true,
      message: result.message,
      data: {
        user: result.user,
      },
    });
  });

  login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    const result = await this.authService.login({
      email,
      password,
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        email: result.email,
        devOtp: result.devOtp,
      },
    });
  });

  verifyOtp = asyncHandler(async (req: Request, res: Response) => {
    const { email, otp, roles, role } = req.body;
    const { userAgent, ipAddress } = extractClientMetadata(req);

    const requestedRoles: Role[] | undefined =
      Array.isArray(roles) && roles.length > 0
        ? (roles as Role[])
        : role
          ? [role as Role]
          : undefined;

    const result = await this.authService.verifyLoginOtp({
      email,
      otp,
      ipAddress,
      userAgent,
      roles: requestedRoles,
    });

    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = await generateCSRFToken(result.user.id, res);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: result.user,
        accessToken: result.accessToken,
        csrfToken,
      },
    });
  });

  googleAuth = asyncHandler(async (req: Request, res: Response) => {
    const { credential, roles, role } = req.body;
    const { userAgent, ipAddress } = extractClientMetadata(req, {
      required: false,
    });

    const requestedRoles: Role[] | undefined =
      Array.isArray(roles) && roles.length > 0
        ? (roles as Role[])
        : role
          ? [role as Role]
          : undefined;

    const result = await this.authService.googleAuth(
      credential,
      ipAddress,
      userAgent,
      requestedRoles,
    );

    setRefreshTokenCookie(res, result.refreshToken);

    const csrfToken = await generateCSRFToken(result.user.id, res);

    res.status(200).json({
      success: true,
      message: "Signed in with Google successfully.",
      data: {
        user: result.user,
        accessToken: result.accessToken,
        csrfToken,
      },
    });
  });

  refreshToken = asyncHandler(
    async (req: Request, res: Response) => {
      // Single Source of Truth for Refresh Token: HttpOnly Cookie
      const token = req.cookies?.refreshToken;
      if (!token) {
        throw new UnauthorizedError("Please provide refresh token");
      }
      const result = await this.authService.refreshAccessToken(token);

      if (result.refreshToken) {
        setRefreshTokenCookie(res, result.refreshToken);
      }

      const csrfToken = await refreshCSRFToken(result.user.id, res);

      res.status(200).json({
        success: true,
        message: "Access token refreshed",
        data: {
          user: result.user,
          accessToken: result.accessToken,
          csrfToken,
        },
      });
    },
  );

  logout = asyncHandler(async (req: Request, res: Response) => {
    // Single Source of Truth for Session Revocation: HttpOnly Cookie
    const token = req.cookies?.refreshToken;

    if (token) {
      let decoded;
      try {
        decoded = verifyToken(token);
      } catch {
        throw new UnauthorizedError("Invalid or expired refresh token");
      }

      if (
        !decoded ||
        decoded.tokenType !== "REFRESH" ||
        !decoded.userId ||
        !decoded.sessionId
      ) {
        throw new UnauthorizedError("Invalid refresh token payload");
      }

      await this.authService.logout(token, decoded.sessionId, decoded.userId);
      await revokeCSRFToken(decoded.userId);
    }

    clearAuthCookies(res);

    res.status(200).json({ success: true, message: "Logged out successfully" });
  });

  listSessions = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId;
      if (!userId) {
        throw new UnauthorizedError("User unauthenticated");
      }
      const currentSessionId = req.sessionId;
      const result = await this.authService.listActiveSessions(
        userId,
        currentSessionId,
      );
      res.status(200).json({
        success: true,
        data: result,
      });
    },
  );

  revokeSession = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId;
      if (!userId) {
        throw new UnauthorizedError("User unauthenticated");
      }
      const sessionId = req.params.id;
      if (!sessionId) {
        throw new BadRequestError("Session ID is required");
      }
      const result = await this.authService.revokeSession(userId, sessionId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    },
  );

  logoutAllOtherSessions = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId;
      const currentSessionId = req.sessionId;
      if (!userId || !currentSessionId) {
        throw new UnauthorizedError(
          "User unauthenticated or session not identified",
        );
      }
      const result = await this.authService.revokeAllOtherSessions(
        userId,
        currentSessionId,
      );
      res.status(200).json({
        success: true,
        message: result.message,
      });
    },
  );

  changePassword = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const { oldPassword, newPassword } = req.body;
      const userId = req.userId;
      if (!userId) {
        throw new UnauthorizedError("User unauthenticated");
      }
      await this.authService.changePassword(userId, oldPassword, newPassword);
      res
        .status(200)
        .json({ success: true, message: "Password updated successfully" });
    },
  );

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
      throw new BadRequestError("Verification token is required");
    }
    const result = await this.authService.verifyEmail(token);
    res.status(200).json({ success: true, data: result });
  });

  resendVerificationEmail = asyncHandler(
    async (req: Request, res: Response) => {
      const { email } = req.body;
      const result = await this.authService.resendVerificationToken(email);
      res.status(200).json({ success: true, data: result });
    },
  );

  getProfile = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId;
      if (!userId) {
        throw new UnauthorizedError("User unauthenticated");
      }
      const profile = await this.userService.getUserById(userId);
      res.status(200).json({ success: true, data: profile });
    },
  );

  getUserById = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const targetId = req.params.id;
      const callerId = req.userId;

      if (!callerId) {
        throw new UnauthorizedError("User unauthenticated");
      }

      const isSelf = callerId === targetId;
      const isAdmin = hasRole(req, Role.ADMIN);
      if (!isSelf && !isAdmin) {
        throw new ForbiddenError(
          "You are not authorized to view another user profile",
        );
      }

      const profile = await this.userService.getUserById(targetId);
      if (!profile) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      res.status(200).json({ success: true, data: profile });
    },
  );

  updateProfile = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId;
      if (!userId) {
        throw new UnauthorizedError("User unauthenticated");
      }
      const updated = await this.userService.updateUser(userId, req.body);
      res.status(200).json({ success: true, data: updated });
    },
  );

  grantDriverRole = asyncHandler(
    async (req: Request, res: Response) => {
      const userId = req.params.id;
      const user = await this.userService.addDriverRole(userId);
      res.status(200).json({ success: true, data: user });
    },
  );

  refreshCSRF = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId;
      if (!userId) {
        throw new UnauthorizedError("User unauthenticated");
      }
      const csrfToken = await refreshCSRFToken(userId, res);
      res.status(200).json({
        success: true,
        message: "CSRF Token Refreshed",
        data: { csrfToken },
      });
    },
  );
}
