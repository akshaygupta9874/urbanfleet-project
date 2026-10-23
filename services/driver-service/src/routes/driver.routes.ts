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
import { uploadDriverDocuments, uploadSingleImage } from '../middlewares/driver-upload.middleware.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

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

  // Driver Registration (supports both multipart form with Cloudinary image uploads and direct JSON)
  router.post('/register', registerLimiter, uploadDriverDocuments, authMiddleware, controller.registerDriver);

  // Standalone Cloudinary Media Upload & Management
  router.post('/upload', authMiddleware, uploadLimiter, uploadSingleImage('image'), controller.uploadImage);
  router.post('/documents/upload', authMiddleware, uploadLimiter, uploadSingleImage('document'), controller.uploadImage);
  router.delete('/images', authMiddleware, controller.deleteImage);

  // Profile & Vehicle Management
  router.get('/profile', authMiddleware, controller.getDriverProfile);
  router.put('/profile', authMiddleware, validateRequest({ body: updateProfileSchema }), controller.updateDriverProfile);
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
