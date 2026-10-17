import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import cloudinary from '../config/cloudinary.config.js';

export interface CloudinaryUploadResult {
  publicId: string;
  url: string;
}

export const CloudinaryFolders = {
  DRIVER_PROFILE: 'drivers/profile',
  DRIVER_VEHICLE: 'drivers/vehicle',
  DRIVER_LICENSE: 'drivers/license',
  DRIVER_RC: 'drivers/registration',
  DRIVER_INSURANCE: 'drivers/insurance',
  DRIVER_PUC: 'drivers/pollution',
} as const;

export class CloudinaryService {
  /**
   * Upload a single image file (from Multer memory storage) to Cloudinary
   */
  async uploadImage(
    file: Express.Multer.File,
    folder: string
  ): Promise<CloudinaryUploadResult> {
    if (!file || !file.buffer) {
      throw new Error('Invalid file provided for upload: file buffer is empty.');
    }

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined
        ) => {
          if (error) {
            return reject(error);
          }
          if (!result) {
            return reject(new Error('Cloudinary upload failed: no result returned.'));
          }
          resolve({
            publicId: result.public_id,
            url: result.secure_url,
          });
        }
      );

      stream.end(file.buffer);
    });
  }

  /**
   * Upload raw Buffer to Cloudinary
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    filename?: string
  ): Promise<CloudinaryUploadResult> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          public_id: filename,
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined
        ) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Cloudinary upload failed: no result returned.'));
          resolve({
            publicId: result.public_id,
            url: result.secure_url,
          });
        }
      );

      stream.end(buffer);
    });
  }

  /**
   * Delete a single image from Cloudinary by public ID
   */
  async deleteImage(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }

  /**
   * Delete multiple images from Cloudinary by public IDs
   */
  async deleteImages(publicIds: string[]): Promise<void> {
    if (!publicIds || publicIds.length === 0) return;
    await Promise.all(
      publicIds.map((id) => this.deleteImage(id).catch((err) => {
        console.warn(`[CloudinaryService] Failed to delete image ${id}:`, err);
      }))
    );
  }
}

export const cloudinaryService = new CloudinaryService();
export default cloudinaryService;
