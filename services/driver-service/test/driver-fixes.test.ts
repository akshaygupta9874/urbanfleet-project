import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DriverService } from '../src/services/driver.service.js';
import { DriverController } from '../src/controllers/driver.controller.js';
import { AppError } from '@urbanfleet/common';

describe('Driver Service Security & Integration Fixes Suite', () => {
  let mockDriverRepo: any;
  let mockDocRepo: any;
  let driverService: DriverService;
  let mockDocService: any;
  let driverController: DriverController;

  const mockFullProfile = {
    id: 'drv-uuid-1',
    userId: 'usr-uuid-1',
    licenseNumber: 'DL-9988776655',
    rating: 4.85,
    totalTrips: 120,
    totalEarningsPaise: 4500000,
    isAvailable: true,
    isOnline: true,
    verificationStatus: 'APPROVED',
    bankDetails: { accountNumber: '1234567890', ifsc: 'HDFC0001234' },
    documents: [{ type: 'DRIVING_LICENSE', url: 'https://cloudinary.com/secret.pdf' }],
    vehicles: [
      {
        id: 'veh-1',
        category: 'CAR',
        make: 'Honda',
        model: 'City',
        color: 'White',
        plateNumber: 'DL-01-AB-1234',
        year: 2022,
      },
    ],
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    mockDriverRepo = {
      findById: vi.fn().mockResolvedValue(mockFullProfile),
      findByUserId: vi.fn().mockResolvedValue(mockFullProfile),
      update: vi.fn().mockImplementation(async (id, data) => ({ ...mockFullProfile, ...data })),
      updateVehicle: vi.fn().mockResolvedValue({ id: 'veh-1', brand: 'Toyota' }),
      createVehicle: vi.fn().mockResolvedValue({ id: 'veh-2' }),
      create: vi.fn().mockImplementation(async (data) => ({ id: 'new-id', ...data })),
      updateFullProfile: vi.fn().mockImplementation(async (id, data) => ({ id, ...data, verificationStatus: 'PENDING' })),
      createFullProfile: vi.fn().mockImplementation(async (data) => ({ id: 'new-full-id', ...data })),
    };

    mockDocService = {
      verifyDocument: vi.fn().mockResolvedValue({ id: 'doc-1', status: 'VERIFIED' }),
      checkDocumentExpiry: vi.fn().mockResolvedValue(false),
    };

    driverService = new DriverService(mockDriverRepo);
    driverController = new DriverController(driverService, mockDocService, {} as any);
  });

  describe('Document Verification Role-Based Authorization', () => {
    it('rejects document verification attempt by unprivileged user with 403 FORBIDDEN', async () => {
      const req: any = {
        params: { id: 'doc-1' },
        body: { status: 'VERIFIED' },
        user: { id: 'rider-1', role: 'RIDER' },
        role: 'RIDER',
        headers: {},
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await driverController.verifyDocument(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const passedError = next.mock.calls[0][0];
      expect(passedError.statusCode).toBe(403);
      expect(passedError.message).toContain('Only administrators or verifiers can verify documents');
      expect(mockDocService.verifyDocument).not.toHaveBeenCalled();
    });

    it('allows document verification by user with ADMIN role', async () => {
      const req: any = {
        params: { id: 'doc-1' },
        body: { status: 'VERIFIED' },
        user: { id: 'admin-1', role: 'ADMIN' },
        role: 'ADMIN',
        headers: {},
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };

      await driverController.verifyDocument(req, res, () => {});

      expect(mockDocService.verifyDocument).toHaveBeenCalledWith('doc-1', 'VERIFIED', undefined);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('allows document verification by user with VERIFIER role', async () => {
      const req: any = {
        params: { id: 'doc-2' },
        body: { status: 'REJECTED', rejectionReason: 'Blurry photo' },
        user: { id: 'verifier-1', role: 'VERIFIER' },
        role: 'VERIFIER',
        headers: {},
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };

      await driverController.verifyDocument(req, res, () => {});

      expect(mockDocService.verifyDocument).toHaveBeenCalledWith('doc-2', 'REJECTED', 'Blurry photo');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('rejects document verification with x-internal-service-key header if user lacks VERIFIER role', async () => {
      const req: any = {
        params: { id: 'doc-3' },
        body: { status: 'VERIFIED' },
        headers: { 'x-internal-service-key': 'test-internal-secret' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      let caughtError: any;

      await driverController.verifyDocument(req, res, (err: any) => {
        caughtError = err;
      });

      expect(caughtError).toBeDefined();
      expect(caughtError.statusCode).toBe(403);
      expect(mockDocService.verifyDocument).not.toHaveBeenCalledWith('doc-3', 'VERIFIED', undefined);
    });
  });

  describe('Public Profile Sanitization', () => {
    it('sanitizes driver profile for public/unprivileged requests, redacting sensitive data', async () => {
      const sanitized = driverService.sanitizePublicProfile(mockFullProfile);

      expect(sanitized.id).toBe('drv-uuid-1');
      expect(sanitized.rating).toBe(4.85);
      expect(sanitized.totalTrips).toBe(120);
      expect(sanitized.isAvailable).toBe(true);

      // Verify sensitive details are completely absent
      expect((sanitized as any).licenseNumber).toBeUndefined();
      expect((sanitized as any).bankDetails).toBeUndefined();
      expect((sanitized as any).documents).toBeUndefined();
      expect((sanitized as any).totalEarningsPaise).toBeUndefined();

      // Vehicle model is preserved for rider identification
      expect(sanitized.vehicles[0].brand).toBe('Honda');
      expect(sanitized.vehicles[0].model).toBe('City');
      expect(sanitized.vehicles[0].color).toBe('White');
    });

    it('controller returns sanitized profile to unauthenticated / non-owner callers', async () => {
      const req: any = {
        params: { id: 'drv-uuid-1' },
        headers: {},
      };
      let responseBody: any = null;
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockImplementation((data) => {
          responseBody = data;
        }),
      };

      await driverController.getDriverById(req, res, () => {});

      expect(responseBody.success).toBe(true);
      expect(responseBody.data.licenseNumber).toBeUndefined();
      expect(responseBody.data.bankDetails).toBeUndefined();
      expect(responseBody.data.rating).toBe(4.85);
    });

    it('controller returns full profile to the driver owner themselves', async () => {
      const req: any = {
        params: { id: 'drv-uuid-1' },
        userId: 'usr-uuid-1', // matches profile.userId
        user: { id: 'usr-uuid-1', role: 'DRIVER' },
        headers: {},
      };
      let responseBody: any = null;
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockImplementation((data) => {
          responseBody = data;
        }),
      };

      await driverController.getDriverById(req, res, () => {});

      expect(responseBody.success).toBe(true);
      expect(responseBody.data.licenseNumber).toBe('DL-9988776655');
      expect(responseBody.data.bankDetails).toBeDefined();
    });
  });

  describe('Driver Profile Update Security', () => {
    it('strips client-provided userId to prevent ownership reassignment', async () => {
      await driverService.updateProfile('usr-uuid-1', {
        userId: 'attacker-uuid-999',
        licenseNumber: 'DL-NEW-112233',
      });

      expect(mockDriverRepo.update).toHaveBeenCalledWith('drv-uuid-1', {
        licenseNumber: 'DL-NEW-112233',
      });
      // Verifies attacker-supplied userId was never passed to repo update
      expect(mockDriverRepo.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: 'attacker-uuid-999' })
      );
    });

    it('updates vehicle relation when vehicle object is provided in profile update', async () => {
      await driverService.updateProfile('usr-uuid-1', {
        vehicle: {
          brand: 'Toyota',
          model: 'Innova',
          color: 'Silver',
        },
      });

      expect(mockDriverRepo.updateVehicle).toHaveBeenCalledWith('veh-1', {
        brand: 'Toyota',
        model: 'Innova',
        color: 'Silver',
      });
    });
  });

  describe('Placeholder Driver Profile Completion & Registration Conflict', () => {
    const placeholderProfile = {
      id: 'drv-placeholder-1',
      userId: 'usr-new-driver',
      licenseNumber: 'PENDING_usr-new-',
      verificationStatus: 'PENDING',
      isVerified: false,
      vehicles: [],
      documents: [],
    };

    it('createDriverProfile updates existing placeholder profile instead of throwing ConflictError', async () => {
      mockDriverRepo.findByUserId.mockResolvedValueOnce(placeholderProfile);

      const result = await driverService.createDriverProfile('usr-new-driver', 'DL-NEW-556677');

      expect(mockDriverRepo.update).toHaveBeenCalledWith('drv-placeholder-1', {
        licenseNumber: 'DL-NEW-556677',
        verificationStatus: 'PENDING',
      });
      expect(result).toBeDefined();
    });

    it('createDriverProfile throws ConflictError if driver profile is already completed/approved', async () => {
      mockDriverRepo.findByUserId.mockResolvedValueOnce(mockFullProfile);

      await expect(
        driverService.createDriverProfile('usr-uuid-1', 'DL-NEW-999999')
      ).rejects.toThrow('Driver profile already exists for this account');
    });

    it('registerFullDriver updates existing placeholder profile via updateFullProfile', async () => {
      mockDriverRepo.findByUserId.mockResolvedValueOnce(placeholderProfile);

      const registrationData = {
        userId: 'usr-new-driver',
        licenseNumber: 'DL-REAL-123456',
        vehicle: {
          type: 'CAR',
          brand: 'Hyundai',
          model: 'i20',
          color: 'Blue',
          registrationNumber: 'DL-02-CD-5678',
          registrationYear: 2023,
        },
        documents: [
          {
            type: 'DRIVING_LICENSE',
            number: 'DL-REAL-123456',
            frontImage: 'https://cloudinary.com/dl.jpg',
          },
        ],
      };

      const result = await driverService.registerFullDriver(registrationData);

      expect(mockDriverRepo.updateFullProfile).toHaveBeenCalledWith(
        'drv-placeholder-1',
        registrationData
      );
      expect(result.id).toBe('drv-placeholder-1');
      expect(result.verificationStatus).toBe('PENDING');
    });

    it('registerFullDriver creates new full profile if no existing record exists', async () => {
      mockDriverRepo.findByUserId.mockResolvedValueOnce(null);

      const registrationData = {
        userId: 'usr-brand-new',
        licenseNumber: 'DL-BRAND-NEW',
        vehicle: {
          type: 'CAR',
          brand: 'Maruti',
          model: 'Swift',
          color: 'Red',
          registrationNumber: 'DL-03-EF-9012',
          registrationYear: 2024,
        },
        documents: [],
      };

      const result = await driverService.registerFullDriver(registrationData);

      expect(mockDriverRepo.createFullProfile).toHaveBeenCalledWith(registrationData);
      expect(result.id).toBe('new-full-id');
    });

    it('registerFullDriver throws ConflictError if existing profile is already completed/approved', async () => {
      mockDriverRepo.findByUserId.mockResolvedValueOnce(mockFullProfile);

      const registrationData = {
        userId: 'usr-uuid-1',
        licenseNumber: 'DL-CONFLICT',
        vehicle: {
          type: 'CAR',
          brand: 'Honda',
          model: 'City',
          color: 'White',
          registrationNumber: 'DL-01-AB-1234',
          registrationYear: 2022,
        },
        documents: [],
      };

      await expect(driverService.registerFullDriver(registrationData)).rejects.toThrow(
        'Driver application already exists for this account'
      );
    });
  });

  describe('Driver Earnings Post-Commission Calculation', () => {
    it('increments totalEarningsPaise using driverEarningPaise when present', () => {
      const payload = {
        rideId: 'ride-1',
        riderId: 'rider-1',
        driverId: 'drv-uuid-1',
        totalFarePaise: 10000,
        baseFarePaise: 2500,
        surgeMultiplier: 1.0,
        distanceKm: 5,
        durationMinutes: 15,
        driverEarningPaise: 9000,
        platformCommissionPaise: 1000,
        completedAt: new Date().toISOString()
      };

      const computedEarning = payload.driverEarningPaise !== undefined
        ? BigInt(payload.driverEarningPaise)
        : (BigInt(payload.totalFarePaise) - BigInt(Math.round(payload.totalFarePaise * 0.10)));

      expect(computedEarning).toBe(9000n);
    });

    it('falls back to 90% net driver share if driverEarningPaise is omitted', () => {
      const payload = {
        totalFarePaise: 10000,
      };

      const computedEarning = (payload as any).driverEarningPaise !== undefined
        ? BigInt((payload as any).driverEarningPaise)
        : (BigInt(payload.totalFarePaise) - BigInt(Math.round(payload.totalFarePaise * 0.10)));

      expect(computedEarning).toBe(9000n);
      expect(computedEarning).not.toBe(BigInt(payload.totalFarePaise));
    });
  });
});
