import { type Response } from 'express';
import axios from 'axios';
import { ZodError } from 'zod';
import { type AdminRequest } from '../middlewares/auth.middleware.js';
import { adminService, AdminService } from '../services/admin.service.js';
import {
  analyticsQuerySchema,
  driverVerificationSchema,
  idParamSchema,
  paginationQuerySchema,
  refundRequestSchema,
  systemSettingsSchema,
  userSuspensionSchema,
} from '../validation/admin.validation.js';

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
  constructor(private readonly service: AdminService = adminService) {}

  getOverview = async (req: AdminRequest, res: Response) => {
    try {
      const data = await this.service.getOverview(req.bearer);
      res.json({ success: true, data });
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getUsers = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getUsers(req.bearer, query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getSessions = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getSessions(req.bearer, query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  revokeSession = async (req: AdminRequest, res: Response) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const result = await this.service.revokeSession(req.bearer, id);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  setSuspension = async (req: AdminRequest, res: Response) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      if (req.adminUserId && req.adminUserId === id) {
        return res.status(400).json({
          success: false,
          message: 'Administrators cannot suspend their own account',
        });
      }
      const suspended = req.query.suspended === 'true';
      const input = userSuspensionSchema.parse(req.body);
      const result = await this.service.setSuspension(req.bearer, id, suspended, input);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getDrivers = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getDrivers(req.bearer, query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  verifyDriver = async (req: AdminRequest, res: Response) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const input = driverVerificationSchema.parse(req.body);
      const result = await this.service.verifyDriver(req.bearer, id, input);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getRides = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getRides(req.bearer, query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getPayments = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getPayments(req.bearer, query);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  refundPayment = async (req: AdminRequest, res: Response) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const input = refundRequestSchema.parse(req.body);
      const idempotencyKey = (req.headers['idempotency-key'] as string) || undefined;
      const result = await this.service.refundPayment(req.bearer, id, input, idempotencyKey);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getAuditLogs = async (req: AdminRequest, res: Response) => {
    try {
      const query = paginationQuerySchema.parse(req.query);
      const result = await this.service.getAuditLogs(req.bearer, query);
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
      const data = await this.service.getAnalytics(req.bearer, query.period);
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
      const data = await this.service.updateSettings(req.bearer, input, req.adminUserId);
      res.json({ success: true, data });
    } catch (error) {
      handleControllerError(error, res);
    }
  };

  getFleetRadar = async (req: AdminRequest, res: Response) => {
    try {
      const data = await this.service.getFleetRadar(req.bearer);
      res.json({ success: true, data });
    } catch (error) {
      handleControllerError(error, res);
    }
  };
}

export const adminController = new AdminController();
