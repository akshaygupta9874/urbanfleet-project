import { Router, Request } from 'express';
import { DriverController } from '../controllers/driver.controller.js';
import { validateRequest, slidingWindowRateLimit } from '@urbanfleet/common';
import { driverRedisClient } from '../redis/client.js';
import {
  updateProfileSchema,
  updateStatusSchema,
  uploadDocumentSchema,
  uuidParamSchema,
} from '../validation/driver.validation.js';
import { uploadDriverDocuments, uploadSingleImage, uploadBankDocuments } from '../middlewares/driver-upload.middleware.js';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js';
import { authClient } from '../clients/auth.client.js';
import { prisma } from '../db/client.js';
import { z } from 'zod';

export function createDriverRouter(controller: DriverController): Router {
  const router = Router();

  // Sliding Window Rate Limiters
  const registerLimiter = slidingWindowRateLimit({
    redis: driverRedisClient,
    limit: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:driver:register',
    keyGenerator: (req: Request) => `${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  const uploadLimiter = slidingWindowRateLimit({
    redis: driverRedisClient,
    limit: 15,
    windowSeconds: 60,
    keyPrefix: 'rl:driver:upload',
    keyGenerator: (req: Request) => `${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  const documentLimiter = slidingWindowRateLimit({
    redis: driverRedisClient,
    limit: 20,
    windowSeconds: 60,
    keyPrefix: 'rl:driver:doc',
    keyGenerator: (req: Request) => `${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  // Public Health Check Endpoint
  router.get('/health', (_req, res) => res.status(200).json({ status: 'UP', service: 'driver-service' }));

  // Admin metrics aggregation for platform analytics
  router.get('/admin/metrics', authMiddleware, requireRole('ADMIN'), async (_req, res, next) => {
    try {
      const counts = await prisma.driverProfile.groupBy({
        by: ['verificationStatus'],
        _count: true,
      });
      const summary = {
        approved: 0,
        pending: 0,
        rejected: 0,
        underReview: 0,
        suspended: 0,
        total: 0,
      };
      for (const item of counts) {
        summary.total += item._count;
        const st = item.verificationStatus as string;
        if (st === 'APPROVED' || st === 'VERIFIED') summary.approved += item._count;
        else if (st === 'PENDING') summary.pending += item._count;
        else if (st === 'REJECTED') summary.rejected += item._count;
        else if (st === 'SUSPENDED') summary.suspended += item._count;
        else summary.underReview += item._count;
      }
      res.json({ success: true, data: summary });
    } catch (error) { next(error); }
  });

  router.get('/admin/list', authMiddleware, requireRole('ADMIN'), async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
      const where = {
        ...(status ? { verificationStatus: status as never } : {}),
        ...(search ? {
          OR: [
            { licenseNumber: { contains: search, mode: 'insensitive' as const } },
            { userId: { contains: search, mode: 'insensitive' as const } },
            { id: { contains: search, mode: 'insensitive' as const } },
            { vehicles: { some: { plateNumber: { contains: search, mode: 'insensitive' as const } } } },
          ],
        } : {}),
      };
      const [items, total] = await prisma.$transaction([
        prisma.driverProfile.findMany({
          where,
          include: {
            vehicles: true,
            documents: { select: { id: true, type: true, status: true, expiresAt: true, documentUrl: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.driverProfile.count({ where }),
      ]);
      res.json({ success: true, data: items, pagination: { page, limit, total } });
    } catch (error) { next(error); }
  });

  router.patch('/admin/:id/verification', authMiddleware, requireRole('ADMIN'), async (req, res, next) => {
    try {
      const idParam = z.string().uuid().safeParse(req.params.id);
      if (!idParam.success) {
        return res.status(400).json({ success: false, message: 'Invalid driver ID format: must be a valid UUID' });
      }

      const body = z.object({
        status: z.enum(['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'APPROVED', 'SUSPENDED']),
        reason: z.string().trim().min(3).max(500),
      }).parse(req.body);

      const existing = await prisma.driverProfile.findUnique({
        where: { id: req.params.id },
        include: { documents: true },
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Driver profile not found' });
      }

      const ALLOWED_TRANSITIONS: Record<string, string[]> = {
        PENDING: ['UNDER_REVIEW', 'APPROVED', 'VERIFIED', 'REJECTED'],
        UNDER_REVIEW: ['APPROVED', 'VERIFIED', 'REJECTED', 'PENDING'],
        VERIFIED: ['APPROVED', 'SUSPENDED', 'UNDER_REVIEW'],
        APPROVED: ['SUSPENDED', 'UNDER_REVIEW'],
        SUSPENDED: ['APPROVED', 'VERIFIED', 'UNDER_REVIEW', 'REJECTED'],
        REJECTED: ['UNDER_REVIEW', 'PENDING'],
      };

      const currentStatus = existing.verificationStatus as string;
      const targetStatus = body.status;
      if (currentStatus !== targetStatus && !ALLOWED_TRANSITIONS[currentStatus]?.includes(targetStatus)) {
        return res.status(400).json({
          success: false,
          message: `Invalid driver status transition from ${currentStatus} to ${targetStatus}`,
        });
      }

      const isApprovedOrVerified = targetStatus === 'APPROVED' || targetStatus === 'VERIFIED';
      const isRejected = targetStatus === 'REJECTED';

      if (isApprovedOrVerified) {
        // Approve associated documents in PENDING state
        await prisma.document.updateMany({
          where: { driverProfileId: existing.id, status: 'PENDING' },
          data: { status: 'VERIFIED', isVerified: true },
        });

        // Grant DRIVER role in auth-service
        try {
          await authClient.grantDriverRole(existing.userId);
        } catch (grantErr) {
          // Log warning if auth-service fails but continue profile update
        }
      } else if (isRejected) {
        // Reject associated documents in PENDING state
        await prisma.document.updateMany({
          where: { driverProfileId: existing.id, status: 'PENDING' },
          data: { status: 'REJECTED', rejectionReason: body.reason, isVerified: false },
        });
      }

      const profile = await prisma.driverProfile.update({
        where: { id: req.params.id },
        data: {
          verificationStatus: body.status,
          isVerified: isApprovedOrVerified,
        },
        include: { vehicles: true, documents: true },
      });

      res.json({ success: true, data: profile, reason: body.reason });
    } catch (error) { next(error); }
  });

  // Driver Registration (supports both multipart form with Cloudinary image uploads and direct JSON)
  router.post('/register', registerLimiter, uploadDriverDocuments, authMiddleware, controller.registerDriver);

  // Standalone Cloudinary Media Upload & Management
  router.post('/upload', authMiddleware, uploadLimiter, uploadSingleImage('image'), controller.uploadImage);
  router.post('/documents/upload', authMiddleware, uploadLimiter, uploadSingleImage('document'), controller.uploadImage);
  router.delete('/images', authMiddleware, controller.deleteImage);

  // Profile & Vehicle Management
  router.get('/profile', authMiddleware, controller.getDriverProfile);
  router.put('/profile', authMiddleware, validateRequest({ body: updateProfileSchema }), controller.updateDriverProfile);
  router.patch('/bank-details', authMiddleware, uploadLimiter, uploadBankDocuments, controller.updateBankDetails);
  router.put('/vehicle', authMiddleware, controller.updateVehicle);
  router.post('/documents', authMiddleware, documentLimiter, validateRequest({ body: uploadDocumentSchema }), controller.uploadDocument);
  router.get('/documents', authMiddleware, controller.getDriverDocuments);
  router.get('/documents/summary', authMiddleware, controller.getDocumentSummary);
  router.patch('/documents/:id/verify', authMiddleware, controller.verifyDocument);
  router.patch('/:id/verify', authMiddleware, controller.verifyDriver);
  router.post('/documents/:id/check-expiry', authMiddleware, controller.checkDocumentExpiry);
  router.post('/availability', authMiddleware, validateRequest({ body: updateStatusSchema }), controller.toggleAvailability);
  router.get('/earnings', authMiddleware, controller.getEarnings);
  router.get('/by-user/:userId', controller.getDriverByUserId);
  router.get('/:id', validateRequest({ params: uuidParamSchema }), controller.getDriverById);

  return router;
}

export default createDriverRouter;
