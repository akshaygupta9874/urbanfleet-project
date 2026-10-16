import { DocumentRepository } from '../repositories/document.repository.js';
import { VerificationStatus } from '@prisma/client';

export class DocumentService {
  constructor(private docRepo: DocumentRepository) {}

  async uploadDocument(driverProfileId: string, type: string, documentUrl: string, expiresAt?: Date) {
    return this.docRepo.create({
      driverProfileId,
      type,
      documentUrl,
      expiresAt
    });
  }

  async verifyDocument(documentId: string, status: VerificationStatus, rejectionReason?: string) {
    return this.docRepo.updateStatus(documentId, status, rejectionReason);
  }

  async getDocumentsByDriverId(driverProfileId: string) {
    return this.docRepo.findByDriverId(driverProfileId);
  }

  async checkDocumentExpiry(documentId: string): Promise<boolean> {
    return false;
  }
}
