import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService, VerificationStatus } from '../src/services/document.service.js';
import { BadRequestError, NotFoundError } from '@urbanfleet/common';

describe('DocumentService Enterprise Domain Suite', () => {
  let mockDocRepo: any;
  let mockDriverRepo: any;
  let documentService: DocumentService;

  const sampleDriverId = 'drv-uuid-1234';

  beforeEach(() => {
    mockDocRepo = {
      findById: vi.fn(),
      findByDriverId: vi.fn(),
      findByDriverAndType: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateStatus: vi.fn(),
      delete: vi.fn(),
    };

    mockDriverRepo = {
      findById: vi.fn().mockResolvedValue({ id: sampleDriverId, userId: 'usr-1', isVerified: false }),
      update: vi.fn().mockResolvedValue({ id: sampleDriverId }),
    };

    documentService = new DocumentService(mockDocRepo, mockDriverRepo);
  });

  describe('Document Upload & Renewal', () => {
    it('uploads a valid document and initializes it as PENDING', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 180); // 180 days in future
      mockDocRepo.findByDriverAndType.mockResolvedValue(null);
      mockDocRepo.create.mockResolvedValue({
        id: 'doc-1',
        driverProfileId: sampleDriverId,
        type: 'DRIVING_LICENSE',
        documentUrl: 'https://cloudinary.com/dl.jpg',
        expiresAt: futureDate,
        status: VerificationStatus.PENDING,
        isVerified: false,
      });
      mockDocRepo.findByDriverId.mockResolvedValue([]);

      const result = await documentService.uploadDocument({
        driverProfileId: sampleDriverId,
        type: 'DRIVING_LICENSE',
        documentUrl: 'https://cloudinary.com/dl.jpg',
        expiresAt: futureDate,
        number: 'DL-IND-999',
      });

      expect(mockDocRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        driverProfileId: sampleDriverId,
        type: 'DRIVING_LICENSE',
        status: VerificationStatus.PENDING,
      }));
      expect(result.status).toBe(VerificationStatus.PENDING);
    });

    it('rejects document upload if expiresAt is in the past', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10); // 10 days ago

      await expect(
        documentService.uploadDocument({
          driverProfileId: sampleDriverId,
          type: 'INSURANCE',
          documentUrl: 'https://cloudinary.com/ins.jpg',
          expiresAt: pastDate,
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('renews an existing document, updating files and resetting status to PENDING', async () => {
      const existingDoc = {
        id: 'doc-old',
        driverProfileId: sampleDriverId,
        type: 'INSURANCE',
        status: VerificationStatus.REJECTED,
        isVerified: false,
      };
      mockDocRepo.findByDriverAndType.mockResolvedValue(existingDoc);
      mockDocRepo.update.mockResolvedValue({
        ...existingDoc,
        status: VerificationStatus.PENDING,
        documentUrl: 'https://cloudinary.com/new-ins.jpg',
      });
      mockDocRepo.findByDriverId.mockResolvedValue([existingDoc]);

      const updated = await documentService.uploadDocument({
        driverProfileId: sampleDriverId,
        type: 'INSURANCE',
        documentUrl: 'https://cloudinary.com/new-ins.jpg',
      });

      expect(mockDocRepo.update).toHaveBeenCalledWith('doc-old', expect.objectContaining({
        status: VerificationStatus.PENDING,
        isVerified: false,
        rejectionReason: null,
      }));
      expect(updated.status).toBe(VerificationStatus.PENDING);
    });
  });

  describe('Document Verification & State Synchronization', () => {
    it('requires a rejectionReason when rejecting a document', async () => {
      mockDocRepo.findById.mockResolvedValue({
        id: 'doc-1',
        driverProfileId: sampleDriverId,
        type: 'DRIVING_LICENSE',
        status: VerificationStatus.PENDING,
      });

      await expect(
        documentService.verifyDocument('doc-1', VerificationStatus.REJECTED)
      ).rejects.toThrow(BadRequestError);
    });

    it('refuses to verify an expired document', async () => {
      mockDocRepo.findById.mockResolvedValue({
        id: 'doc-1',
        driverProfileId: sampleDriverId,
        type: 'DRIVING_LICENSE',
        expiresAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // Expired yesterday
      });

      await expect(
        documentService.verifyDocument('doc-1', VerificationStatus.VERIFIED)
      ).rejects.toThrow(BadRequestError);
    });

    it('automatically marks driver as VERIFIED when all 4 documents are verified', async () => {
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
      mockDocRepo.findById.mockResolvedValue({
        id: 'doc-4',
        driverProfileId: sampleDriverId,
        type: 'POLLUTION',
        expiresAt: future,
      });
      mockDocRepo.updateStatus.mockResolvedValue({
        id: 'doc-4',
        driverProfileId: sampleDriverId,
        type: 'POLLUTION',
        status: VerificationStatus.VERIFIED,
      });

      // All 4 required documents verified
      mockDocRepo.findByDriverId.mockResolvedValue([
        { id: '1', type: 'DRIVING_LICENSE', status: VerificationStatus.VERIFIED, expiresAt: future },
        { id: '2', type: 'REGISTRATION_CERTIFICATE', status: VerificationStatus.VERIFIED },
        { id: '3', type: 'INSURANCE', status: VerificationStatus.VERIFIED, expiresAt: future },
        { id: '4', type: 'POLLUTION', status: VerificationStatus.VERIFIED, expiresAt: future },
      ]);

      await documentService.verifyDocument('doc-4', VerificationStatus.VERIFIED);

      expect(mockDriverRepo.update).toHaveBeenCalledWith(sampleDriverId, {
        verificationStatus: VerificationStatus.VERIFIED,
        isVerified: true,
      });
    });

    it('demotes driver to REJECTED and disables availability when a document is rejected', async () => {
      mockDocRepo.findById.mockResolvedValue({
        id: 'doc-3',
        driverProfileId: sampleDriverId,
        type: 'INSURANCE',
      });
      mockDocRepo.updateStatus.mockResolvedValue({
        id: 'doc-3',
        driverProfileId: sampleDriverId,
        status: VerificationStatus.REJECTED,
      });

      mockDocRepo.findByDriverId.mockResolvedValue([
        { id: '1', type: 'DRIVING_LICENSE', status: VerificationStatus.VERIFIED },
        { id: '3', type: 'INSURANCE', status: VerificationStatus.REJECTED },
      ]);

      await documentService.verifyDocument('doc-3', VerificationStatus.REJECTED, 'Blurry document scan');

      expect(mockDriverRepo.update).toHaveBeenCalledWith(sampleDriverId, {
        verificationStatus: VerificationStatus.REJECTED,
        isVerified: false,
        isAvailable: false,
      });
    });
  });

  describe('Real Document Expiry Check', () => {
    it('returns true, updates document to REJECTED, and revokes driver availability when expired', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 5); // 5 days expired
      mockDocRepo.findById.mockResolvedValue({
        id: 'doc-exp',
        driverProfileId: sampleDriverId,
        type: 'INSURANCE',
        expiresAt: pastDate,
        status: VerificationStatus.VERIFIED,
      });
      mockDocRepo.findByDriverId.mockResolvedValue([
        { id: 'doc-exp', type: 'INSURANCE', expiresAt: pastDate, status: VerificationStatus.REJECTED },
      ]);

      const isExpired = await documentService.checkDocumentExpiry('doc-exp');

      expect(isExpired).toBe(true);
      expect(mockDocRepo.updateStatus).toHaveBeenCalledWith(
        'doc-exp',
        VerificationStatus.REJECTED,
        expect.stringContaining('Document expired'),
        false
      );
      expect(mockDriverRepo.update).toHaveBeenCalledWith(sampleDriverId, {
        verificationStatus: VerificationStatus.REJECTED,
        isVerified: false,
        isAvailable: false,
      });
    });

    it('returns false when document is still active and valid in the future', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 100);
      mockDocRepo.findById.mockResolvedValue({
        id: 'doc-valid',
        driverProfileId: sampleDriverId,
        type: 'DRIVING_LICENSE',
        expiresAt: futureDate,
        status: VerificationStatus.VERIFIED,
      });

      const isExpired = await documentService.checkDocumentExpiry('doc-valid');
      expect(isExpired).toBe(false);
      expect(mockDocRepo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('Document Summary Calculation', () => {
    it('accurately reports missing, pending, and expired document counts', async () => {
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90);
      const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 2);

      mockDocRepo.findByDriverId.mockResolvedValue([
        { id: '1', type: 'DRIVING_LICENSE', status: VerificationStatus.VERIFIED, expiresAt: future },
        { id: '2', type: 'INSURANCE', status: VerificationStatus.PENDING, expiresAt: past },
      ]);

      const summary = await documentService.getDocumentSummary(sampleDriverId);

      expect(summary.totalRequired).toBe(4);
      expect(summary.totalUploaded).toBe(2);
      expect(summary.missingTypes).toContain('REGISTRATION_CERTIFICATE');
      expect(summary.missingTypes).toContain('POLLUTION');
      expect(summary.expiredTypes).toContain('INSURANCE');
      expect(summary.isFullyVerified).toBe(false);
      expect(summary.status).toBe(VerificationStatus.REJECTED);
    });
  });
});
