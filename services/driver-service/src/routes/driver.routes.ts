import { Router } from 'express';
import { DriverController } from '../controllers/driver.controller.js';
import { validateRequest } from '@urbanfleet/common';
import {
  createProfileSchema,
  updateStatusSchema,
  uploadDocumentSchema,
} from '../validation/driver.validation.js';
import { uploadDriverDocuments, uploadSingleImage } from '../middlewares/driver-upload.middleware.js';

export function createDriverRouter(controller: DriverController): Router {
  const router = Router();

  // Driver Registration (supports both multipart form with Cloudinary image uploads and direct JSON)
  router.post('/register', uploadDriverDocuments, controller.registerDriver);

  // Standalone Cloudinary Media Upload & Management
  router.post('/upload', uploadSingleImage('image'), controller.uploadImage);
  router.post('/documents/upload', uploadSingleImage('document'), controller.uploadImage);
  router.delete('/images', controller.deleteImage);

  // Profile & Vehicle Management
  router.get('/profile', controller.getDriverProfile);
  router.put('/profile', validateRequest({ body: createProfileSchema }), controller.updateDriverProfile);
  router.put('/vehicle', controller.updateVehicle);
  router.post('/documents', validateRequest({ body: uploadDocumentSchema }), controller.uploadDocument);
  router.post('/availability', validateRequest({ body: updateStatusSchema }), controller.toggleAvailability);
  router.get('/earnings', controller.getEarnings);
  router.get('/by-user/:userId', controller.getDriverByUserId);
  router.get('/:id', controller.getDriverById);

  return router;
}

export default createDriverRouter;
