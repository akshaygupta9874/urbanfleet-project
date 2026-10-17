import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudinaryService, CloudinaryFolders } from '../src/services/cloudinary.service.js';

describe('CloudinaryService Media Upload & Lifecycle', () => {
  let service: CloudinaryService;

  beforeEach(() => {
    service = new CloudinaryService();
  });

  it('exposes defined Cloudinary folders consistent with driver entity hierarchy', () => {
    expect(CloudinaryFolders.DRIVER_PROFILE).toBe('drivers/profile');
    expect(CloudinaryFolders.DRIVER_VEHICLE).toBe('drivers/vehicle');
    expect(CloudinaryFolders.DRIVER_LICENSE).toBe('drivers/license');
    expect(CloudinaryFolders.DRIVER_RC).toBe('drivers/registration');
    expect(CloudinaryFolders.DRIVER_INSURANCE).toBe('drivers/insurance');
    expect(CloudinaryFolders.DRIVER_PUC).toBe('drivers/pollution');
  });

  it('rejects upload when file buffer is missing', async () => {
    const invalidFile: any = { originalname: 'test.jpg' };
    await expect(service.uploadImage(invalidFile, CloudinaryFolders.DRIVER_PROFILE)).rejects.toThrow(
      'Invalid file provided for upload: file buffer is empty.'
    );
  });

  it('uploads a mock image file when unconfigured in test environment', async () => {
    const mockFile: any = {
      buffer: Buffer.from('fake-image-bytes'),
      originalname: 'license_front.jpg',
      mimetype: 'image/jpeg',
    };

    const result = await service.uploadImage(mockFile, CloudinaryFolders.DRIVER_LICENSE);

    expect(result).toHaveProperty('publicId');
    expect(result).toHaveProperty('url');
    expect(result.publicId).toContain('drivers/license/');
    expect(result.url).toContain('https://res.cloudinary.com/');
  });

  it('uploads raw buffer to specified folder', async () => {
    const buffer = Buffer.from('raw-image-content');
    const result = await service.uploadBuffer(buffer, CloudinaryFolders.DRIVER_VEHICLE, 'vehicle_front_01');

    expect(result.publicId).toBe('drivers/vehicle/vehicle_front_01');
    expect(result.url).toContain('drivers/vehicle/vehicle_front_01');
  });

  it('safely handles deleteImage without throwing', async () => {
    await expect(service.deleteImage('drivers/mock_12345')).resolves.toBeUndefined();
  });

  it('safely deletes multiple images in batch', async () => {
    const publicIds = ['drivers/mock_1', 'drivers/mock_2', 'drivers/mock_3'];
    await expect(service.deleteImages(publicIds)).resolves.toBeUndefined();
  });

  it('safely handles empty array in deleteImages', async () => {
    await expect(service.deleteImages([])).resolves.toBeUndefined();
  });
});
