import { Request, Response } from 'express';
import { AuthenticatedRequest, AppError, createLogger } from '@urbanfleet/common';

const logger = createLogger('driver-controller');
import { DriverService } from '../services/driver.service.js';
import { DocumentService } from '../services/document.service.js';
import {
  CloudinaryService,
  cloudinaryService as defaultCloudinaryService,
  CloudinaryFolders,
} from '../services/cloudinary.service.js';
import { driverRegistrationSchema } from '../validation/driver.validation.js';
import asyncHandler from '../middlewares/asyncHandler.js';
import { authClient, AuthClient } from '../clients/auth.client.js';

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

export interface RawDriverProfile {
  id?: string;
  userId?: string;
  licenseNumber?: string;
  rating?: number | { average?: number; totalRatings?: number } | unknown;
  totalTrips?: number;
  totalEarningsPaise?: number | bigint;
  statistics?: {
    totalTrips?: number;
    completedTrips?: number;
    cancelledTrips?: number;
    totalEarnings?: number;
    totalDistance?: number;
  };
  vehicles?: Array<{
    type?: string;
    brand?: string;
    model?: string;
    color?: string;
    registrationNumber?: string;
    registrationYear?: number;
    category?: string;
    make?: string;
    year?: number;
    plateNumber?: string;
  }>;
  vehicle?: {
    type?: string;
    brand?: string;
    model?: string;
    color?: string;
    registrationNumber?: string;
    registrationYear?: number;
  };
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  firstName?: string;
  lastName?: string;
  email?: string;
  profilePhoto?: unknown;
  vehicleImages?: Record<string, string>;
  documents?: unknown[];
  verificationStatus?: string;
  isVerified?: boolean;
  [key: string]: unknown;
}

export function formatDriverProfileForFrontend(profile: RawDriverProfile | null | undefined) {
  if (!profile) return null;
  const vehicle = profile.vehicles?.[0] || profile.vehicle || {
    type: 'CAR',
    brand: 'Toyota',
    model: 'Etios',
    color: 'White',
    registrationNumber: profile.licenseNumber || 'KA-01-UF-1001',
    registrationYear: 2022,
  };

  const ratingObj = typeof profile.rating === 'object' && profile.rating !== null ? (profile.rating as { average?: number; totalRatings?: number }) : null;
  const ratingAvg = Number(ratingObj?.average ?? profile.rating ?? 5.0);
  const totalTrips = Number(profile.statistics?.totalTrips ?? profile.totalTrips ?? 0);
  const completedTrips = Number(profile.statistics?.completedTrips ?? totalTrips);
  const totalEarningsPaise = Number(profile.statistics?.totalEarnings ?? profile.totalEarningsPaise ?? 0);
  const totalEarnings = totalEarningsPaise;
  const totalDistance = Number(profile.statistics?.totalDistance ?? 0);

  return {
    ...profile,
    id: profile.id,
    totalEarningsPaise,
    user: profile.user || {
      id: profile.userId,
      firstName: profile.firstName || 'UrbanFleet',
      lastName: profile.lastName || 'Driver',
      email: profile.email || '',
    },
    profilePhoto: typeof profile.profilePhoto === 'string'
      ? { url: profile.profilePhoto, publicId: '' }
      : (profile.profilePhoto || { url: '', publicId: '' }),
    vehicleImages: profile.vehicleImages || {
      front: '',
      back: '',
      left: '',
      right: '',
      interior: '',
    },
    vehicle: {
      type: vehicle.type || 'CAR',
      brand: vehicle.brand || 'Toyota',
      model: vehicle.model || 'Etios',
      color: vehicle.color || 'White',
      registrationNumber: vehicle.registrationNumber || profile.licenseNumber || 'KA-01-UF-1001',
      registrationYear: vehicle.registrationYear || 2022,
    },
    documents: profile.documents || {},
    verificationStatus: profile.verificationStatus || 'PENDING',
    isVerified:
      Boolean(profile.isVerified) &&
      (profile.verificationStatus === 'APPROVED' || profile.verificationStatus === 'VERIFIED'),
    rating: {
      average: ratingAvg,
      totalRatings: Number(ratingObj?.totalRatings ?? 10),
    },
    statistics: {
      totalTrips,
      completedTrips,
      cancelledTrips: Number(profile.statistics?.cancelledTrips ?? 0),
      totalDistance,
      totalEarnings,
    },
  };
}

