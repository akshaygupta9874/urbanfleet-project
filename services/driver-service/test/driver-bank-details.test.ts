import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriverController, formatDriverProfileForFrontend } from '../src/controllers/driver.controller.js';
import { CloudinaryFolders } from '../src/services/cloudinary.service.js';

describe('Driver Bank Details Controller & Formatting', () => {
  let mockDriverService: any;
  let mockDocService: any;
  let mockCloudinaryService: any;
  let controller: DriverController;

  const sampleProfile = {
    id: 'drv-uuid-1',
    userId: 'usr-uuid-1',
    licenseNumber: 'DL-998877',
    accountHolderName: 'Alex Driver',
    accountNumber: '987654321098',
    ifscCode: 'HDFC0001234',
    bankName: 'HDFC Bank',
    upiId: 'alex@okhdfcbank',
    passbookPhoto: { url: 'https://cloudinary.com/passbook.jpg', publicId: 'drivers/passbook/123' },
    rating: 4.9,
    totalTrips: 15,
    isVerified: true,
    verificationStatus: 'APPROVED',
  };

  beforeEach(() => {
    mockDriverService = {
      getDriverByUserId: vi.fn().mockResolvedValue(sampleProfile),
      updateBankDetails: vi.fn().mockImplementation(async (_userId, bankData) => ({
        ...sampleProfile,
        ...bankData,
      })),
    };

    mockDocService = {
      uploadDocument: vi.fn().mockResolvedValue({ id: 'doc-passbook-1' }),
    };

    mockCloudinaryService = {
      uploadImage: vi.fn().mockResolvedValue({
        url: 'https://cloudinary.com/new-passbook.jpg',
        publicId: 'drivers/passbook/new-123',
      }),
    };

    controller = new DriverController(mockDriverService, mockDocService, mockCloudinaryService);
  });

  it('formats driver profile with banking object and root banking fields for frontend', () => {
    const formatted = formatDriverProfileForFrontend(sampleProfile);
    expect(formatted).toBeDefined();
    expect(formatted?.accountHolderName).toBe('Alex Driver');
    expect(formatted?.accountNumber).toBe('987654321098');
    expect(formatted?.ifscCode).toBe('HDFC0001234');
    expect(formatted?.bankName).toBe('HDFC Bank');
    expect(formatted?.upiId).toBe('alex@okhdfcbank');
    expect(formatted?.passbookPhoto).toEqual({ url: 'https://cloudinary.com/passbook.jpg', publicId: 'drivers/passbook/123' });
    expect(formatted?.banking).toEqual({
      accountHolderName: 'Alex Driver',
      accountNumber: '987654321098',
      ifscCode: 'HDFC0001234',
      bankName: 'HDFC Bank',
      upiId: 'alex@okhdfcbank',
      passbookPhoto: { url: 'https://cloudinary.com/passbook.jpg', publicId: 'drivers/passbook/123' },
    });
  });

  it('updates bank details successfully without passbook file', async () => {
    const req: any = {
      userId: 'usr-uuid-1',
      body: {
        bankDetails: JSON.stringify({
          accountHolderName: 'Alex Updated',
          accountNumber: '112233445566',
          ifscCode: 'ICIC0000001',
          bankName: 'ICICI Bank',
          upiId: 'alex@icici',
        }),
      },
    };

    let responseData: any = null;
    let statusCode = 200;
    const res: any = {
      status: vi.fn().mockImplementation((code) => {
        statusCode = code;
        return res;
      }),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
      }),
    };

    await controller.updateBankDetails(req, res, () => {});

    expect(statusCode).toBe(200);
    expect(responseData.success).toBe(true);
    expect(responseData.data.accountHolderName).toBe('Alex Updated');
    expect(responseData.data.accountNumber).toBe('112233445566');
    expect(responseData.data.ifscCode).toBe('ICIC0000001');
    expect(mockCloudinaryService.uploadImage).not.toHaveBeenCalled();
    expect(mockDocService.uploadDocument).not.toHaveBeenCalled();
  });

  it('uploads passbook image and records document when file is provided', async () => {
    const req: any = {
      userId: 'usr-uuid-1',
      file: { buffer: Buffer.from('fake-passbook'), originalname: 'passbook.jpg' },
      body: {
        bankDetails: {
          accountHolderName: 'Alex Updated',
          accountNumber: '112233445566',
          ifscCode: 'ICIC0000001',
          bankName: 'ICICI Bank',
          upiId: 'alex@icici',
        },
      },
    };

    let responseData: any = null;
    let statusCode = 200;
    const res: any = {
      status: vi.fn().mockImplementation((code) => {
        statusCode = code;
        return res;
      }),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
      }),
    };

    await controller.updateBankDetails(req, res, () => {});

    expect(statusCode).toBe(200);
    expect(responseData.success).toBe(true);
    expect(mockCloudinaryService.uploadImage).toHaveBeenCalledWith(req.file, CloudinaryFolders.DRIVER_PASSBOOK);
    expect(mockDocService.uploadDocument).toHaveBeenCalledWith({
      driverProfileId: 'drv-uuid-1',
      type: 'BANK_PASSBOOK',
      documentUrl: 'https://cloudinary.com/new-passbook.jpg',
      frontImage: 'https://cloudinary.com/new-passbook.jpg',
      number: '112233445566',
    });
    expect(responseData.data.passbookPhoto).toEqual({
      url: 'https://cloudinary.com/new-passbook.jpg',
      publicId: 'drivers/passbook/new-123',
    });
  });

  it('returns 400 when invalid bank details are supplied', async () => {
    const req: any = {
      userId: 'usr-uuid-1',
      body: {
        bankDetails: {
          accountHolderName: '', // empty name
          accountNumber: '123', // too short
          ifscCode: '',
          upiId: '',
        },
      },
    };

    let responseData: any = null;
    let statusCode = 200;
    const res: any = {
      status: vi.fn().mockImplementation((code) => {
        statusCode = code;
        return res;
      }),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
      }),
    };

    await controller.updateBankDetails(req, res, () => {});

    expect(statusCode).toBe(400);
    expect(responseData.success).toBe(false);
    expect(responseData.message).toBe('Invalid bank details input');
  });
});
