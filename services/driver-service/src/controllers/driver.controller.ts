import { Request, Response, NextFunction } from 'express';
import { DriverService } from '../services/driver.service.js';
import { DocumentService } from '../services/document.service.js';

// Domain Policy Constant preserved from original backend
export const DOCUMENT_EXPIRY_DAYS = 365;

export class DriverController {
  constructor(
    private driverService: DriverService,
    private documentService: DocumentService
  ) {}

  registerDriver = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { licenseNumber } = req.body;
      const profile = await this.driverService.createDriverProfile(req.user.userId, licenseNumber);
      res.status(201).json({ success: true, data: profile });
    } catch (err) { next(err); }
  };

  getDriverProfile = async (req: any, res: Response, next: NextFunction) => {
    try {
      const profile = await this.driverService.getDriverByUserId(req.user.userId);
      res.status(200).json({ success: true, data: profile });
    } catch (err) { next(err); }
  };

  updateDriverProfile = async (req: any, res: Response, next: NextFunction) => {
    try {
      const profile = await this.driverService.updateProfile(req.user.userId, req.body);
      res.status(200).json({ success: true, data: profile });
    } catch (err) { next(err); }
  };

  updateVehicle = async (req: any, res: Response, next: NextFunction) => {
    try {
      const vehicle = await this.driverService.updateVehicleInfo(req.user.userId, req.body);
      res.status(200).json({ success: true, data: vehicle });
    } catch (err) { next(err); }
  };

  uploadDocument = async (req: any, res: Response, next: NextFunction) => {
    try {
      const profile = await this.driverService.getDriverByUserId(req.user.userId);
      const { type, documentUrl, expiresAt } = req.body;
      const doc = await this.documentService.uploadDocument(
        profile.id,
        type,
        documentUrl,
        expiresAt ? new Date(expiresAt) : undefined
      );
      res.status(201).json({ success: true, data: doc });
    } catch (err) { next(err); }
  };

  toggleAvailability = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { isAvailable } = req.body;
      const profile = await this.driverService.setAvailability(req.user.userId, isAvailable);
      res.status(200).json({ success: true, data: profile });
    } catch (err) { next(err); }
  };

  getEarnings = async (req: any, res: Response, next: NextFunction) => {
    try {
      const earnings = await this.driverService.calculateEarnings(req.user.userId);
      res.status(200).json({ success: true, data: earnings });
    } catch (err) { next(err); }
  };
}
