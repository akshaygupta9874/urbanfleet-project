import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import axios, { isAxiosError } from 'axios';
import { UserRepository } from '../repositories/user.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { AuditRepository } from '../repositories/audit.repository.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../crypto/keys.js';
import { ConflictError, UnauthorizedError, NotFoundError, BadRequestError, createLogger } from '@urbanfleet/common';
import { Role } from '../db/client.js';
import { cacheTokens, revokeCachedTokens } from '../redis/token-cache.js';
import { authRedisClient, authRedisKey } from '../redis/client.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import { EventTopics } from '@urbanfleet/contracts';
import {
  publishUserRegistered,
  publishPasswordResetRequested,
  publishEmailVerificationRequested,
} from '../events/auth.publisher.js';

const logger = createLogger('auth-service');

export class AuthService {
  private userRepo: UserRepository;
  private sessionRepo: SessionRepository;
  private auditRepo: AuditRepository;
  private outboxRepo?: OutboxRepository;

  constructor(
    userRepo: UserRepository,
    sessionRepo: SessionRepository,
    auditRepo: AuditRepository,
    outboxRepo?: OutboxRepository
  ) {
    this.userRepo = userRepo;
    this.sessionRepo = sessionRepo;
    this.auditRepo = auditRepo;
    this.outboxRepo = outboxRepo;
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async register(input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    role?: Role | 'RIDER' | 'DRIVER' | 'ADMIN';
    roles?: Array<Role | 'RIDER' | 'DRIVER' | 'ADMIN'>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const existing = await this.userRepo.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('A user with this email address already exists');
    }

    const firstName = input.firstName || 'User';
    const lastName = input.lastName || '';
    const role =
      (input.role as Role) ||
      (input.roles && input.roles.length > 0 ? (input.roles[0] as Role) : undefined) ||
      ('RIDER' as Role);

    const passwordHash = await this.hashPassword(input.password);
    const user = await this.userRepo.create({
      email: input.email,
      passwordHash,
      firstName,
      lastName,
      phone: input.phone,
      role,
    });

    const userRoles = (user.role === 'DRIVER' ? ['DRIVER', 'RIDER'] : [user.role]) as Role[];
    const sessionId = crypto.randomUUID();
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      roles: userRoles,
      firstName: user.firstName,
      lastName: user.lastName,
      sessionId,
      tokenType: 'ACCESS',
    });
    const refreshToken = signRefreshToken({ userId: user.id, sessionId, tokenType: 'REFRESH' });

    const session = await this.sessionRepo.create({
      id: sessionId,
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent ? input.userAgent.slice(0, 1000) : undefined
    });

    // Cache tokens in Redis for fast access
    await cacheTokens(user.id, session.id, accessToken, refreshToken);

    // Record audit log
    await this.auditRepo.record({
      userId: user.id,
      action: 'USER_REGISTERED',
      ipAddress: input.ipAddress
    });

    // Generate authentic email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    try {
      if (authRedisClient && authRedisClient.isOpen) {
        await authRedisClient.set(authRedisKey(`verify:${verifyToken}`), user.id, { EX: 86400 });
      }
    } catch (err) {
      // Redis optional during unit tests
    }

    const registrationEventId = crypto.randomUUID();

    // Durable Outbox event staging
    if (this.outboxRepo) {
      try {
        await this.outboxRepo.stageEvent(null, {
          topic: EventTopics.AUTH_EVENTS,
          partitionKey: user.id,
          eventType: 'USER_REGISTERED',
          aggregateType: 'USER',
          aggregateId: user.id,
          payload: {
            id: registrationEventId,
            version: 1,
            eventType: 'USER_REGISTERED',
            producer: 'auth-service',
            timestamp: new Date().toISOString(),
            partitionKey: user.id,
            aggregateType: 'USER',
            aggregateId: user.id,
            aggregateSequence: 1,
            payload: {
              userId: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              phone: user.phone || undefined,
              role: user.role,
              verifyToken,
            },
          },
        });

        // Stage email verification requested event for notification-service
        await this.outboxRepo.stageEvent(null, {
          topic: EventTopics.AUTH_EVENTS,
          partitionKey: user.id,
          eventType: 'USER_EMAIL_VERIFICATION_REQUESTED',
          aggregateType: 'USER',
          aggregateId: user.id,
          payload: {
            id: crypto.randomUUID(),
            version: 1,
            eventType: 'USER_EMAIL_VERIFICATION_REQUESTED',
            producer: 'auth-service',
            timestamp: new Date().toISOString(),
            partitionKey: user.id,
            aggregateType: 'USER',
            aggregateId: user.id,
            aggregateSequence: 2,
            payload: {
              userId: user.id,
              email: user.email,
              verifyToken,
            },
          },
        });
      } catch (err) {
        logger.error('Failed to stage outbox event for registration:', err);
      }
    }

    // Emit Kafka event asynchronously using matching event ID
    await publishUserRegistered(
      {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone || undefined,
        role: user.role,
      },
      registrationEventId
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: userRoles,
        roles: userRoles,
        isEmailVerified: user.isEmailVerified
      },
      accessToken,
      refreshToken
    };
  }

  async login(input: { email: string; password: string; ipAddress?: string; userAgent?: string }) {
    const user = await this.userRepo.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await this.comparePassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Admin 2FA Policy: Admins must complete 2FA setup before full system access
    if (user.role === 'ADMIN' && !user.twoFactorEnabled) {
      return {
        requires2FASetup: true,
        userId: user.id,
      };
    }

    if (user.twoFactorEnabled) {
      return {
        requires2FA: true,
        userId: user.id
      };
    }

    const firstName = user.firstName || 'User';
    const lastName = user.lastName || '';

    const userRoles = (user.role === 'DRIVER' ? ['DRIVER', 'RIDER'] : [user.role]) as Role[];
    const sessionId = crypto.randomUUID();
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      roles: userRoles,
      firstName,
      lastName,
      sessionId,
      tokenType: 'ACCESS',
    });
    const refreshToken = signRefreshToken({ userId: user.id, sessionId, tokenType: 'REFRESH' });

    const session = await this.sessionRepo.create({
      id: sessionId,
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent ? input.userAgent.slice(0, 1000) : undefined
    });

    // Cache tokens in Redis for fast access
    await cacheTokens(user.id, session.id, accessToken, refreshToken);

    await this.auditRepo.record({
      userId: user.id,
      action: 'USER_LOGIN',
      ipAddress: input.ipAddress
    });

    return {
      requires2FA: false,
      user: {
        id: user.id,
        email: user.email,
        firstName,
        lastName,
        role: userRoles,
        roles: userRoles,
        isEmailVerified: user.isEmailVerified,
      },
      accessToken,
      refreshToken
    };
  }

  async complete2FALogin(user: { id: string; email: string; role: Role; firstName?: string; lastName?: string }, ipAddress?: string, userAgent?: string) {
    const firstName = user.firstName || 'User';
    const lastName = user.lastName || '';

    const sessionId = crypto.randomUUID();
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      roles: [user.role],
      firstName,
      lastName,
      sessionId,
      tokenType: 'ACCESS',
    });
    const refreshToken = signRefreshToken({ userId: user.id, sessionId, tokenType: 'REFRESH' });

    const session = await this.sessionRepo.create({
      id: sessionId,
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress,
      userAgent
    });

    await cacheTokens(user.id, session.id, accessToken, refreshToken);

    await this.auditRepo.record({
      userId: user.id,
      action: 'USER_LOGIN_2FA',
      ipAddress
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName,
        lastName,
        role: [user.role],
        roles: [user.role]
      },
      accessToken,
      refreshToken
    };
  }

  async logout(refreshToken: string) {
    const session = await this.sessionRepo.findByToken(refreshToken);
    if (session) {
      await this.sessionRepo.delete(session.id);
      await revokeCachedTokens(session.userId, session.id);
    }
    return { success: true };
  }

  async refreshAccessToken(refreshToken: string) {
    const session = await this.sessionRepo.findByToken(refreshToken);
    if (!session || new Date() > session.expiresAt) {
      throw new UnauthorizedError('Refresh token expired or invalid');
    }

    const user = await this.userRepo.findById(session.userId);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    const firstName = user.firstName || 'User';
    const lastName = user.lastName || '';

    const userRoles = (user.role === 'DRIVER' ? ['DRIVER', 'RIDER'] : [user.role]) as Role[];
    const newSessionId = crypto.randomUUID();
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      roles: userRoles,
      firstName,
      lastName,
      sessionId: newSessionId,
      tokenType: 'ACCESS',
    });

    const newRefreshToken = signRefreshToken({
      userId: user.id,
      sessionId: newSessionId,
      tokenType: 'REFRESH',
    });

    // Delete old session and revoke its cache
    await this.sessionRepo.delete(session.id);
    await revokeCachedTokens(user.id, session.id);

    // Create new session with matching newSessionId
    await this.sessionRepo.create({
      id: newSessionId,
      userId: user.id,
      refreshToken: newRefreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: session.ipAddress || undefined,
      userAgent: session.userAgent || undefined
    });

    // Cache updated tokens in Redis for fast access
    await cacheTokens(user.id, newSessionId, accessToken, newRefreshToken);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName,
        lastName,
        role: userRoles,
        roles: userRoles,
        isEmailVerified: user.isEmailVerified,
      }
    };
  }

  async changePassword(userId: string, oldPass: string, newPass: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const isValid = await this.comparePassword(oldPass, user.passwordHash);
    if (!isValid) throw new UnauthorizedError('Incorrect existing password');

    const passwordHash = await this.hashPassword(newPass);
    await this.userRepo.update(userId, { passwordHash });

    // Revoke all existing sessions and cached tokens
    await this.sessionRepo.deleteByUserId(userId);
    await revokeCachedTokens(userId);
    return { success: true };
  }

  async requestPasswordReset(email: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      return { success: true, message: 'If that email is registered, reset instructions have been sent.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.set(authRedisKey(`reset:${resetToken}`), user.id, { EX: 900 });
      }
    } catch (err) {
      logger.error('Failed to cache reset token in Redis:', err);
    }

    // Publish notification event to Kafka for email dispatch
    await publishPasswordResetRequested({
      userId: user.id,
      email: user.email,
      resetToken,
    });

    return {
      success: true,
      message: 'Password reset instructions dispatched',
      ...(process.env.NODE_ENV !== 'production' ? { resetToken } : {})
    };
  }

  async forgotPassword(email: string) {
    return this.requestPasswordReset(email);
  }

  async resetPassword(token: string, newPass: string) {
    if (!token) throw new UnauthorizedError('Reset token is required');

    let userId: string | null = null;
    try {
      if (authRedisClient.isOpen) {
        userId = await authRedisClient.get(authRedisKey(`reset:${token}`));
      }
    } catch (err) {
      logger.error('Failed to retrieve reset token from Redis:', err);
    }

    if (!userId) {
      throw new UnauthorizedError('Reset token is invalid or has expired');
    }

    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const passwordHash = await this.hashPassword(newPass);
    await this.userRepo.update(userId, { passwordHash });

    // Revoke all existing sessions and cached tokens
    await this.sessionRepo.deleteByUserId(userId);
    await revokeCachedTokens(userId);

    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.del(authRedisKey(`reset:${token}`));
      }
    } catch (err) {
      logger.error('Failed to clean up reset token:', err);
    }

    return { success: true, message: 'Password has been successfully updated' };
  }

  async verifyEmail(token: string) {
    if (!token) throw new UnauthorizedError('Verification token is required');

    let userIdOrData: string | null = null;
    try {
      if (authRedisClient.isOpen) {
        userIdOrData = await authRedisClient.get(authRedisKey(`verify:${token}`));
      }
    } catch (err) {
      logger.error('Failed to retrieve verification token from Redis:', err);
    }

    if (!userIdOrData) {
      throw new UnauthorizedError('Verification token is invalid or has expired');
    }

    let userId = userIdOrData;
    try {
      const parsed = JSON.parse(userIdOrData);
      if (parsed.userId) userId = parsed.userId;
    } catch (_) {}

    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User account not found');

    await this.userRepo.update(userId, { isEmailVerified: true });

    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.del(authRedisKey(`verify:${token}`));
      }
    } catch (err) {}

    return { success: true, message: 'Email verified successfully. Your account is active.' };
  }

  async resendVerificationToken(email: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) throw new NotFoundError('User with this email was not found');
    if (user.isEmailVerified) throw new ConflictError('Email is already verified');

    const verifyToken = crypto.randomBytes(32).toString('hex');
    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.set(authRedisKey(`verify:${verifyToken}`), user.id, { EX: 86400 });
      }
    } catch (err) {
      logger.error('Failed to store verification token in Redis:', err);
    }

    // Publish notification event to Kafka for email dispatch
    await publishEmailVerificationRequested({
      userId: user.id,
      email: user.email,
      verifyToken,
    });

    return {
      success: true,
      message: 'Verification link resent successfully',
      ...(process.env.NODE_ENV !== 'production' ? { verifyToken } : {})
    };
  }

  async verifyAccessToken(token: string) {
    try {
      const decoded = verifyToken(token);
      return { valid: true, payload: decoded };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new UnauthorizedError(`Invalid access token: ${msg}`);
    }
  }

  async verifyRefreshToken(token: string) {
    try {
      const decoded = verifyToken(token);
      const session = await this.sessionRepo.findByToken(token);
      if (!session || new Date() > session.expiresAt) {
        throw new UnauthorizedError('Session has expired or was revoked');
      }
      return { valid: true, payload: decoded, session };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new UnauthorizedError(`Invalid refresh token: ${msg}`);
    }
  }

  async googleAuth(credential: string, ipAddress?: string, userAgent?: string) {
    if (!credential || typeof credential !== 'string') {
      throw new BadRequestError('A Google credential is required');
    }

    // 1. Verify Google ID token via Google TokenInfo API
    let payload: {
      sub: string;
      email: string;
      email_verified: boolean | string;
      name?: string;
      given_name?: string;
      family_name?: string;
      picture?: string;
      aud?: string;
    };
    try {
      const response = await axios.get<{
        sub: string;
        email: string;
        email_verified: boolean | string;
        name?: string;
        given_name?: string;
        family_name?: string;
        picture?: string;
        aud?: string;
      }>(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
        { timeout: 5000 }
      );
      payload = response.data;
    } catch (err: unknown) {
      if (err instanceof UnauthorizedError || err instanceof BadRequestError) {
        throw err;
      }
      if (isAxiosError(err)) {
        logger.warn(`Google token verification failed with status ${err.response?.status}: ${JSON.stringify(err.response?.data || err.message)}`);
        throw new UnauthorizedError('Google could not verify this account');
      }
      logger.error('Error contacting Google OAuth service:', err);
      throw new UnauthorizedError('Google authentication failed');
    }

    // 2. Validate token claims
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (googleClientId && payload.aud && payload.aud !== googleClientId) {
      logger.warn(`Google token audience mismatch: expected ${googleClientId}, got ${payload.aud}`);
      throw new UnauthorizedError('Google credential audience mismatch');
    }

    const isVerified = payload.email_verified === 'true' || payload.email_verified === true;
    if (!payload.sub || !payload.email || !isVerified) {
      throw new UnauthorizedError('Google account email is not verified');
    }

    const email = payload.email.toLowerCase();

    // 3. Find or register user
    let user = await this.userRepo.findByEmail(email);
    let isNewUser = false;
    const registrationEventId = crypto.randomUUID();

    if (!user) {
      isNewUser = true;
      const nameParts = (payload.name?.trim() || '').split(' ');
      const givenName = payload.given_name?.trim() || nameParts[0];
      const familyName = payload.family_name?.trim() || nameParts.slice(1).join(' ');
      const firstName = givenName || 'Google';
      const lastName = familyName || 'User';
      const passwordHash = await this.hashPassword(crypto.randomBytes(32).toString('hex'));

      user = await this.userRepo.create({
        email,
        firstName: firstName.slice(0, 50),
        lastName: lastName.slice(0, 50),
        passwordHash,
        role: 'RIDER' as Role,
        avatarUrl: payload.picture ? String(payload.picture).slice(0, 500) : undefined,
        isEmailVerified: true,
      });

      // Stage durable outbox event for user registration
      if (this.outboxRepo) {
        try {
          await this.outboxRepo.stageEvent(null, {
            topic: EventTopics.AUTH_EVENTS,
            partitionKey: user.id,
            eventType: 'USER_REGISTERED',
            aggregateType: 'USER',
            aggregateId: user.id,
            payload: {
              id: registrationEventId,
              version: 1,
              eventType: 'USER_REGISTERED',
              producer: 'auth-service',
              timestamp: new Date().toISOString(),
              partitionKey: user.id,
              aggregateType: 'USER',
              aggregateId: user.id,
              aggregateSequence: 1,
              payload: {
                userId: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone || undefined,
                role: user.role,
              },
            },
          });
        } catch (err) {
          logger.error('Failed to stage outbox event for Google registration:', err);
        }
      }

      // Publish Kafka user registered event
      await publishUserRegistered(
        {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone || undefined,
          role: user.role,
        },
        registrationEventId
      );
    } else {
      // If user exists and email was not marked verified, verify it now
      if (!user.isEmailVerified) {
        user = await this.userRepo.update(user.id, { isEmailVerified: true });
      }
    }

    const firstName = user.firstName || 'User';
    const lastName = user.lastName || '';

    // 4. Session & Token generation
    const userRoles = (user.role === 'DRIVER' ? ['DRIVER', 'RIDER'] : [user.role]) as Role[];
    const sessionId = crypto.randomUUID();
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      roles: userRoles,
      firstName,
      lastName,
      sessionId,
      tokenType: 'ACCESS',
    });
    const refreshToken = signRefreshToken({ userId: user.id, sessionId, tokenType: 'REFRESH' });

    const session = await this.sessionRepo.create({
      id: sessionId,
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress,
      userAgent: userAgent ? userAgent.slice(0, 1000) : undefined,
    });

    // Cache tokens in Redis
    await cacheTokens(user.id, session.id, accessToken, refreshToken);

    // Audit log
    await this.auditRepo.record({
      userId: user.id,
      action: isNewUser ? 'USER_REGISTERED_GOOGLE' : 'USER_LOGIN_GOOGLE',
      ipAddress,
    });

    const userPayload = {
      id: user.id,
      email: user.email,
      firstName,
      lastName,
      role: userRoles,
      roles: userRoles,
      isEmailVerified: user.isEmailVerified,
      avatarUrl: user.avatarUrl,
    };

    return {
      user: userPayload,
      accessToken,
      refreshToken,
      sessionId,
    };
  }
}