export class DriverController {
  private driverService: DriverService;
  private documentService: DocumentService;
  private cloudinaryService: CloudinaryService;
  private authServiceClient: AuthClient;

  private getAuthenticatedUserId(req: AuthenticatedRequest): string {
    const userId = req.userId;
    if (!userId) {
      throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    }
    return userId;
  }

  constructor(
    driverService: DriverService,
    documentService: DocumentService,
    cloudinaryService: CloudinaryService = defaultCloudinaryService,
    authServiceClient: AuthClient = authClient
  ) {
    this.driverService = driverService;
    this.documentService = documentService;
    this.cloudinaryService = cloudinaryService;
    this.authServiceClient = authServiceClient;
  }

  private async grantDriverRoleIfApproved(driverProfileId: string): Promise<void> {
    const profile = await this.driverService.getDriverById(driverProfileId);
    if (
      profile.isVerified &&
      (profile.verificationStatus === 'APPROVED' || profile.verificationStatus === 'VERIFIED')
    ) {
      await this.authServiceClient.grantDriverRole(profile.userId);
    }
  }

  registerDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const files = (req.files as DriverUploadFiles) || {};
    const userId = this.getAuthenticatedUserId(req);

    // Case 1: JSON body registration (supports both simple license and full driver registration)
    if (!req.files || Object.keys(files).length === 0) {
      if (req.body?.licenseNumber) {
        if (req.body?.vehicle) {
          const profile = await this.driverService.registerFullDriver({
            userId,
            licenseNumber: req.body.licenseNumber,
            vehicle: req.body.vehicle,
            documents: req.body.documents || [],
          });
          if (this.documentService?.syncDriverVerificationStatus && profile?.id) {
            await this.documentService.syncDriverVerificationStatus(profile.id);
          }
          const freshProfile = (await this.driverService.getDriverById?.(profile.id)) || profile;
          const formatted = formatDriverProfileForFrontend(freshProfile);
          return res.status(201).json({ success: true, data: formatted, driver: formatted });
        }

        const profile = await this.driverService.createDriverProfile(
          userId,
          req.body.licenseNumber
        );
        const formatted = formatDriverProfileForFrontend(profile);
        return res.status(201).json({ success: true, data: formatted, driver: formatted });
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
      } catch (error: unknown) {
        logger.error('Failed to rollback uploaded images on failure', {
          error: error instanceof Error ? error.message : String(error),
          uploadedPublicIds,
        });
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

      if (this.documentService?.syncDriverVerificationStatus && profile?.id) {
        await this.documentService.syncDriverVerificationStatus(profile.id);
      }

      const freshProfile = (await this.driverService.getDriverById?.(profile.id)) || profile;

      return res.status(201).json({
        success: true,
        message: 'Driver profile created successfully. Awaiting verification.',
        data: {
          id: freshProfile.id,
          verificationStatus: freshProfile.verificationStatus,
          isVerified: freshProfile.isVerified ?? false,
        },
      });
    } catch (err: any) {
      await rollbackUploads();
      if (err?.code === 'ETIMEDOUT' || err?.name === 'AggregateError' || (typeof err?.message === 'string' && err.message.includes('timeout'))) {
        throw new AppError('Image upload service temporarily timed out. Please check network connection and try again.', 504, 'GATEWAY_TIMEOUT');
      }
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
    await this.grantDriverRoleIfApproved(profile.id);
    const formatted = formatDriverProfileForFrontend(profile);
    res.status(200).json({ success: true, data: formatted });
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
    const { type, fileUrl, documentNumber, expiresAt, backImage } = req.body;
    const doc = await this.documentService.uploadDocument({
      driverProfileId: profile.id,
      type,
      documentUrl: fileUrl,
      number: documentNumber,
      frontImage: fileUrl,
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
    const roles: string[] = req.roles ?? req.role ?? [];
    const isVerifier = roles.includes('VERIFIER');

    if (!isVerifier) {
      throw new AppError('Forbidden: Only verifiers can verify documents', 403, 'FORBIDDEN');
    }

    const { status, rejectionReason } = req.body;
    const doc = await this.documentService.verifyDocument(req.params.id, status, rejectionReason);
    if (status === 'VERIFIED' && doc.driverProfileId) {
      await this.grantDriverRoleIfApproved(doc.driverProfileId);
    }
    res.status(200).json({ success: true, data: doc });
  });

  verifyDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const roles: string[] = req.roles ?? req.role ?? [];
    const isVerifier = roles.includes('VERIFIER');

    if (!isVerifier) {
      throw new AppError('Forbidden: Only verifiers can verify drivers', 403, 'FORBIDDEN');
    }

    const paramId = req.params.id;
    let profile = await this.driverService.getDriverById(paramId).catch(() => null);
    if (!profile) {
      profile = await this.driverService.getDriverByUserId(paramId).catch(() => null);
    }

    if (!profile) {
      throw new AppError('Driver profile not found', 404, 'NOT_FOUND');
    }

    const { status = 'VERIFIED' } = req.body;
    const isVerified = status === 'VERIFIED' || status === 'APPROVED';
    const verificationStatus = isVerified ? 'VERIFIED' : 'REJECTED';

    await this.driverService.updateProfile(profile.userId, {
      verificationStatus,
      isVerified,
    } as any);

    if (isVerified) {
      const docs = await this.documentService.getDocumentsByDriverId(profile.id);
      for (const doc of docs) {
        await this.documentService.verifyDocument(doc.id, 'VERIFIED' as any);
      }
      await this.grantDriverRoleIfApproved(profile.id);
    }

    const fresh = await this.driverService.getDriverById(profile.id);
    res.status(200).json({ success: true, data: formatDriverProfileForFrontend(fresh) });
  });

