import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriverController } from '../src/controllers/driver.controller.js';
import { allowedMimeTypes, allowedExtensions } from '../src/middlewares/multer.middleware.js';

describe('Driver Cloudinary Multi-File Registration & Upload Workflow', () => {
  let mockDriverService: any;
  let mockDocService: any;
  let mockCloudinaryService: any;
  let controller: DriverController;

  beforeEach(() => {
    mockDriverService = {
      createDriverProfile: vi.fn(),
      registerFullDriver: vi.fn(),
      getDriverByUserId: vi.fn(),
      updateProfile: vi.fn(),
      updateVehicleInfo: vi.fn(),
      setAvailability: vi.fn(),
      calculateEarnings: vi.fn(),
      getDriverById: vi.fn(),
    };

    mockDocService = {
      uploadDocument: vi.fn(),
    };

    mockCloudinaryService = {
      uploadImage: vi.fn().mockImplementation((file: any, folder: string) => {
        return Promise.resolve({
          publicId: `${folder}/pub_${file.fieldname || 'img'}`,
          url: `https://res.cloudinary.com/urbanfleet/${folder}/pub_${file.fieldname || 'img'}.jpg`,
        });
      }),
      deleteImage: vi.fn().mockResolvedValue(undefined),
      deleteImages: vi.fn().mockResolvedValue(undefined),
    };

    controller = new DriverController(mockDriverService, mockDocService, mockCloudinaryService);
  });

  describe('Multer Validation Rules', () => {
    it('allows valid image mime types and extensions', () => {
      expect(allowedMimeTypes).toContain('image/jpeg');
      expect(allowedMimeTypes).toContain('image/png');
      expect(allowedMimeTypes).toContain('image/webp');
      expect(allowedExtensions).toEqual(['.jpg', '.jpeg', '.png', '.webp']);
    });
  });

  describe('Driver Registration Flow with Cloudinary', () => {
    const mockFile = (fieldname: string) => ({
      fieldname,
      buffer: Buffer.from('image-content'),
      originalname: `${fieldname}.jpg`,
      mimetype: 'image/jpeg',
    });

    const createFullFiles = () => ({
      profilePhoto: [mockFile('profilePhoto')],
      vehicleFront: [mockFile('vehicleFront')],
      vehicleBack: [mockFile('vehicleBack')],
      vehicleLeft: [mockFile('vehicleLeft')],
      vehicleRight: [mockFile('vehicleRight')],
      vehicleInterior: [mockFile('vehicleInterior')],
      licenseFront: [mockFile('licenseFront')],
      licenseBack: [mockFile('licenseBack')],
      registrationCertificate: [mockFile('registrationCertificate')],
      insurance: [mockFile('insurance')],
      pollutionCertificate: [mockFile('pollutionCertificate')],
    });

    it('successfully uploads all 11 driver/vehicle assets to Cloudinary and registers profile', async () => {
      const files = createFullFiles();
      const req: any = {
        user: { userId: 'd1111111-1111-1111-1111-111111111111' },
        files,
        body: {
          vehicle: JSON.stringify({
            type: 'CAR',
            brand: 'Hyundai',
            model: 'Creta',
            color: 'White',
            registrationNumber: 'DL 01 AB 1234',
            registrationYear: 2023,
          }),
          documents: JSON.stringify({
            drivingLicense: {
              number: 'DL-2023-0001',
              expiryDate: '2030-01-01',
            },
            registrationCertificate: {
              number: 'RC-2023-9999',
            },
            insurance: {
              number: 'POL-INS-888',
              expiryDate: '2028-05-01',
            },
            pollutionCertificate: {
              expiryDate: '2025-10-01',
            },
          }),
        },
      };

      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      mockDriverService.registerFullDriver.mockResolvedValue({
        id: 'drv-profile-uuid',
        verificationStatus: 'PENDING',
      });

      await controller.registerDriver(req, res, next);

      expect(mockCloudinaryService.uploadImage).toHaveBeenCalledTimes(11);
      expect(mockDriverService.registerFullDriver).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Driver profile created successfully. Awaiting verification.',
          data: expect.objectContaining({
            id: 'drv-profile-uuid',
            verificationStatus: 'PENDING',
          }),
        })
      );
    });

    it('rolls back all uploaded Cloudinary images if driver creation fails', async () => {
      const files = createFullFiles();
      const req: any = {
        user: { userId: 'd2222222-2222-2222-2222-222222222222' },
        files,
        body: {
          vehicle: JSON.stringify({
            type: 'CAR',
            brand: 'Maruti',
            model: 'Swift',
            color: 'Red',
            registrationNumber: 'MH 02 CD 5678',
            registrationYear: 2022,
          }),
          documents: JSON.stringify({
            drivingLicense: { number: 'DL-999' },
            registrationCertificate: { number: 'RC-999' },
            insurance: { number: 'INS-999' },
            pollutionCertificate: { expiryDate: '2025-01-01' },
          }),
        },
      };

      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
      const next = vi.fn();

      mockDriverService.registerFullDriver.mockRejectedValue(new Error('Database unique constraint failed'));

      await controller.registerDriver(req, res, next);

      expect(mockCloudinaryService.uploadImage).toHaveBeenCalledTimes(11);
      expect(mockCloudinaryService.deleteImages).toHaveBeenCalledTimes(1);
      expect(mockCloudinaryService.deleteImages).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('drivers/')])
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('rejects registration when any required image is missing', async () => {
      const files: any = createFullFiles();
      delete files.pollutionCertificate;

      const req: any = {
        user: { userId: 'd3333333-3333-3333-3333-333333333333' },
        files,
        body: {
          vehicle: JSON.stringify({
            type: 'CAR',
            brand: 'Honda',
            model: 'City',
            color: 'Silver',
            registrationNumber: 'KA 03 EF 9012',
            registrationYear: 2021,
          }),
          documents: JSON.stringify({
            drivingLicense: { number: 'DL-777' },
            registrationCertificate: { number: 'RC-777' },
            insurance: { number: 'INS-777' },
            pollutionCertificate: {},
          }),
        },
      };

      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
      const next = vi.fn();

      await controller.registerDriver(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Please upload all required driver documents and vehicle images.',
        })
      );
      expect(mockCloudinaryService.uploadImage).not.toHaveBeenCalled();
    });

    it('supports standalone single image upload', async () => {
      const req: any = {
        file: mockFile('document'),
        body: { folder: 'drivers/documents' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
      const next = vi.fn();

      await controller.uploadImage(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            url: expect.stringContaining('https://res.cloudinary.com/'),
          }),
        })
      );
    });

    it('supports standalone image deletion by publicId', async () => {
      const req: any = {
        body: { publicId: 'drivers/profile/pub_profilePhoto' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
      const next = vi.fn();

      await controller.deleteImage(req, res, next);

      expect(mockCloudinaryService.deleteImage).toHaveBeenCalledWith('drivers/profile/pub_profilePhoto');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Image deleted successfully',
      });
    });
  });
});
