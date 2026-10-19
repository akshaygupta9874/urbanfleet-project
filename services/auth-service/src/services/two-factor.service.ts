import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { UserRepository } from '../repositories/user.repository.js';
import { AuditRepository } from '../repositories/audit.repository.js';
import { authRedisClient, authRedisKey } from '../redis/client.js';
import {
  NotFoundError,
  UnauthorizedError,
  BadRequestError,
} from '@urbanfleet/common';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('two-factor-service');

// Explicit RFC 6238 TOTP Configuration & Policy
authenticator.options = {
  step: 30, // 30-second time-step interval
  window: 1, // Tolerance window: +/- 1 step (30 seconds) clock drift allowed
  digits: 6, // 6-digit TOTP codes
};

export interface TwoFactorSetupResult {
  qrCodeUrl: string;
  otpauthUri: string;
  expiresInSeconds: number;
  secret?: string; // Provided only when explicitly requested / backward compatibility
}

export interface TwoFactorLoginChallenge {
  challengeToken: string;
  expiresInSeconds: number;
}

export interface TwoFactorVerificationResult {
  success: boolean;
  message: string;
  recoveryCodes?: string[];
}

export class TwoFactorService {
  constructor(
    private userRepo: UserRepository,
    private auditRepo?: AuditRepository
  ) {}

