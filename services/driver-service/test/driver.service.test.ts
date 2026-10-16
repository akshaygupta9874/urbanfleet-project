import { describe, it, expect, vi } from 'vitest';
import { DriverService } from '../src/services/driver.service.js';
import { DocumentService } from '../src/services/document.service.js';

describe('Driver Service Profile & Document Management', () => {
  const mockDriverRepo: any = {
    findByUserId: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createVehicle: vi.fn(),
    updateVehicle: vi.fn()
  };

  const mockDocRepo: any = {
    create: vi.fn(),
    findByDriverId: vi.fn(),
    updateStatus: vi.fn()
  };

  const driverService = new DriverService(mockDriverRepo);
  const docService = new DocumentService(mockDocRepo);

  it('should create a driver profile with pending verification', async () => {
    mockDriverRepo.findByUserId.mockResolvedValue(null);
    mockDriverRepo.create.mockImplementation((data: any) => Promise.resolve({ id: 'drv-1', ...data, verificationStatus: 'PENDING' }));

    const profile = await driverService.createDriverProfile('user-1', 'DL-123456');
    expect(profile.userId).toBe('user-1');
    expect(profile.licenseNumber).toBe('DL-123456');
  });

  it('should calculate driver earnings and trips', async () => {
    mockDriverRepo.findByUserId.mockResolvedValue({
      id: 'drv-1',
      totalEarningsPaise: 500000n, // ₹5,000
      totalTrips: 25,
      rating: 4.9
    });

    const earnings = await driverService.calculateEarnings('user-1');
    expect(earnings.totalEarningsPaise).toBe(500000);
    expect(earnings.totalTrips).toBe(25);
    expect(earnings.rating).toBe(4.9);
  });

  it('should upload and verify driver documents', async () => {
    mockDocRepo.create.mockResolvedValue({ id: 'doc-1', type: 'DRIVING_LICENSE', status: 'PENDING' });
    mockDocRepo.updateStatus.mockResolvedValue({ id: 'doc-1', status: 'VERIFIED' });

    const doc = await docService.uploadDocument('drv-1', 'DRIVING_LICENSE', 'https://example.com/doc.jpg');
    expect(doc.status).toBe('PENDING');

    const verified = await docService.verifyDocument('doc-1', 'VERIFIED' as any);
    expect(verified.status).toBe('VERIFIED');
  });
});
