import { Request, Response, NextFunction } from 'express';
import { DriverService } from '../services/driver.service.js';
import { DocumentService } from '../services/document.service.js';
import {
  CloudinaryService,
  cloudinaryService as defaultCloudinaryService,
  CloudinaryFolders,
} from '../services/cloudinary.service.js';
import { driverRegistrationSchema } from '../validation/driver.validation.js';

// Domain Policy Constant preserved from original backend
export const DOCUMENT_EXPIRY_DAYS = 365;

export interface DriverUploadFiles {
  profilePhoto?: Express.Multer.File[];
  vehicleFront?: Express.Multer.File[];
  vehicleBack?: Express.Multer.File[];
  vehicleLeft?: Express.Multer.File[];
  vehicleRight?: Express.Multer.File[];
  vehicleInterior?: Express.Multer.File[];
  licenseFront?: Express.Multer.File[];
  licenseBack?: Express.Multer.File[];
  insurance?: Express.Multer.File[];
  registrationCertificate?: Express.Multer.File[];
  pollutionCertificate?: Express.Multer.File[];
}

export class DriverController {
  constructor(
    private driverService: DriverService,
    private documentService: DocumentService,
    private cloudinaryService: CloudinaryService = defaultCloudinaryService
  ) {}

  registerDriver = async (req: any, res: Response, next: NextFunction) => {
    const files = (req.files as DriverUploadFiles) || {};
    const userId = req.user?.userId || req.body?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Driver registration requires authenticated user ID',
      });
    }

    // Case 1: Simple JSON body registration (backward compatible with tests/simple API)
    if (!req.files || Object.keys(files).length === 0) {
      if (req.body?.licenseNumber) {
        try {
          const profile = await this.driverService.createDriverProfile(
            userId,
            req.body.licenseNumber
          );
          return res.status(201).json({ success: true, data: profile });
        } catch (err) {
          return next(err);
        }
      }
    }

    // Case 2: Full multipart form driver registration with Cloudinary
    let vehicleData = req.body?.vehicle;
    let documentsData = req.body?.documents;

    if (typeof vehicleData === 'string') {
      try {
        vehicleData = JSON.parse(vehicleData);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid vehicle JSON in form data' });
      }
    }

    if (typeof documentsData === 'string') {
      try {
        documentsData = JSON.parse(documentsData);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid documents JSON in form data' });
      }
    }

    const validationResult = driverRegistrationSchema.safeParse({
      userId,
      vehicle: vehicleData,
      documents: documentsData,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input data',
        errors: validationResult.error.issues,
      });
    }

    const { vehicle, documents } = validationResult.data;

    const profilePhoto = files.profilePhoto?.[0];
    const vehicleFront = files.vehicleFront?.[0];
    const vehicleBack = files.vehicleBack?.[0];
    const vehicleLeft = files.vehicleLeft?.[0];
    const vehicleRight = files.vehicleRight?.[0];
    const vehicleInterior = files.vehicleInterior?.[0];
    const licenseFront = files.licenseFront?.[0];
    const licenseBack = files.licenseBack?.[0];
    const registrationCertificate = files.registrationCertificate?.[0];
    const insurance = files.insurance?.[0];
    const pollutionCertificate = files.pollutionCertificate?.[0];

    if (
      !profilePhoto ||
      !vehicleFront ||
      !vehicleBack ||
      !vehicleLeft ||
      !vehicleRight ||
      !vehicleInterior ||
      !licenseFront ||
      !licenseBack ||
      !registrationCertificate ||
      !insurance ||
      !pollutionCertificate
    ) {
      return res.status(400).json({
        success: false,
        message: 'Please upload all required driver documents and vehicle images.',
      });
    }

    const uploadedPublicIds: string[] = [];

    const rollbackUploads = async () => {
      if (uploadedPublicIds.length === 0) return;
      try {
        await this.cloudinaryService.deleteImages(uploadedPublicIds);
      } catch (error) {
        console.error('Failed to rollback uploaded images', error);
      }
    };

    try {
      const [
        uploadedProfilePhoto,
        uploadedVehicleFront,
        uploadedVehicleBack,
        uploadedVehicleLeft,
        uploadedVehicleRight,
        uploadedVehicleInterior,
        uploadedLicenseFront,
        uploadedLicenseBack,
        uploadedRegistrationCertificate,
        uploadedInsurance,
        uploadedPollutionCertificate,
      ] = await Promise.all([
        this.cloudinaryService.uploadImage(profilePhoto, CloudinaryFolders.DRIVER_PROFILE),
        this.cloudinaryService.uploadImage(vehicleFront, CloudinaryFolders.DRIVER_VEHICLE),
        this.cloudinaryService.uploadImage(vehicleBack, CloudinaryFolders.DRIVER_VEHICLE),
        this.cloudinaryService.uploadImage(vehicleLeft, CloudinaryFolders.DRIVER_VEHICLE),
        this.cloudinaryService.uploadImage(vehicleRight, CloudinaryFolders.DRIVER_VEHICLE),
        this.cloudinaryService.uploadImage(vehicleInterior, CloudinaryFolders.DRIVER_VEHICLE),
        this.cloudinaryService.uploadImage(licenseFront, CloudinaryFolders.DRIVER_LICENSE),
        this.cloudinaryService.uploadImage(licenseBack, CloudinaryFolders.DRIVER_LICENSE),
        this.cloudinaryService.uploadImage(registrationCertificate, CloudinaryFolders.DRIVER_RC),
        this.cloudinaryService.uploadImage(insurance, CloudinaryFolders.DRIVER_INSURANCE),
        this.cloudinaryService.uploadImage(pollutionCertificate, CloudinaryFolders.DRIVER_PUC),
      ]);

      uploadedPublicIds.push(
        uploadedProfilePhoto.publicId,
        uploadedVehicleFront.publicId,
        uploadedVehicleBack.publicId,
        uploadedVehicleLeft.publicId,
        uploadedVehicleRight.publicId,
        uploadedVehicleInterior.publicId,
        uploadedLicenseFront.publicId,
        uploadedLicenseBack.publicId,
        uploadedRegistrationCertificate.publicId,
        uploadedInsurance.publicId,
        uploadedPollutionCertificate.publicId
      );

      const profile = await this.driverService.registerFullDriver({
        userId,
        licenseNumber: documents.drivingLicense.number,
        profilePhoto: {
          url: uploadedProfilePhoto.url,
          publicId: uploadedProfilePhoto.publicId,
        },
        vehicle: {
          type: vehicle.type,
          brand: vehicle.brand,
          model: vehicle.model,
          color: vehicle.color,
          registrationNumber: vehicle.registrationNumber,
          registrationYear: vehicle.registrationYear,
          images: {
            front: uploadedVehicleFront.url,
            back: uploadedVehicleBack.url,
            left: uploadedVehicleLeft.url,
            right: uploadedVehicleRight.url,
            interior: uploadedVehicleInterior.url,
          },
        },
        documents: [
          {
            type: 'DRIVING_LICENSE',
            number: documents.drivingLicense.number,
            expiryDate: documents.drivingLicense.expiryDate,
            frontImage: uploadedLicenseFront.url,
            backImage: uploadedLicenseBack.url,
          },
          {
            type: 'REGISTRATION_CERTIFICATE',
            number: documents.registrationCertificate.number,
            frontImage: uploadedRegistrationCertificate.url,
          },
          {
            type: 'INSURANCE',
            number: documents.insurance.number,
            expiryDate: documents.insurance.expiryDate,
            frontImage: uploadedInsurance.url,
          },
          {
            type: 'POLLUTION',
            number: 'PUC',
            expiryDate: documents.pollutionCertificate.expiryDate,
            frontImage: uploadedPollutionCertificate.url,
          },
        ],
      });

      return res.status(201).json({
        success: true,
        message: 'Driver profile created successfully. Awaiting verification.',
        data: {
          id: profile.id,
          _id: profile.id,
          verificationStatus: profile.verificationStatus,
        },
      });
    } catch (err) {
      await rollbackUploads();
      return next(err);
    }
  };

  uploadImage = async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file provided' });
      }
      const folder = req.body?.folder || CloudinaryFolders.DRIVER_PROFILE;
      const result = await this.cloudinaryService.uploadImage(req.file, folder);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  };

  deleteImage = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { publicId } = req.body;
      if (!publicId) {
        return res.status(400).json({ success: false, message: 'publicId is required' });
      }
      await this.cloudinaryService.deleteImage(publicId);
      return res.status(200).json({ success: true, message: 'Image deleted successfully' });
    } catch (err) {
      return next(err);
    }
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
      const isAvailable =
        req.body?.isAvailable !== undefined
          ? req.body.isAvailable
          : req.body?.isOnline !== undefined
          ? req.body.isOnline
          : true;
      const profile = await this.driverService.setAvailability(req.user.userId, Boolean(isAvailable));
      res.status(200).json({ success: true, data: profile });
    } catch (err) { next(err); }
  };

  getEarnings = async (req: any, res: Response, next: NextFunction) => {
    try {
      const earnings = await this.driverService.calculateEarnings(req.user.userId);
      res.status(200).json({ success: true, data: earnings });
    } catch (err) { next(err); }
  };

  getDriverById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await this.driverService.getDriverById(req.params.id);
      res.status(200).json({ success: true, data: profile });
    } catch (err) { next(err); }
  };

  getDriverByUserId = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await this.driverService.getDriverByUserId(req.params.userId);
      res.status(200).json({ success: true, data: profile });
    } catch (err) { next(err); }
  };
}
export default DriverController;
