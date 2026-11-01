import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { authMiddleware, requireRole, type AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { UserService } from '../services/user.service.js';
import { SessionRepository } from '../repositories/session.repository.js';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  role: z.enum(['RIDER', 'DRIVER', 'ADMIN']).optional(),
});

const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) });

export function createAdminRouter(userService: UserService, sessionRepository: SessionRepository): Router {
  const router = Router();
  router.use(authMiddleware, requireRole('ADMIN'));

  router.get('/users', async (req, res, next) => {
    try {
      const query = pageQuery.parse(req.query);
      const result = await userService.listUsers(query);
      res.json({ success: true, data: result.items, pagination: { page: query.page, limit: query.limit, total: result.total } });
    } catch (error) { next(error); }
  });

  router.get('/sessions', async (req, res, next) => {
    try {
      const query = pageQuery.pick({ page: true, limit: true }).extend({ userId: z.string().uuid().optional() }).parse(req.query);
      const result = await sessionRepository.list(query);
      res.json({ success: true, data: result.items, pagination: { page: query.page, limit: query.limit, total: result.total } });
    } catch (error) { next(error); }
  });

  router.get('/audit', async (req, res, next) => {
    try {
      const query = pageQuery.pick({ page: true, limit: true }).parse(req.query);
      const [items, total] = await prisma.$transaction([
        prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
        prisma.adminAuditLog.count(),
      ]);
      res.json({ success: true, data: items, pagination: { page: query.page, limit: query.limit, total } });
    } catch (error) { next(error); }
  });

  router.post('/audit', async (req, res, next) => {
    try {
      const internalKey = req.headers['x-internal-service-key'];
      const expectedKey = process.env.INTERNAL_SERVICE_KEY || 'urbanfleet-internal-service-secret';
      if (internalKey !== expectedKey) {
        return res.status(403).json({
          success: false,
          message: 'Direct audit log creation is restricted to internal cluster services',
        });
      }
      const schema = z.object({
        action: z.string().min(2).max(100),
        resource: z.string().min(2).max(100),
        resourceId: z.string().optional(),
        reason: z.string().max(500).optional(),
      });
      const parsed = schema.parse(req.body);
      const callerId = (req as unknown as AuthenticatedRequest).userId || 'system';
      const entry = await prisma.adminAuditLog.create({
        data: {
          adminUserId: callerId,
          action: parsed.action,
          resource: parsed.resource,
          resourceId: parsed.resourceId,
          reason: parsed.reason,
          ipAddress: req.ip,
        },
      });
      res.status(201).json({ success: true, data: entry });
    } catch (error) { next(error); }
  });

  router.patch('/users/:id/suspension', async (req, res, next) => {
    try {
      const callerId = (req as unknown as AuthenticatedRequest).userId;
      if (callerId === req.params.id) {
        return res.status(400).json({
          success: false,
          message: 'Administrators cannot suspend their own account',
        });
      }

      const idParam = z.string().uuid().safeParse(req.params.id);
      if (!idParam.success) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID format: must be a valid UUID',
        });
      }

      const body = reasonBody.parse(req.body);
      const suspended = req.query.suspended === 'true';
      const user = await userService.setSuspension(req.params.id, suspended, body.reason);
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: callerId,
          action: suspended ? 'USER_SUSPENDED' : 'USER_RESTORED',
          resource: 'USER',
          resourceId: user.id,
          reason: body.reason,
          ipAddress: req.ip,
        },
      });
      res.json({ success: true, data: user });
    } catch (error) { next(error); }
  });

  router.delete('/sessions/:id', async (req, res, next) => {
    try {
      const idParam = z.string().uuid().safeParse(req.params.id);
      if (!idParam.success) {
        return res.status(400).json({
          success: false,
          message: 'Invalid session ID format: must be a valid UUID',
        });
      }
      const session = await sessionRepository.findById(req.params.id);
      if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
      await sessionRepository.delete(req.params.id);
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: (req as unknown as AuthenticatedRequest).userId,
          action: 'SESSION_REVOKED',
          resource: 'SESSION',
          resourceId: session.id,
          reason: 'Revoked by administrator',
          ipAddress: req.ip,
        },
      });
      res.json({ success: true });
    } catch (error) { next(error); }
  });

  return router;
}
