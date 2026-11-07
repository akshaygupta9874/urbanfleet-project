import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { AuthenticatedRequest, AppError, createLogger } from '@urbanfleet/common';

const logger = createLogger('driver-controller');
import { DriverService } from '../services/driver.service.js';
import { DocumentService } from '../services/document.service.js';
import { VerificationStatus } from '../db/client.js';
import {
  CloudinaryService,
  cloudinaryService as defaultCloudinaryService,
  CloudinaryFolders,
} from '../services/cloudinary.service.js';
import { driverRegistrationSchema, updateBankDetailsSchema } from '../validation/driver.validation.js';
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
  aadharFront?: Express.Multer.File[];
  aadharBack?: Express.Multer.File[];
  passbookPhoto?: Express.Multer.File[];
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
  accountHolderName?: string | null;
  accountNumber?: string | null;
  ifscCode?: string | null;
  bankName?: string | null;
  upiId?: string | null;
  passbookPhoto?: unknown;
  [key: string]: unknown;
}

export function formatDriverProfileForFrontend(
  profile: RawDriverProfile | null | undefined,
  extraStats?: {
    totalTrips?: number;
    completedTrips?: number;
    cancelledTrips?: number;
    totalDistance?: number;
    totalEarnings?: number;
  }
) {
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
  const totalTrips = Number(extraStats?.totalTrips ?? profile.statistics?.totalTrips ?? profile.totalTrips ?? 0);
  const completedTrips = Number(extraStats?.completedTrips ?? profile.statistics?.completedTrips ?? totalTrips);
  const totalEarningsPaise = Number(extraStats?.totalEarnings ?? profile.statistics?.totalEarnings ?? profile.totalEarningsPaise ?? 0);
  const totalEarnings = totalEarningsPaise;
  const totalDistance = Number(extraStats?.totalDistance ?? profile.statistics?.totalDistance ?? 0);

  const banking = {
    accountHolderName: String(profile.accountHolderName || ''),
    accountNumber: String(profile.accountNumber || ''),
    ifscCode: String(profile.ifscCode || ''),
    bankName: String(profile.bankName || ''),
    upiId: String(profile.upiId || ''),
    passbookPhoto: (profile.passbookPhoto as { url: string; publicId: string } | null) || null,
  };

  return {
    ...profile,
    id: profile.id,
    totalEarningsPaise,
    accountHolderName: banking.accountHolderName,
    accountNumber: banking.accountNumber,
    ifscCode: banking.ifscCode,
    bankName: banking.bankName,
    upiId: banking.upiId,
    passbookPhoto: banking.passbookPhoto,
    banking,
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
      totalRatings: Number(ratingObj?.totalRatings ?? 0),
    },
    statistics: {
      totalTrips,
      completedTrips,
      cancelledTrips: Number(extraStats?.cancelledTrips ?? profile.statistics?.cancelledTrips ?? 0),
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
    let bankingData = req.body?.banking;

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

    if (typeof bankingData === 'string') {
      try {
        bankingData = JSON.parse(bankingData);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid banking JSON in form data' });
      }
    }

    const validationResult = driverRegistrationSchema.safeParse({
      userId,
      vehicle: vehicleData,
      documents: documentsData,
      banking: bankingData,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input data',
        errors: validationResult.error.issues,
      });
    }

    const { vehicle, documents, banking } = validationResult.data;

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
    const aadharFront = files.aadharFront?.[0];
    const aadharBack = files.aadharBack?.[0];
    const passbookPhoto = files.passbookPhoto?.[0];

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
        uploadedAadharFront,
        uploadedAadharBack,
        uploadedPassbookPhoto,
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
        aadharFront ? this.cloudinaryService.uploadImage(aadharFront, CloudinaryFolders.DRIVER_AADHAAR) : Promise.resolve(null),
        aadharBack ? this.cloudinaryService.uploadImage(aadharBack, CloudinaryFolders.DRIVER_AADHAAR) : Promise.resolve(null),
        passbookPhoto ? this.cloudinaryService.uploadImage(passbookPhoto, CloudinaryFolders.DRIVER_PASSBOOK) : Promise.resolve(null),
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

      if (uploadedAadharFront) uploadedPublicIds.push(uploadedAadharFront.publicId);
      if (uploadedAadharBack) uploadedPublicIds.push(uploadedAadharBack.publicId);
      if (uploadedPassbookPhoto) uploadedPublicIds.push(uploadedPassbookPhoto.publicId);

      const documentsToCreate: Array<{
        type: string;
        number: string;
        expiryDate?: Date;
        frontImage: string;
        backImage?: string;
      }> = [
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
      ];

      if (uploadedAadharFront && documents.aadhar?.number) {
        documentsToCreate.push({
          type: 'AADHAAR_CARD',
          number: documents.aadhar.number,
          frontImage: uploadedAadharFront.url,
          backImage: uploadedAadharBack?.url,
        });
      }

      if (uploadedPassbookPhoto) {
        documentsToCreate.push({
          type: 'BANK_PASSBOOK',
          number: banking?.accountNumber || 'PASSBOOK',
          frontImage: uploadedPassbookPhoto.url,
        });
      }

      const profile = await this.driverService.registerFullDriver({
        userId,
        licenseNumber: documents.drivingLicense.number,
        profilePhoto: {
          url: uploadedProfilePhoto.url,
          publicId: uploadedProfilePhoto.publicId,
        },
        accountHolderName: banking?.accountHolderName || null,
        accountNumber: banking?.accountNumber || null,
        ifscCode: banking?.ifscCode || null,
        bankName: banking?.bankName || null,
        upiId: banking?.upiId || null,
        passbookPhoto: uploadedPassbookPhoto
          ? { url: uploadedPassbookPhoto.url, publicId: uploadedPassbookPhoto.publicId }
          : undefined,
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
        documents: documentsToCreate,
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
    } catch (err: unknown) {
      await rollbackUploads();
      const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
      if (errObj.code === 'ETIMEDOUT' || errObj.name === 'AggregateError' || (typeof errObj.message === 'string' && errObj.message.includes('timeout'))) {
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

  uploadDocumentImage = asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    return this.uploadImage(req, res, next);
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

    let extraStats = undefined;
    try {
      const rideServiceUrl = process.env.RIDE_SERVICE_URL || 'http://localhost:4003';
      const authHeader = req.headers.authorization;
      const resp = await axios.get(`${rideServiceUrl}/v1/rides/metrics/driver`, {
        timeout: 2000,
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || 'urbanfleet-internal-service-secret',
        },
      });
      if (resp.data?.data) {
        extraStats = {
          totalTrips: resp.data.data.totalTrips,
          completedTrips: resp.data.data.completedTrips,
          cancelledTrips: resp.data.data.cancelledTrips,
          totalDistance: resp.data.data.totalDistanceKm,
          totalEarnings: resp.data.data.totalEarningsPaise,
        };
      }
    } catch (err: unknown) {
      // Non-blocking fallback if ride-service is unavailable
      logger.warn('Failed to retrieve driver metrics from ride-service for profile', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const formatted = formatDriverProfileForFrontend(profile, extraStats);
    res.status(200).json({ success: true, data: formatted });
  });

  updateDriverProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const profile = await this.driverService.updateProfile(userId, req.body);
    res.status(200).json({ success: true, data: profile });
  });

  updateBankDetails = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = this.getAuthenticatedUserId(req);
    const profile = await this.driverService.getDriverByUserId(userId);

    const bodyData =
      typeof req.body.bankDetails === 'string'
        ? JSON.parse(req.body.bankDetails)
        : req.body.bankDetails || req.body;

    const validationResult = updateBankDetailsSchema.safeParse(bodyData);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bank details input',
        errors: validationResult.error.issues,
      });
    }

    const { accountHolderName, accountNumber, ifscCode, bankName, upiId } = validationResult.data;
    let passbookPhotoData = profile.passbookPhoto as { url: string; publicId: string } | null;

    if (req.file) {
      const uploadedPassbook = await this.cloudinaryService.uploadImage(
        req.file,
        CloudinaryFolders.DRIVER_PASSBOOK
      );
      passbookPhotoData = {
        url: uploadedPassbook.url,
        publicId: uploadedPassbook.publicId,
      };

      try {
        await this.documentService.uploadDocument({
          driverProfileId: profile.id,
          type: 'BANK_PASSBOOK',
          documentUrl: uploadedPassbook.url,
          frontImage: uploadedPassbook.url,
          number: accountNumber,
        });
      } catch (docErr) {
        logger.warn('Failed to register passbook document in document table', { error: docErr });
      }
    }

    // Direct database update for banking details - DO NOT demote or change driver's verification status
    const updated = await this.driverService.updateBankDetails(userId, {
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName: bankName || undefined,
      upiId,
      passbookPhoto: passbookPhotoData || undefined,
    });

    return res.status(200).json({
      success: true,
      message: 'Bank details updated successfully',
      data: {
        accountHolderName: updated.accountHolderName,
        accountNumber: updated.accountNumber,
        ifscCode: updated.ifscCode,
        bankName: updated.bankName,
        upiId: updated.upiId,
        passbookPhoto: updated.passbookPhoto,
      },
    });
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
    const roles: string[] = req.roles ?? [];
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
    const roles: string[] = req.roles ?? [];
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
    const targetStatus = isVerified ? VerificationStatus.VERIFIED : VerificationStatus.REJECTED;

    await this.driverService.updateVerificationStatus(profile.id, targetStatus, isVerified);

    if (isVerified) {
      const docs = await this.documentService.getDocumentsByDriverId(profile.id);
      for (const doc of docs) {
        await this.documentService.verifyDocument(doc.id, VerificationStatus.VERIFIED);
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

    let rideMetrics = null;
    try {
      const rideServiceUrl = process.env.RIDE_SERVICE_URL || 'http://localhost:4003';
      const authHeader = req.headers.authorization;
      const resp = await axios.get(`${rideServiceUrl}/v1/rides/metrics/driver`, {
        timeout: 2000,
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || 'urbanfleet-internal-service-secret',
        },
      });
      rideMetrics = resp.data?.data;
    } catch (err: unknown) {
      // Non-blocking fallback if ride-service is unavailable
      logger.warn('Failed to retrieve ride metrics for earnings from ride-service', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const totalEarningsPaise = Math.max(
      earnings.totalEarningsPaise,
      Number(rideMetrics?.totalEarningsPaise ?? 0)
    );
    const totalTrips = Math.max(
      earnings.totalTrips,
      Number(rideMetrics?.totalTrips ?? 0)
    );

    res.status(200).json({
      success: true,
      data: {
        ...earnings,
        totalEarningsPaise,
        totalTrips,
        totalDistanceKm: Number(rideMetrics?.totalDistanceKm ?? 0),
      },
    });
  });

  getDriverById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const profile = await this.driverService.getDriverById(req.params.id);
    if (!profile) {
      throw new AppError('Driver not found', 404, 'NOT_FOUND');
    }
    const callerId = req.userId;
    const isPrivileged = Boolean(callerId && profile.userId === callerId);

    let userDetails = null;
    try {
      userDetails = await this.authServiceClient.getUserById(profile.userId);
    } catch (err: unknown) {
      logger.warn('Failed to fetch user details from auth-service in getDriverById', {
        userId: profile.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const data = isPrivileged
      ? {
          ...profile,
          firstName: userDetails?.firstName || 'Captain',
          lastName: userDetails?.lastName || '',
          email: userDetails?.email || '',
          user: userDetails,
        }
      : this.driverService.sanitizePublicProfile(profile, userDetails);
    res.status(200).json({ success: true, data });
  });

  getDriverByUserId = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const profile = await this.driverService.getDriverByUserId(req.params.userId);
    if (!profile) {
      throw new AppError('Driver not found', 404, 'NOT_FOUND');
    }
    const callerId = req.userId;
    const isPrivileged = Boolean(callerId && profile.userId === callerId);

    let userDetails = null;
    try {
      userDetails = await this.authServiceClient.getUserById(profile.userId);
    } catch (err: unknown) {
      logger.warn('Failed to fetch user details from auth-service in getDriverByUserId', {
        userId: profile.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const data = isPrivileged
      ? {
          ...profile,
          firstName: userDetails?.firstName || 'Captain',
          lastName: userDetails?.lastName || '',
          email: userDetails?.email || '',
          user: userDetails,
        }
      : this.driverService.sanitizePublicProfile(profile, userDetails);
    res.status(200).json({ success: true, data });
  });

  getAdminMetrics = asyncHandler(async (_req: Request, res: Response) => {
    const summary = await this.driverService.getDriverMetrics();
    res.status(200).json({ success: true, data: summary });
  });

  listDriversAdmin = asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const status = typeof req.query.status === 'string' ? (req.query.status as VerificationStatus) : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;

    const result = await this.driverService.listDrivers({ page, limit, status, search });
    res.status(200).json({
      success: true,
      data: result.items,
      pagination: { page, limit, total: result.total },
    });
  });

  updateVerificationAdmin = asyncHandler(async (req: Request, res: Response) => {
    const idParam = z.string().uuid().safeParse(req.params.id);
    if (!idParam.success) {
      throw new AppError('Invalid driver ID format: must be a valid UUID', 400, 'BAD_REQUEST');
    }

    const body = z.object({
      status: z.enum(['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'APPROVED', 'SUSPENDED']),
      reason: z.string().trim().min(3).max(500),
    }).parse(req.body);

    const existing = await this.driverService.getDriverById(req.params.id);

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
      throw new AppError(
        `Invalid driver status transition from ${currentStatus} to ${targetStatus}`,
        400,
        'BAD_REQUEST'
      );
    }

    const isApprovedOrVerified = targetStatus === 'APPROVED' || targetStatus === 'VERIFIED';
    const isRejected = targetStatus === 'REJECTED';

    if (isApprovedOrVerified) {
      const docs = await this.documentService.getDocumentsByDriverId(existing.id);
      for (const doc of docs) {
        if (doc.status === VerificationStatus.PENDING) {
          await this.documentService.verifyDocument(doc.id, VerificationStatus.VERIFIED);
        }
      }

      try {
        await this.authServiceClient.grantDriverRole(existing.userId);
      } catch (grantErr: unknown) {
        const errorMsg = grantErr instanceof Error ? grantErr.message : String(grantErr);
        logger.warn('Failed to grant DRIVER role in auth-service', { userId: existing.userId, error: errorMsg });
      }
    } else if (isRejected) {
      const docs = await this.documentService.getDocumentsByDriverId(existing.id);
      for (const doc of docs) {
        if (doc.status === VerificationStatus.PENDING) {
          await this.documentService.verifyDocument(doc.id, VerificationStatus.REJECTED, body.reason);
        }
      }
    }

    const profile = await this.driverService.updateVerificationStatus(
      req.params.id,
      body.status as VerificationStatus,
      isApprovedOrVerified
    );

    res.status(200).json({ success: true, data: profile, reason: body.reason });
  });
}
export default DriverController;
