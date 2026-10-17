import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudinaryService, CloudinaryFolders } from '../src/services/cloudinary.service.js';
import cloudinary from '../src/config/cloudinary.config.js';

describe('CloudinaryService Media Upload & Lifecycle', () => {
  let service: CloudinaryService;

  beforeEach(() => {
    service = new CloudinaryService();
    vi.restoreAllMocks();
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

  it('uploads an image file via Cloudinary uploader upload_stream', async () => {
    const testFile: any = {
      buffer: Buffer.from('image-binary-data'),
      originalname: 'license_front.jpg',
      mimetype: 'image/jpeg',
    };

    vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options: any, callback: any): any => {
      callback(undefined, {
        public_id: `${options.folder}/img_123456`,
        secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${options.folder}/img_123456.jpg`,
      });
      return { end: vi.fn() };
    });

    const result = await service.uploadImage(testFile, CloudinaryFolders.DRIVER_LICENSE);

    expect(result).toHaveProperty('publicId');
    expect(result).toHaveProperty('url');
    expect(result.publicId).toBe('drivers/license/img_123456');
    expect(result.url).toBe('https://res.cloudinary.com/test-cloud/image/upload/v1/drivers/license/img_123456.jpg');
  });

  it('uploads raw buffer to specified folder via upload_stream', async () => {
    const buffer = Buffer.from('raw-image-content');

    vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options: any, callback: any): any => {
      callback(undefined, {
        public_id: `${options.folder}/${options.public_id}`,
        secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${options.folder}/${options.public_id}.jpg`,
      });
      return { end: vi.fn() };
    });

    const result = await service.uploadBuffer(buffer, CloudinaryFolders.DRIVER_VEHICLE, 'vehicle_front_01');

    expect(result.publicId).toBe('drivers/vehicle/vehicle_front_01');
    expect(result.url).toContain('drivers/vehicle/vehicle_front_01');
  });

  it('destroys single image via cloudinary.uploader.destroy', async () => {
    const destroySpy = vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' } as any);
    await service.deleteImage('drivers/license/img_123');
    expect(destroySpy).toHaveBeenCalledWith('drivers/license/img_123');
  });

  it('deletes multiple images in batch via cloudinary.uploader.destroy', async () => {
    const destroySpy = vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' } as any);
    const publicIds = ['drivers/img_1', 'drivers/img_2', 'drivers/img_3'];
    await service.deleteImages(publicIds);
    expect(destroySpy).toHaveBeenCalledTimes(3);
  });

  it('safely handles empty array in deleteImages', async () => {
    const destroySpy = vi.spyOn(cloudinary.uploader, 'destroy');
    await service.deleteImages([]);
    expect(destroySpy).not.toHaveBeenCalled();
  });
});
