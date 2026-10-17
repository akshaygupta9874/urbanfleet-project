import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticator } from 'otplib';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { TwoFactorService } from '../src/services/two-factor.service.js';
import { authRedisClient } from '../src/redis/client.js';

describe('TwoFactorService - Enterprise 2FA Architecture', () => {
  let mockUserRepo: any;
  let mockAuditRepo: any;
  let twoFactorService: TwoFactorService;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockUserRepo = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    };

    mockAuditRepo = {
      record: vi.fn().mockResolvedValue({}),
    };

    twoFactorService = new TwoFactorService(mockUserRepo, mockAuditRepo);
  });

  describe('1. initiateSetup()', () => {
    it('generates a pending secret, QR code, and audit event without exposing raw secret or activating 2FA', async () => {
      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        email: 'alice@urbanfleet.com',
        twoFactorEnabled: false,
      });

      const result = await twoFactorService.initiateSetup('usr-100');

      expect(result.qrCodeUrl).toContain('data:image/png;base64');
      expect(result.otpauthUri).toContain('otpauth://totp/UrbanFleet:alice%40urbanfleet.com');
      expect(result.expiresInSeconds).toBe(900);
      expect((result as any).secret).toBeUndefined();

      expect(mockUserRepo.update).toHaveBeenCalledWith('usr-100', expect.objectContaining({
        twoFactorPendingSecret: expect.any(String),
        twoFactorSetupRequestedAt: expect.any(Date),
      }));

      // Ensure 2FA was NOT activated prematurely
      const updatePayload = mockUserRepo.update.mock.calls[0][1];
      expect(updatePayload.twoFactorEnabled).toBeUndefined();

      expect(mockAuditRepo.record).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'usr-100',
        action: '2FA_SETUP_INITIATED',
      }));
    });

    it('throws NotFoundError if user does not exist', async () => {
      mockUserRepo.findById.mockResolvedValue(null);
      await expect(twoFactorService.initiateSetup('unknown')).rejects.toThrow('User not found');
    });
  });

  describe('2. verifyAndEnable()', () => {
    it('throws BadRequestError if there is no pending secret', async () => {
      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorPendingSecret: null,
      });

      await expect(twoFactorService.verifyAndEnable('usr-100', '123456')).rejects.toThrow(
        'No pending 2FA setup found'
      );
    });

    it('throws BadRequestError if setup session has expired (> 15 minutes)', async () => {
      const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000);
      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorPendingSecret: 'JBSWY3DPEHPK3PXP',
        twoFactorSetupRequestedAt: sixteenMinutesAgo,
      });

      await expect(twoFactorService.verifyAndEnable('usr-100', '123456')).rejects.toThrow(
        '2FA setup session has expired'
      );
    });

    it('throws UnauthorizedError if TOTP token does not match pending secret', async () => {
      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorPendingSecret: authenticator.generateSecret(),
        twoFactorSetupRequestedAt: new Date(),
      });

      await expect(twoFactorService.verifyAndEnable('usr-100', '000000')).rejects.toThrow(
        'Invalid 2FA verification code'
      );
    });

    it('activates 2FA, moves pending secret to active, and generates 8 hashed recovery codes', async () => {
      const secret = authenticator.generateSecret();
      const validToken = authenticator.generate(secret);

      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorPendingSecret: secret,
        twoFactorSetupRequestedAt: new Date(),
      });

      const res = await twoFactorService.verifyAndEnable('usr-100', validToken);

      expect(res.success).toBe(true);
      expect(res.recoveryCodes).toHaveLength(8);
      // All recovery codes should be format XXXX-XXXX
      res.recoveryCodes.forEach((code) => {
        expect(code).toMatch(/^[a-f0-9]{4}-[a-f0-9]{4}$/);
      });

      expect(mockUserRepo.update).toHaveBeenCalledWith('usr-100', expect.objectContaining({
        twoFactorEnabled: true,
        twoFactorSecret: secret,
        twoFactorPendingSecret: null,
        twoFactorSetupRequestedAt: null,
        twoFactorRecoveryCodes: expect.any(String),
      }));

      // Verify the recovery codes stored in DB are SHA-256 hashes, not plain text
      const storedRecoveryCodesJson = mockUserRepo.update.mock.calls[0][1].twoFactorRecoveryCodes;
      const storedHashes = JSON.parse(storedRecoveryCodesJson);
      expect(storedHashes).toHaveLength(8);
      storedHashes.forEach((hash: string) => {
        expect(hash).toHaveLength(64); // SHA-256 hex string length
      });

      expect(mockAuditRepo.record).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'usr-100',
        action: '2FA_ENABLED',
      }));
    });
  });

  describe('3. initiateLoginChallenge()', () => {
    it('creates an opaque challenge token in Redis with 300s TTL', async () => {
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
      const setSpy = vi.spyOn(authRedisClient, 'set').mockResolvedValue('OK' as any);

      const challenge = await twoFactorService.initiateLoginChallenge('usr-100', '192.168.1.1');

      expect(challenge.challengeToken).toBeDefined();
      expect(challenge.expiresInSeconds).toBe(300);
      expect(setSpy).toHaveBeenCalledWith(
        expect.stringContaining(challenge.challengeToken),
        expect.stringContaining('"userId":"usr-100"'),
        { EX: 300 }
      );
    });
  });

  describe('4. verifyLoginChallenge() & Brute-Force Rate Limiting', () => {
    const testSecret = authenticator.generateSecret();

    it('throws UnauthorizedError when challenge is expired or not found', async () => {
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
      vi.spyOn(authRedisClient, 'get').mockResolvedValue(null);

      await expect(twoFactorService.verifyLoginChallenge('expired-token', '123456')).rejects.toThrow(
        '2FA challenge has expired or is invalid'
      );
    });

    it('increments attempts on invalid TOTP token and records audit failure', async () => {
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
      vi.spyOn(authRedisClient, 'get').mockResolvedValue(
        JSON.stringify({ userId: 'usr-100', attempts: 1 })
      );
      vi.spyOn(authRedisClient, 'ttl').mockResolvedValue(240);
      const setSpy = vi.spyOn(authRedisClient, 'set').mockResolvedValue('OK' as any);

      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorSecret: testSecret,
      });

      await expect(twoFactorService.verifyLoginChallenge('valid-challenge', '000000')).rejects.toThrow(
        'Invalid 2FA verification code. Attempt 2 of 5.'
      );

      expect(setSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"attempts":2'),
        { EX: 240 }
      );

      expect(mockAuditRepo.record).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'usr-100',
        action: '2FA_LOGIN_FAILED',
      }));
    });

    it('locks out challenge after 5 failed attempts and deletes the challenge', async () => {
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
      vi.spyOn(authRedisClient, 'get').mockResolvedValue(
        JSON.stringify({ userId: 'usr-100', attempts: 5 })
      );
      const delSpy = vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);

      await expect(twoFactorService.verifyLoginChallenge('locked-challenge', '123456')).rejects.toThrow(
        'Too many failed 2FA attempts. Challenge locked.'
      );

      expect(delSpy).toHaveBeenCalled();
      expect(mockAuditRepo.record).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'usr-100',
        action: '2FA_LOCKOUT',
      }));
    });

    it('validates TOTP token, cleans up challenge from Redis, and records successful login', async () => {
      const validCode = authenticator.generate(testSecret);

      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
      vi.spyOn(authRedisClient, 'get').mockResolvedValue(
        JSON.stringify({ userId: 'usr-100', attempts: 0 })
      );
      const delSpy = vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);

      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorSecret: testSecret,
      });

      const user = await twoFactorService.verifyLoginChallenge('valid-challenge', validCode);

      expect(user.id).toBe('usr-100');
      expect(delSpy).toHaveBeenCalled();
      expect(mockAuditRepo.record).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'usr-100',
        action: '2FA_LOGIN_SUCCESS',
      }));
    });
  });

  describe('5. verifyRecoveryCode()', () => {
    const rawRecoveryCode = '4a2b-8c1d';
    const hashedCode = crypto.createHash('sha256').update(rawRecoveryCode).digest('hex');
    const remainingHashedCode = crypto.createHash('sha256').update('9e0f-1a2b').digest('hex');

    it('rejects an invalid recovery code', async () => {
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
      vi.spyOn(authRedisClient, 'get').mockResolvedValue(
        JSON.stringify({ userId: 'usr-100', attempts: 0 })
      );

      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorRecoveryCodes: JSON.stringify([hashedCode, remainingHashedCode]),
      });

      await expect(twoFactorService.verifyRecoveryCode('chall-1', 'wrong-code')).rejects.toThrow(
        'Invalid recovery code'
      );
      expect(mockAuditRepo.record).toHaveBeenCalledWith(expect.objectContaining({
        action: '2FA_RECOVERY_CODE_FAILED',
      }));
    });

    it('consumes a single-use recovery code, updates remaining count in DB, and removes challenge', async () => {
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
      vi.spyOn(authRedisClient, 'get').mockResolvedValue(
        JSON.stringify({ userId: 'usr-100', attempts: 0 })
      );
      const delSpy = vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);

      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorRecoveryCodes: JSON.stringify([hashedCode, remainingHashedCode]),
      });

      const res = await twoFactorService.verifyRecoveryCode('chall-1', rawRecoveryCode);

      expect(res.user.id).toBe('usr-100');
      expect(res.remainingRecoveryCodes).toBe(1);

      // Verify DB now only contains the other recovery code
      expect(mockUserRepo.update).toHaveBeenCalledWith('usr-100', {
        twoFactorRecoveryCodes: JSON.stringify([remainingHashedCode]),
      });

      expect(delSpy).toHaveBeenCalled();
      expect(mockAuditRepo.record).toHaveBeenCalledWith(expect.objectContaining({
        action: '2FA_RECOVERY_CODE_USED',
      }));
    });
  });

  describe('6. disable2FA() with Password Challenge', () => {
    it('throws UnauthorizedError when incorrect password is supplied', async () => {
      const passwordHash = await bcrypt.hash('CorrectPassword123!', 10);
      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorEnabled: true,
        passwordHash,
      });

      await expect(twoFactorService.disable2FA('usr-100', 'WrongPassword')).rejects.toThrow(
        'Incorrect password'
      );
    });

    it('disables 2FA and clears all secrets when valid password is supplied', async () => {
      const passwordHash = await bcrypt.hash('CorrectPassword123!', 10);
      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorEnabled: true,
        passwordHash,
      });

      const res = await twoFactorService.disable2FA('usr-100', 'CorrectPassword123!');

      expect(res.success).toBe(true);
      expect(mockUserRepo.update).toHaveBeenCalledWith('usr-100', {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorSetupRequestedAt: null,
        twoFactorRecoveryCodes: null,
      });
      expect(mockAuditRepo.record).toHaveBeenCalledWith(expect.objectContaining({
        action: '2FA_DISABLED',
      }));
    });
  });

  describe('7. regenerateRecoveryCodes()', () => {
    it('requires password and generates 8 new recovery codes when 2FA is active', async () => {
      const passwordHash = await bcrypt.hash('CorrectPassword123!', 10);
      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-100',
        twoFactorEnabled: true,
        passwordHash,
      });

      const res = await twoFactorService.regenerateRecoveryCodes('usr-100', 'CorrectPassword123!');

      expect(res.recoveryCodes).toHaveLength(8);
      expect(mockUserRepo.update).toHaveBeenCalledWith('usr-100', {
        twoFactorRecoveryCodes: expect.any(String),
      });
      expect(mockAuditRepo.record).toHaveBeenCalledWith(expect.objectContaining({
        action: '2FA_RECOVERY_CODES_REGENERATED',
      }));
    });
  });

  describe('8. is2FARequired() Role Policy', () => {
    it('enforces 2FA for ADMIN and treats it as optional for other roles', () => {
      expect(twoFactorService.is2FARequired('ADMIN')).toBe(true);
      expect(twoFactorService.is2FARequired('RIDER')).toBe(false);
      expect(twoFactorService.is2FARequired('DRIVER')).toBe(false);
    });
  });
});
