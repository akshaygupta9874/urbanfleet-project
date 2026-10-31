import multer from 'multer';
import path from 'path';
import { AppError } from '@urbanfleet/common';

// Configuration Constants preserved from previous project
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
export const MAX_FILES = 25; // Accommodate all vehicle, license, KYC and banking files

export const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
];

export const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

const storage = multer.memoryStorage();

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  // 1. Check the mime type (what the browser claims the file is)
  const isMimeTypeValid = allowedMimeTypes.includes(file.mimetype);

  // 2. Check the extension (prevents users from renaming an .exe to .jpg)
  const ext = path.extname(file.originalname).toLowerCase();
  const isExtensionValid = allowedExtensions.includes(ext);

  if (isMimeTypeValid && isExtensionValid) {
    cb(null, true);
  } else {
    const error = new AppError(
      'Invalid file type. Only JPG, JPEG, PNG, and WEBP images are allowed.',
      400,
      'INVALID_FILE_TYPE'
    );
    cb(error);
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
});

export default upload;
