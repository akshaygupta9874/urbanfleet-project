import { Request, Response } from "express";
import { AuthService } from "../services/auth.service.js";
import { UserService } from "../services/user.service.js";
import { verifyToken } from "../crypto/keys.js";
import { Role } from "../db/client.js";
import {
  getCookieOptions,
  getCsrfCookieOptions,
  clearCookieOptions,
} from "../utils/cookie.js";
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
    const userAgent = req.headers["user-agent"];
    const ipAddress = req.ip;
    if (!userAgent || !ipAddress) {
      throw new BadRequestError(
        "User agent and IP address are required in request body",
      );
    }

    const result = await this.authService.register(req.body);

    res.status(201).json({
      success: true,
      message: result.message,
      data: {
        user: result.user,
      },
    });
  });

  login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new BadRequestError(
        "Email and password are required in request body",
      );
    }

    const result = await this.authService.login({
      email,
      password,
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        email: result.email,
      },
    });
  });

  verifyOtp = asyncHandler(async (req: Request, res: Response) => {
    const { email, otp } = req.body;
    if (!email || !otp) {
      throw new BadRequestError("Email and OTP are required in request body");
    }
    const userAgent = req.headers["user-agent"];
    const ipAddress = req.ip;
    if (!userAgent || !ipAddress) {
      throw new BadRequestError(
        "User agent and IP address are required in request body",
      );
    }

    const result = await this.authService.verifyLoginOtp({
      email,
      otp,
      ipAddress,
      userAgent,
    });

    res.cookie(
      "refreshToken",
      result.refreshToken,
      getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }),
    );
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
    const userAgent =
      (req.headers["user-agent"] as string) ||
      (req.body.userAgent as string) ||
      "UrbanFleet-Web/1.0";
    const ipAddress =
      req.ip ||
      (req.headers["x-forwarded-for"] as string) ||
      (req.body.ipAddress as string) ||
      "127.0.0.1";

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

    res.cookie(
      "refreshToken",
      result.refreshToken,
      getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }),
    );

    const csrfToken = await generateCSRFToken(result.user.id, res);

    res.status(200).json({
      success: true,
      message: "Signed in with Google successfully.",
      accessToken: result.accessToken,
      user: result.user,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        csrfToken,
      },
    });
  });

  refreshToken = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const token = req.cookies?.refreshToken;
      if (!token) {
        throw new UnauthorizedError("Please provide refresh token");
      }
      const result = await this.authService.refreshAccessToken(token);

      if (result.refreshToken) {
        res.cookie(
          "refreshToken",
          result.refreshToken,
          getCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }),
        );
      }

      const csrfToken = await refreshCSRFToken(result.user.id, res);

      res.status(200).json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          csrfToken,
        },
      });
    },
  );

  logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    let token = req.cookies?.refreshToken;
    let sessionId = req.sessionId;
    let userId = req.userId;

    // 1. Try resolving userId and sessionId from Authorization header if missing
    if (!sessionId || !userId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const accessToken = authHeader.substring(7).trim();
        try {
          const decoded = verifyToken(accessToken);
          if (decoded) {
            userId = userId || decoded.userId;
            sessionId = sessionId || decoded.sessionId;
          }
        } catch {
          // Token expired or invalid - ignore
        }
      }
    }

    // 2. Check req.body in case client explicitly sent refreshToken or sessionId
    if (!token && req.body?.refreshToken) {
      token = req.body.refreshToken;
    }
    if (!sessionId && req.body?.sessionId) {
      sessionId = req.body.sessionId;
    }

    // 3. If token present but sessionId/userId still unresolved, decode refresh token
    if (token && (!sessionId || !userId)) {
      try {
        const decoded = verifyToken(token);
        if (decoded) {
          userId = userId || decoded.userId;
          sessionId = sessionId || decoded.sessionId;
        }
      } catch {
        // Refresh token may be invalid/expired
      }
    }

    await this.authService.logout(token, sessionId, userId);

    if (userId) {
      await revokeCSRFToken(userId, res);
    }

    const baseCookieOpts = clearCookieOptions();
    res.clearCookie("refreshToken", baseCookieOpts);
    res.clearCookie("refreshToken", { path: "/" });
    res.clearCookie("csrfToken", clearCookieOptions({ httpOnly: false }));
    res.clearCookie("csrfToken", { path: "/", httpOnly: false });

    // Explicitly overwrite with Set-Cookie expired headers for cross-browser reliability
    res.setHeader("Set-Cookie", [
      `refreshToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${baseCookieOpts.secure ? "; Secure; SameSite=None" : "; SameSite=Lax"}`,
      `csrfToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT${baseCookieOpts.secure ? "; Secure; SameSite=None" : "; SameSite=Lax"}`
    ]);

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
      const callerId = req.userId;
      const targetId = req.params.id;

      if (!callerId) {
        throw new UnauthorizedError("User unauthenticated");
      }

      const isSelf = callerId === targetId;
      if (!isSelf) {
        throw new ForbiddenError(
          "You are not authorized to view another user profile",
        );
      }

      const profile = await this.userService.getUserById(targetId);
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
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.params.id;
      const user = await this.userService.addDriverRole(userId);
      res.status(200).json({ success: true, data: user });
    },
  );

  refreshCSRF = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId;
      if (!userId) {
        return res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
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
