import { Router } from 'express';
import { DriverController } from '../controllers/driver.controller.js';
import { validateRequest } from '@urbanfleet/common';
import {
  createProfileSchema,
  updateStatusSchema,
  uploadDocumentSchema,
} from '../validation/driver.validation.js';

export function createDriverRouter(controller: DriverController): Router {
  const router = Router();

  router.post('/register', validateRequest({ body: createProfileSchema }), controller.registerDriver);
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
