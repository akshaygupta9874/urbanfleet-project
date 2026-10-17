import { Request, Response } from 'express';
import { AuthenticatedRequest, AppError } from '@urbanfleet/common';
import { DriverService } from '../services/driver.service.js';
import { DocumentService } from '../services/document.service.js';
import {
  CloudinaryService,
  cloudinaryService as defaultCloudinaryService,
  CloudinaryFolders,
} from '../services/cloudinary.service.js';
import { driverRegistrationSchema } from '../validation/driver.validation.js';
import asyncHandler from '../middlewares/asyncHandler.js';

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
  private getAuthenticatedUserId(req: AuthenticatedRequest): string {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    }
    return userId;
  }

  constructor(
    private driverService: DriverService,
    private documentService: DocumentService,
    private cloudinaryService: CloudinaryService = defaultCloudinaryService
  ) {}

  registerDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const files = (req.files as DriverUploadFiles) || {};
    const userId = req.userId || req.user?.userId || req.user?.id || req.body?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Driver registration requires authenticated user ID',
      });
    }

    // Case 1: Simple JSON body registration (backward compatible with tests/simple API)
    if (!req.files || Object.keys(files).length === 0) {
      if (req.body?.licenseNumber) {
        const profile = await this.driverService.createDriverProfile(
          userId,
          req.body.licenseNumber
        );
        return res.status(201).json({ success: true, data: profile });
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
      throw err;
    }
  });

  uploadImage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    const folder = req.body?.folder || CloudinaryFolders.DRIVER_PROFILE;
    const result = await this.cloudinaryService.uploadImage(req.file, folder);
    return res.status(200).json({ success: true, data: result });
  });

  deleteImage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { publicId } = req.body;
    if (!publicId) {
      return res.status(400).json({ success: false, message: 'publicId is required' });
    }
    await this.cloudinaryService.deleteImage(publicId);
    return res.status(200).json({ success: true, message: 'Image deleted successfully' });
  });

  getDriverProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const profile = await this.driverService.getDriverByUserId(userId);
    res.status(200).json({ success: true, data: profile });
  });

  updateDriverProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const profile = await this.driverService.updateProfile(userId, req.body);
    res.status(200).json({ success: true, data: profile });
  });

  updateVehicle = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const vehicle = await this.driverService.updateVehicleInfo(userId, req.body);
    res.status(200).json({ success: true, data: vehicle });
  });

  uploadDocument = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const profile = await this.driverService.getDriverByUserId(userId);
    const { type, documentUrl, fileUrl, number, documentNumber, expiresAt, frontImage, backImage } = req.body;
    const doc = await this.documentService.uploadDocument({
      driverProfileId: profile.id,
      type,
      documentUrl: documentUrl || fileUrl || frontImage,
      number: number || documentNumber,
      frontImage: frontImage || documentUrl || fileUrl,
      backImage,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });
    res.status(201).json({ success: true, data: doc });
  });

  getDriverDocuments = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const profile = await this.driverService.getDriverByUserId(userId);
    const docs = await this.documentService.getDocumentsByDriverId(profile.id);
    res.status(200).json({ success: true, data: docs });
  });

  getDocumentSummary = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const profile = await this.driverService.getDriverByUserId(userId);
    const summary = await this.documentService.getDocumentSummary(profile.id);
    res.status(200).json({ success: true, data: summary });
  });

  verifyDocument = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const role = req.role || req.user?.role || req.user?.roles;
    const isVerifier = Array.isArray(role)
      ? role.includes('ADMIN') || role.includes('VERIFIER')
      : role === 'ADMIN' || role === 'VERIFIER';
    const isInternal = req.headers['x-internal-service-key'] === (process.env.INTERNAL_SERVICE_KEY || 'urbanfleet_internal_secret');

    if (!isVerifier && !isInternal) {
      throw new AppError('Forbidden: Only administrators or verifiers can verify documents', 403, 'FORBIDDEN');
    }

    const { status, rejectionReason } = req.body;
    const doc = await this.documentService.verifyDocument(req.params.id, status, rejectionReason);
    res.status(200).json({ success: true, data: doc });
  });

  checkDocumentExpiry = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isExpired = await this.documentService.checkDocumentExpiry(req.params.id);
    res.status(200).json({ success: true, data: { isExpired } });
  });


  toggleAvailability = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isAvailable =
      req.body?.isAvailable !== undefined
        ? req.body.isAvailable
        : req.body?.isOnline !== undefined
        ? req.body.isOnline
        : true;
    const userId = this.getAuthenticatedUserId(req);
    const profile = await this.driverService.setAvailability(userId, Boolean(isAvailable));
    res.status(200).json({ success: true, data: profile });
  });

  getEarnings = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const earnings = await this.driverService.calculateEarnings(userId);
    res.status(200).json({ success: true, data: earnings });
  });

  getDriverById = asyncHandler(async (req: Request, res: Response) => {
    const profile = await this.driverService.getDriverById(req.params.id);
    const authReq = req as AuthenticatedRequest;
    const callerId = authReq.userId || authReq.user?.userId || authReq.user?.id;
    const callerRole = authReq.role || authReq.user?.role || authReq.user?.roles;
    const isInternal = req.headers['x-internal-service-key'] === (process.env.INTERNAL_SERVICE_KEY || 'urbanfleet_internal_secret');
    const isPrivileged = isInternal || callerRole === 'ADMIN' || (callerId && profile.userId === callerId);

    const data = isPrivileged ? profile : this.driverService.sanitizePublicProfile(profile);
    res.status(200).json({ success: true, data });
  });

  getDriverByUserId = asyncHandler(async (req: Request, res: Response) => {
    const profile = await this.driverService.getDriverByUserId(req.params.userId);
    const authReq = req as AuthenticatedRequest;
    const callerId = authReq.userId || authReq.user?.userId || authReq.user?.id;
    const callerRole = authReq.role || authReq.user?.role || authReq.user?.roles;
    const isInternal = req.headers['x-internal-service-key'] === (process.env.INTERNAL_SERVICE_KEY || 'urbanfleet_internal_secret');
    const isPrivileged = isInternal || callerRole === 'ADMIN' || (callerId && profile.userId === callerId);

    const data = isPrivileged ? profile : this.driverService.sanitizePublicProfile(profile);
    res.status(200).json({ success: true, data });
  });
}
export default DriverController;