  checkDocumentExpiry = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isExpired = await this.documentService.checkDocumentExpiry(req.params.id);
    res.status(200).json({ success: true, data: { isExpired } });
  });

  toggleAvailability = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isAvailable = req.body?.isAvailable !== undefined ? Boolean(req.body.isAvailable) : true;
    const userId = this.getAuthenticatedUserId(req);
    const profile = await this.driverService.setAvailability(userId, isAvailable);
    res.status(200).json({ success: true, data: profile });
  });

  getEarnings = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const earnings = await this.driverService.calculateEarnings(userId);
    res.status(200).json({ success: true, data: earnings });
  });

  getDriverById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const profile = await this.driverService.getDriverById(req.params.id);
    if (!profile) {
      throw new AppError('Driver not found', 404, 'NOT_FOUND');
    }
    const callerId = req.userId;
    const roles = req.role || [];
    const isPrivileged = Boolean(callerId && profile.userId === callerId);

    const data = isPrivileged ? profile : this.driverService.sanitizePublicProfile(profile);
    res.status(200).json({ success: true, data });
  });

  getDriverByUserId = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const profile = await this.driverService.getDriverByUserId(req.params.userId);
    if (!profile) {
      throw new AppError('Driver not found', 404, 'NOT_FOUND');
    }
    const callerId = req.userId;
    const roles = req.role || [];
    const isPrivileged = Boolean(callerId && profile.userId === callerId);

    const data = isPrivileged ? profile : this.driverService.sanitizePublicProfile(profile);
    res.status(200).json({ success: true, data });
  });
}
export default DriverController;
