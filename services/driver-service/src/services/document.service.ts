import { DocumentRepository, CreateDocumentInput } from '../repositories/document.repository.js';
import { DriverRepository } from '../repositories/driver.repository.js';
import { Document } from '../db/client.js';
import { NotFoundError, BadRequestError } from '@urbanfleet/common';

export const VerificationStatus = {
  PENDING: 'PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];


export const REQUIRED_DOCUMENT_TYPES = [
  'DRIVING_LICENSE',
  'REGISTRATION_CERTIFICATE',
  'INSURANCE',
  'POLLUTION',
] as const;

export type RequiredDocumentType = (typeof REQUIRED_DOCUMENT_TYPES)[number];

export const EXPIRING_DOCUMENT_TYPES = ['DRIVING_LICENSE', 'INSURANCE', 'POLLUTION'] as const;

export interface UploadDocumentDTO {
  driverProfileId: string;
  type: string;
  documentUrl?: string;
  number?: string;
  frontImage?: string;
  backImage?: string;
  expiresAt?: Date | string;
}

export interface DocumentWithStatus extends Document {
  isExpired: boolean;
  daysUntilExpiry: number | null;
  isExpiringSoon: boolean;
}

export interface DriverDocumentSummary {
  driverProfileId: string;
  totalRequired: number;
  totalUploaded: number;
  isFullyUploaded: boolean;
  isFullyVerified: boolean;
  status: VerificationStatus;
  documents: DocumentWithStatus[];
  missingTypes: string[];
  expiredTypes: string[];
  rejectedTypes: string[];
  pendingTypes: string[];
}

export class DocumentService {
  constructor(
    private docRepo: DocumentRepository,
    private driverRepo?: DriverRepository
  ) {}

  /**
   * Uploads or renews a driver document.
   * Supports both object-based DTO and positional parameter overloads for full backward compatibility.
   */
  async uploadDocument(
    paramsOrDriverId: string | UploadDocumentDTO,
    typeParam?: string,
    documentUrlParam?: string,
    expiresAtParam?: Date | string,
    numberParam?: string,
    frontImageParam?: string,
    backImageParam?: string
  ): Promise<Document> {
    let params: UploadDocumentDTO;

    if (typeof paramsOrDriverId === 'string') {
      params = {
        driverProfileId: paramsOrDriverId,
        type: typeParam!,
        documentUrl: documentUrlParam!,
        expiresAt: expiresAtParam,
        number: numberParam,
        frontImage: frontImageParam,
        backImage: backImageParam,
      };
    } else {
      params = paramsOrDriverId;
    }

    const { driverProfileId, type, number } = params;
    if (!driverProfileId) {
      throw new BadRequestError('Driver profile ID is required');
    }
    if (!type) {
      throw new BadRequestError('Document type is required');
    }

    const normalizedType = type.toUpperCase().trim();
    const frontImage = params.frontImage || params.documentUrl;
    const documentUrl = params.documentUrl || params.frontImage;

    if (!documentUrl && !frontImage) {
      throw new BadRequestError('Document URL or front image is required');
    }

    // Parse and validate expiry date
    let expiresAt: Date | undefined;
    if (params.expiresAt) {
      expiresAt = new Date(params.expiresAt);
      if (isNaN(expiresAt.getTime())) {
        throw new BadRequestError('Invalid document expiry date format');
      }
      if (expiresAt.getTime() <= Date.now()) {
        throw new BadRequestError('Document expiry date cannot be in the past');
      }
    }

    // Verify driver profile exists if driverRepo is injected
    if (this.driverRepo) {
      const driver = await this.driverRepo.findById(driverProfileId);
      if (!driver) {
        throw new NotFoundError(`Driver profile with ID ${driverProfileId} does not exist`);
      }
    }

    // Check if document already exists for this driver and type (Renewal / Re-upload)
    const existing = await this.docRepo.findByDriverAndType?.(driverProfileId, normalizedType);

    let doc: Document;
    if (existing && this.docRepo.update) {
      doc = await this.docRepo.update(existing.id, {
        documentUrl: documentUrl!,
        frontImage: frontImage || documentUrl,
        backImage: params.backImage || existing.backImage,
        number: number || existing.number,
        expiresAt: expiresAt !== undefined ? expiresAt : existing.expiresAt,
        status: VerificationStatus.PENDING,
        isVerified: false,
        rejectionReason: null,
      });
    } else {
      doc = await this.docRepo.create({
        driverProfileId,
        type: normalizedType,
        documentUrl: documentUrl!,
        frontImage: frontImage || documentUrl,
        backImage: params.backImage,
        number,
        expiresAt,
        status: VerificationStatus.PENDING,
        isVerified: false,
      });
    }

    // Synchronize overall driver profile verification state
    if (this.driverRepo) {
      await this.syncDriverVerificationStatus(driverProfileId);
    }

    return doc;
  }

  /**
   * Verifies or rejects a document with strict compliance validation.
   */
  async verifyDocument(
    documentId: string,
    status: VerificationStatus,
    rejectionReason?: string
  ): Promise<Document> {
    let doc: Document | null = null;
    if (typeof (this.docRepo as any).findById === 'function') {
      doc = await this.docRepo.findById(documentId);
    }

    if (status === VerificationStatus.REJECTED && !rejectionReason) {
      throw new BadRequestError('A rejection reason must be provided when rejecting a document');
    }

    if (status === VerificationStatus.VERIFIED && doc?.expiresAt) {
      const isExpired = new Date(doc.expiresAt).getTime() <= Date.now();
      if (isExpired) {
        throw new BadRequestError('Cannot verify an expired document. Driver must upload a renewed document.');
      }
    }

    const isVerified = status === VerificationStatus.VERIFIED;
    const updated = await this.docRepo.updateStatus(documentId, status, rejectionReason, isVerified);

    const driverProfileId = updated?.driverProfileId || doc?.driverProfileId;
    if (driverProfileId && this.driverRepo) {
      await this.syncDriverVerificationStatus(driverProfileId);
    }

    return updated;
  }

  /**
   * Checks whether a specific document has expired against the current system time.
   * If expired, demotes its verification status and synchronizes driver profile state.
   */
  async checkDocumentExpiry(documentId: string): Promise<boolean> {
    const doc = await this.docRepo.findById?.(documentId);
    if (!doc) {
      return false;
    }

    if (!doc.expiresAt) {
      return false;
    }

    const isExpired = new Date(doc.expiresAt).getTime() <= Date.now();
    if (isExpired) {
      if (doc.status !== VerificationStatus.REJECTED) {
        await this.docRepo.updateStatus(
          documentId,
          VerificationStatus.REJECTED,
          `Document expired on ${new Date(doc.expiresAt).toISOString()}`,
          false
        );
        if (doc.driverProfileId && this.driverRepo) {
          await this.syncDriverVerificationStatus(doc.driverProfileId);
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Retrieves all documents for a driver enriched with real-time expiry calculations.
   */
  async getDocumentsByDriverId(driverProfileId: string): Promise<DocumentWithStatus[]> {
    const docs = await this.docRepo.findByDriverId(driverProfileId);
    const now = Date.now();

    return docs.map((doc) => {
      const expiresAtMs = doc.expiresAt ? new Date(doc.expiresAt).getTime() : null;
      const isExpired = expiresAtMs !== null ? expiresAtMs <= now : false;
      const daysUntilExpiry =
        expiresAtMs !== null ? Math.ceil((expiresAtMs - now) / (1000 * 60 * 60 * 24)) : null;
      const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 30;

      return {
        ...doc,
        isExpired,
        daysUntilExpiry,
        isExpiringSoon,
      };
    });
  }

  /**
   * Generates a comprehensive verification summary across all 4 required document types.
   */
  async getDocumentSummary(driverProfileId: string): Promise<DriverDocumentSummary> {
    const docs = await this.getDocumentsByDriverId(driverProfileId);
    const uploadedTypes = new Set(docs.map((d) => d.type.toUpperCase()));

    const missingTypes = REQUIRED_DOCUMENT_TYPES.filter((t) => !uploadedTypes.has(t));
    const expiredTypes = docs.filter((d) => d.isExpired).map((d) => d.type);
    const rejectedTypes = docs
      .filter((d) => d.status === VerificationStatus.REJECTED)
      .map((d) => d.type);
    const pendingTypes = docs
      .filter((d) => d.status === VerificationStatus.PENDING || d.status === VerificationStatus.UNDER_REVIEW)
      .map((d) => d.type);

    const isFullyUploaded = missingTypes.length === 0;
    const isFullyVerified =
      isFullyUploaded &&
      docs.every((d) => d.status === VerificationStatus.VERIFIED && !d.isExpired);

    let status: VerificationStatus = VerificationStatus.PENDING;
    if (isFullyVerified) {
      status = VerificationStatus.VERIFIED;
    } else if (rejectedTypes.length > 0 || expiredTypes.length > 0) {
      status = VerificationStatus.REJECTED;
    } else if (docs.length > 0) {
      status = VerificationStatus.UNDER_REVIEW;
    }

    return {
      driverProfileId,
      totalRequired: REQUIRED_DOCUMENT_TYPES.length,
      totalUploaded: docs.length,
      isFullyUploaded,
      isFullyVerified,
      status,
      documents: docs,
      missingTypes,
      expiredTypes,
      rejectedTypes,
      pendingTypes,
    };
  }

  /**
   * Synchronizes the overall driver profile verification status based on the status
   * of all required documents (driving license, registration certificate, insurance, pollution).
   */
  async syncDriverVerificationStatus(driverProfileId: string): Promise<VerificationStatus> {
    if (!this.driverRepo) return VerificationStatus.PENDING;

    const summary = await this.getDocumentSummary(driverProfileId);

    if (summary.isFullyVerified) {
      await this.driverRepo.update(driverProfileId, {
        verificationStatus: VerificationStatus.VERIFIED,
        isVerified: true,
      });
      return VerificationStatus.VERIFIED;
    }

    if (summary.rejectedTypes.length > 0 || summary.expiredTypes.length > 0) {
      await this.driverRepo.update(driverProfileId, {
        verificationStatus: VerificationStatus.REJECTED,
        isVerified: false,
        isAvailable: false, // Revoke active ride availability if any document is invalid
      });
      return VerificationStatus.REJECTED;
    }

    if (summary.totalUploaded > 0) {
      await this.driverRepo.update(driverProfileId, {
        verificationStatus: VerificationStatus.UNDER_REVIEW,
        isVerified: false,
        isAvailable: false,
      });
      return VerificationStatus.UNDER_REVIEW;
    }

    await this.driverRepo.update(driverProfileId, {
      verificationStatus: VerificationStatus.PENDING,
      isVerified: false,
      isAvailable: false,
    });
    return VerificationStatus.PENDING;
  }

  /**
   * Scans all documents belonging to a driver to detect any newly expired items.
   */
  async checkAllDriverDocumentsExpiry(
    driverProfileId: string
  ): Promise<{ expiredCount: number; expiredDocuments: string[] }> {
    const docs = await this.docRepo.findByDriverId(driverProfileId);
    const expiredList: string[] = [];

    for (const doc of docs) {
      const isExpired = await this.checkDocumentExpiry(doc.id);
      if (isExpired) {
        expiredList.push(doc.type);
      }
    }

    return {
      expiredCount: expiredList.length,
      expiredDocuments: expiredList,
    };
  }

  async deleteDocument(documentId: string): Promise<Document | null> {
    const doc = typeof (this.docRepo as any).findById === 'function'
      ? await this.docRepo.findById(documentId)
      : null;

    if (!doc && typeof (this.docRepo as any).findById === 'function') {
      throw new NotFoundError(`Document with ID ${documentId} not found`);
    }

    const deleted = typeof (this.docRepo as any).delete === 'function'
      ? await this.docRepo.delete(documentId)
      : doc;

    const driverProfileId = doc?.driverProfileId;
    if (driverProfileId && this.driverRepo) {
      await this.syncDriverVerificationStatus(driverProfileId);
    }
    return deleted || doc || null;
  }
}


