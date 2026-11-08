import { type Request, type Response } from 'express';
import axios from 'axios';
import { ZodError } from 'zod';
import { type AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { AdminService } from '../services/admin.service.js';
import {
  analyticsQuerySchema,
  driverVerificationSchema,
  idParamSchema,
  paginationQuerySchema,
  systemSettingsSchema,
  userSuspensionSchema,
} from '../validation/admin.validation.js';

type AdminRequest = Request & Partial<Pick<AuthenticatedRequest, 'userId' | 'roles'>>;

function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return undefined;
}

function handleControllerError(error: unknown, res: Response) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (axios.isAxiosError(error)) {
    return res.status(error.response?.status || 502).json(
      error.response?.data || {
        success: false,
        message: 'Upstream microservice unavailable',
      }
    );
  }
  const message = error instanceof Error ? error.message : 'Admin operation failed';
  return res.status(500).json({ success: false, message });
}

export class AdminController {
  constructor(private readonly service: AdminService) {}

  getOverview = async (req: AdminRequest, res: Response) => {
    try {
      const data = await this.service.getOverview(extractBearerToken(req));
      res.json({ success: true, data });
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getUsers = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getUsers(extractBearerToken(req), query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getSessions = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getSessions(extractBearerToken(req), query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  revokeSession = async (req: AdminRequest, res: Response) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const result = await this.service.revokeSession(extractBearerToken(req), id);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  setSuspension = async (req: AdminRequest, res: Response) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      if (req.userId === id) {
        return res.status(400).json({
          success: false,
          message: 'Administrators cannot suspend their own account',
        });
      }
      const suspended = req.query.suspended === 'true';
      const input = userSuspensionSchema.parse(req.body);
      const result = await this.service.setSuspension(extractBearerToken(req), id, suspended, input);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getDrivers = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getDrivers(extractBearerToken(req), query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  verifyDriver = async (req: AdminRequest, res: Response) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const input = driverVerificationSchema.parse(req.body);
      const result = await this.service.verifyDriver(extractBearerToken(req), id, input);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getRides = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getRides(extractBearerToken(req), query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getPayments = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getPayments(extractBearerToken(req), query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getSystemHealth = async (_req: AdminRequest, res: Response) => {
    try {
      const data = await this.service.getSystemHealth();
      res.json({ success: true, data });
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getAnalytics = async (req: AdminRequest, res: Response) => {
    try {
      const query = analyticsQuerySchema.parse(req.query);
      const data = await this.service.getAnalytics(extractBearerToken(req), query.period);
      res.json({ success: true, data });
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getSettings = async (_req: AdminRequest, res: Response) => {
    try {
      const data = this.service.getSettings();
      res.json({ success: true, data });
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  updateSettings = async (req: AdminRequest, res: Response) => {
    try {
      const input = systemSettingsSchema.parse(req.body);
      const data = await this.service.updateSettings(extractBearerToken(req), input, req.userId);
      res.json({ success: true, data });
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getFleetRadar = async (req: AdminRequest, res: Response) => {
    try {
      const data = await this.service.getFleetRadar(extractBearerToken(req));
      res.json({ success: true, data });
    } catch (error) {
      handleControllerError(error, res);
    }
  };
}
