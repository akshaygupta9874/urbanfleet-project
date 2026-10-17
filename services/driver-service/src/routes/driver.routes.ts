import { Router } from 'express';
import { DriverController } from '../controllers/driver.controller.js';
import { validateRequest } from '@urbanfleet/common';
import {
  createProfileSchema,
  updateProfileSchema,
  updateStatusSchema,
  uploadDocumentSchema,
} from '../validation/driver.validation.js';
import { uploadDriverDocuments, uploadSingleImage } from '../middlewares/driver-upload.middleware.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

export function createDriverRouter(controller: DriverController): Router {
  const router = Router();

  // Driver Registration (supports both multipart form with Cloudinary image uploads and direct JSON)
  router.post('/register', uploadDriverDocuments, authMiddleware, controller.registerDriver);

  // Standalone Cloudinary Media Upload & Management
  router.post('/upload', authMiddleware, uploadSingleImage('image'), controller.uploadImage);
  router.post('/documents/upload', authMiddleware, uploadSingleImage('document'), controller.uploadImage);
  router.delete('/images', authMiddleware, controller.deleteImage);

  // Profile & Vehicle Management
  router.get('/profile', authMiddleware, controller.getDriverProfile);
  router.put('/profile', authMiddleware, validateRequest({ body: updateProfileSchema }), controller.updateDriverProfile);
  router.put('/vehicle', authMiddleware, controller.updateVehicle);
  router.post('/documents', authMiddleware, validateRequest({ body: uploadDocumentSchema }), controller.uploadDocument);
  router.get('/documents', authMiddleware, controller.getDriverDocuments);
  router.get('/documents/summary', authMiddleware, controller.getDocumentSummary);
  router.patch('/documents/:id/verify', authMiddleware, controller.verifyDocument);
  router.post('/documents/:id/check-expiry', authMiddleware, controller.checkDocumentExpiry);
  router.post('/availability', authMiddleware, validateRequest({ body: updateStatusSchema }), controller.toggleAvailability);
  router.get('/earnings', authMiddleware, controller.getEarnings);
  router.get('/by-user/:userId', controller.getDriverByUserId);
  router.get('/:id', controller.getDriverById);

  return router;
}

export default createDriverRouter;