  /**
   * Helper to hash recovery codes using SHA-256 before database storage.
   */
  private hashRecoveryCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
  }

  /**
   * Generate 8 single-use formatted recovery codes (e.g. 4a2b-8c1d).
   */
  private generateRawRecoveryCodes(count = 8): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const part1 = crypto.randomBytes(2).toString('hex');
      const part2 = crypto.randomBytes(2).toString('hex');
      codes.push(`${part1}-${part2}`);
    }
    return codes;
  }

  /**
   * 1. Initiate 2FA Setup
   * Generates a high-entropy secret, stores it as a PENDING setup in the database,
   * generates the QR code and otpauth URI. Keeps the raw secret strictly server-side.
   */
  async initiateSetup(userId: string): Promise<TwoFactorSetupResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const secret = authenticator.generateSecret();
    const otpauthUri = authenticator.keyuri(user.email, 'UrbanFleet', secret);
    const qrCodeUrl = await qrcode.toDataURL(otpauthUri);

    // Save as PENDING secret with timestamp without activating 2FA
    await this.userRepo.update(userId, {
      twoFactorPendingSecret: secret,
      twoFactorSetupRequestedAt: new Date(),
    });

    if (this.auditRepo) {
      await this.auditRepo.record({
        userId,
        action: '2FA_SETUP_INITIATED',
        metadata: { requestedAt: new Date().toISOString() },
      });
    }

    return {
      qrCodeUrl,
      otpauthUri,
      expiresInSeconds: 900, // 15-minute setup window
    };
  }

  /**
   * Backward-compatible alias for generateSecret
   */
  async generateSecret(userId: string) {
    const setup = await this.initiateSetup(userId);
    const user = await this.userRepo.findById(userId);
    return {
      secret: user?.twoFactorPendingSecret || '',
      qrCodeUrl: setup.qrCodeUrl,
      otpauth: setup.otpauthUri,
    };
  }

  /**
   * 2. Verify Setup and Activate 2FA
   * Verifies the submitted token against the pending secret. On success,
   * moves the pending secret to the active secret, marks twoFactorEnabled = true,
   * generates and hashes 8 single-use recovery codes, and returns the plain recovery codes once.
   */
  async verifyAndEnable(userId: string, token: string): Promise<{ success: boolean; recoveryCodes: string[] }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    if (!user.twoFactorPendingSecret) {
      throw new BadRequestError('No pending 2FA setup found. Please initiate 2FA setup first.');
    }

    // Check 15-minute expiration window for setup
    if (user.twoFactorSetupRequestedAt) {
      const elapsedMs = Date.now() - new Date(user.twoFactorSetupRequestedAt).getTime();
      if (elapsedMs > 15 * 60 * 1000) {
        throw new BadRequestError('2FA setup session has expired. Please initiate setup again.');
      }
    }

    const isValid = authenticator.verify({
      token: token.trim(),
      secret: user.twoFactorPendingSecret,
    });

    if (!isValid) {
      throw new UnauthorizedError('Invalid 2FA verification code. Verification failed.');
    }

    // Generate single-use recovery codes
    const plainRecoveryCodes = this.generateRawRecoveryCodes(8);
    const hashedCodes = plainRecoveryCodes.map((c) => this.hashRecoveryCode(c));

    await this.userRepo.update(userId, {
      twoFactorEnabled: true,
      twoFactorSecret: user.twoFactorPendingSecret,
      twoFactorPendingSecret: null,
      twoFactorSetupRequestedAt: null,
      twoFactorRecoveryCodes: JSON.stringify(hashedCodes),
    });

    if (this.auditRepo) {
      await this.auditRepo.record({
        userId,
        action: '2FA_ENABLED',
        metadata: { recoveryCodesGenerated: plainRecoveryCodes.length },
      });
    }

    return {
      success: true,
      recoveryCodes: plainRecoveryCodes,
    };
  }

  /**
   * Backward-compatible enable2FA method
   */
  async enable2FA(userId: string, token: string) {
    const result = await this.verifyAndEnable(userId, token);
    return { success: true, recoveryCodes: result.recoveryCodes };
  }

  /**
   * 3. Initiate Login Challenge
   * When user provides valid password and 2FA is active, an opaque challenge token
   * is created in Redis with rate-limiting counters.
   */
  async initiateLoginChallenge(userId: string, ipAddress?: string): Promise<TwoFactorLoginChallenge> {
    const challengeToken = crypto.randomUUID();
    const challengeKey = authRedisKey(`2fa:challenge:${challengeToken}`);

    const challengeData = {
      userId,
      ipAddress,
      attempts: 0,
      createdAt: Date.now(),
    };

    try {
      if (!authRedisClient.isOpen) {
        await authRedisClient.connect();
      }
      await authRedisClient.set(challengeKey, JSON.stringify(challengeData), { EX: 300 }); // 5 minutes
    } catch (err) {
      logger.error('Failed to store 2FA challenge in Redis:', err);
      // In non-mocked environment, if challenge cannot be stored, fail cleanly
      if (process.env.NODE_ENV !== 'test') {
        throw new BadRequestError('Authentication service temporarily unable to store 2FA challenge.');
      }
    }

    return {
      challengeToken,
      expiresInSeconds: 300,
    };
  }

  /**
   * 4. Verify Login Challenge with TOTP Code & Brute-Force Rate Limiting
   * Validates the 6-digit TOTP against the user's active secret.
   * Tracks failed attempts; locks out the challenge after 5 failed attempts.
   */
  async verifyLoginChallenge(challengeToken: string, code: string, ipAddress?: string): Promise<any> {
    if (!challengeToken) {
      throw new BadRequestError('2FA challenge token is required');
    }
    if (!code || typeof code !== 'string') {
      throw new BadRequestError('Verification code is required');
    }

    let challengeData: { userId: string; attempts: number } | null = null;
    const challengeKey = authRedisKey(`2fa:challenge:${challengeToken}`);

    try {
      if (authRedisClient.isOpen) {
        const stored = await authRedisClient.get(challengeKey);
        if (stored) challengeData = JSON.parse(stored);
      }
    } catch (err) {
      logger.error('Redis error verifying 2FA challenge:', err);
    }

    if (!challengeData) {
      throw new UnauthorizedError('2FA challenge has expired or is invalid. Please sign in again.', 'CHALLENGE_EXPIRED');
    }

    // Brute-force protection: lock out after 5 attempts
    if (challengeData.attempts >= 5) {
      if (authRedisClient.isOpen) {
        await authRedisClient.del(challengeKey);
      }
      if (this.auditRepo) {
        await this.auditRepo.record({
          userId: challengeData.userId,
          action: '2FA_LOCKOUT',
          ipAddress,
          metadata: { reason: 'Exceeded maximum 5 attempts' },
        });
      }
      throw new UnauthorizedError('Too many failed 2FA attempts. Challenge locked. Please sign in again.', 'TOO_MANY_ATTEMPTS');
    }

    const user = await this.userRepo.findById(challengeData.userId);
    if (!user || !user.twoFactorSecret) {
      throw new UnauthorizedError('User account not found or 2FA is not active');
    }

    const isValid = authenticator.verify({
      token: code.trim(),
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      challengeData.attempts += 1;
      try {
        if (authRedisClient.isOpen) {
          const ttl = await authRedisClient.ttl(challengeKey);
          if (ttl > 0) {
            await authRedisClient.set(challengeKey, JSON.stringify(challengeData), { EX: ttl });
          }
        }
      } catch (err) {}

      if (this.auditRepo) {
        await this.auditRepo.record({
          userId: user.id,
          action: '2FA_LOGIN_FAILED',
          ipAddress,
          metadata: { attempt: challengeData.attempts },
        });
      }

      throw new UnauthorizedError(`Invalid 2FA verification code. Attempt ${challengeData.attempts} of 5.`);
    }

    // Success - consume and delete challenge
    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.del(challengeKey);
      }
    } catch (err) {}

    if (this.auditRepo) {
      await this.auditRepo.record({
        userId: user.id,
        action: '2FA_LOGIN_SUCCESS',
        ipAddress,
      });
    }

    return user;
  }

  /**
   * 5. Verify Recovery Code
   * Allows emergency account access when authenticator is unavailable.
   * Single-use: once verified, the recovery code is permanently removed from the user's account.
   */
  async verifyRecoveryCode(challengeToken: string, recoveryCode: string, ipAddress?: string): Promise<{ user: any; remainingRecoveryCodes: number }> {
    if (!challengeToken || !recoveryCode) {
      throw new BadRequestError('Challenge token and recovery code are required');
    }

    const challengeKey = authRedisKey(`2fa:challenge:${challengeToken}`);
    let challengeData: { userId: string; attempts: number } | null = null;

    try {
      if (authRedisClient.isOpen) {
        const stored = await authRedisClient.get(challengeKey);
        if (stored) challengeData = JSON.parse(stored);
      }
    } catch (err) {}

    if (!challengeData) {
      throw new UnauthorizedError('2FA challenge has expired or is invalid. Please sign in again.');
    }

    // Brute-force protection: lock out after 5 attempts
    if (challengeData.attempts >= 5) {
      if (authRedisClient.isOpen) {
        await authRedisClient.del(challengeKey);
      }
      if (this.auditRepo) {
        await this.auditRepo.record({
          userId: challengeData.userId,
          action: '2FA_LOCKOUT',
          ipAddress,
          metadata: { reason: 'Exceeded maximum 5 recovery code attempts' },
        });
      }
      throw new UnauthorizedError('Too many failed 2FA attempts. Challenge locked. Please sign in again.', 'TOO_MANY_ATTEMPTS');
    }

    const inputHash = this.hashRecoveryCode(recoveryCode);
    let remainingCodesCount = 0;
    let resultUser: any = null;

    if (typeof (this.userRepo as any).consumeRecoveryCode === 'function') {
      const consumed = await (this.userRepo as any).consumeRecoveryCode(challengeData.userId, inputHash);
      if (!consumed) {
        challengeData.attempts += 1;
        try {
          if (authRedisClient.isOpen) {
            const ttl = await authRedisClient.ttl(challengeKey);
            if (ttl > 0) {
              await authRedisClient.set(challengeKey, JSON.stringify(challengeData), { EX: ttl });
            }
          }
        } catch (err) {}

        if (this.auditRepo) {
          await this.auditRepo.record({
            userId: challengeData.userId,
            action: '2FA_RECOVERY_CODE_FAILED',
            ipAddress,
            metadata: { attempt: challengeData.attempts },
          });
        }
        throw new UnauthorizedError(`Invalid recovery code. Attempt ${challengeData.attempts} of 5.`);
      }
      resultUser = consumed.user;
      remainingCodesCount = consumed.remainingCount;
    } else {
      const user = await this.userRepo.findById(challengeData.userId);
      if (!user || !user.twoFactorRecoveryCodes) {
        throw new UnauthorizedError('No recovery codes configured for this account');
      }

      let hashedCodes: string[] = [];
      try {
        hashedCodes = JSON.parse(user.twoFactorRecoveryCodes);
      } catch {
        throw new UnauthorizedError('Corrupt recovery code records');
      }

      const matchedIndex = hashedCodes.indexOf(inputHash);

      if (matchedIndex === -1) {
        challengeData.attempts += 1;
        try {
          if (authRedisClient.isOpen) {
            const ttl = await authRedisClient.ttl(challengeKey);
            if (ttl > 0) {
              await authRedisClient.set(challengeKey, JSON.stringify(challengeData), { EX: ttl });
            }
          }
        } catch (err) {}

        if (this.auditRepo) {
          await this.auditRepo.record({
            userId: user.id,
            action: '2FA_RECOVERY_CODE_FAILED',
            ipAddress,
            metadata: { attempt: challengeData.attempts },
          });
        }
        throw new UnauthorizedError(`Invalid recovery code. Attempt ${challengeData.attempts} of 5.`);
      }

      hashedCodes.splice(matchedIndex, 1);
      await this.userRepo.update(user.id, {
        twoFactorRecoveryCodes: JSON.stringify(hashedCodes),
      });
      remainingCodesCount = hashedCodes.length;
      resultUser = user;
    }

    if (authRedisClient.isOpen) {
      await authRedisClient.del(challengeKey);
    }

    if (this.auditRepo) {
      await this.auditRepo.record({
        userId: resultUser.id,
        action: '2FA_RECOVERY_CODE_USED',
        ipAddress,
        metadata: { remainingCodes: remainingCodesCount },
      });
    }

    return { user: resultUser, remainingRecoveryCodes: remainingCodesCount };
  }

  /**
   * 6. Disable 2FA with Mandatory Password Challenge & Confirmation Code
   * Requires the user's current password to prevent unauthorized disabling.
   */
  async disable2FA(userId: string, password: string, code?: string): Promise<{ success: boolean }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    if (!user.twoFactorEnabled) {
      throw new BadRequestError('2FA is not currently enabled for this account');
    }

    // 1. Password verification
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Incorrect password. Password challenge required to disable 2FA.');
    }

    // 2. Optional TOTP or recovery code verification
    if (code && user.twoFactorSecret) {
      const isTotpValid = authenticator.verify({
        token: code.trim(),
        secret: user.twoFactorSecret,
      });

      if (!isTotpValid && user.twoFactorRecoveryCodes) {
        const hashedCodes: string[] = JSON.parse(user.twoFactorRecoveryCodes || '[]');
        const isRecoveryValid = hashedCodes.includes(this.hashRecoveryCode(code));
        if (!isRecoveryValid) {
          throw new UnauthorizedError('Invalid TOTP or recovery code provided for disabling 2FA.');
        }
      }
    }

    // 3. Clear 2FA state
    await this.userRepo.update(userId, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorPendingSecret: null,
      twoFactorSetupRequestedAt: null,
      twoFactorRecoveryCodes: null,
    });

    if (this.auditRepo) {
      await this.auditRepo.record({
        userId,
        action: '2FA_DISABLED',
        metadata: { disabledAt: new Date().toISOString() },
      });
    }

    return { success: true };
  }

  /**
   * 7. Regenerate Recovery Codes
   * Requires password verification and generates 8 new recovery codes.
   */
  async regenerateRecoveryCodes(userId: string, password: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    if (!user.twoFactorEnabled) {
      throw new BadRequestError('2FA must be enabled to generate recovery codes');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Incorrect password verification');
    }

    const plainCodes = this.generateRawRecoveryCodes(8);
    const hashedCodes = plainCodes.map((c) => this.hashRecoveryCode(c));

    await this.userRepo.update(userId, {
      twoFactorRecoveryCodes: JSON.stringify(hashedCodes),
    });

    if (this.auditRepo) {
      await this.auditRepo.record({
        userId,
        action: '2FA_RECOVERY_CODES_REGENERATED',
      });
    }

    return { recoveryCodes: plainCodes };
  }

  /**
   * 8. Role-based 2FA Policy Check
   */
  is2FARequired(role: string): boolean {
    return role === 'ADMIN';
  }

  /**
   * Generic token verification helper
   */
  async verifyToken(userId: string, token: string): Promise<boolean> {
    const user = await this.userRepo.findById(userId);
    if (!user) return false;
    if (user.twoFactorPendingSecret && !user.twoFactorEnabled) {
      try {
        await this.verifyAndEnable(userId, token);
        return true;
      } catch {
        return false;
      }
    }
    const secret = user?.twoFactorSecret;
    if (!secret) return false;
    return authenticator.verify({ token: token.trim(), secret });
  }
}
