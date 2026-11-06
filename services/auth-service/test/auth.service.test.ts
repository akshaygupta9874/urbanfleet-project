import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { AuthService } from '../src/services/auth.service.js';
import { UserService } from '../src/services/user.service.js';
import { authRedisClient } from '../src/redis/client.js';
import { ServiceUnavailableError, UnauthorizedError, ForbiddenError, BadRequestError } from '@urbanfleet/common';

describe('Auth Service Business Logic', () => {
  const mockUserRepo: any = {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn().mockResolvedValue(10)
  };

  const mockSessionRepo: any = {
    create: vi.fn().mockResolvedValue({ id: 'sess-1', version: 1 }),
    delete: vi.fn().mockResolvedValue({}),
    deleteByIdAndUserId: vi.fn().mockResolvedValue({ count: 1 }),
    deleteByUserId: vi.fn().mockResolvedValue({ count: 1 }),
    findById: vi.fn(),
    findByUserId: vi.fn(),
    updateVersion: vi.fn(),
  };

  const mockOutboxRepo: any = {
    stageEvent: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
  };

  let authService: AuthService;
  let userService: UserService;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSessionRepo.create = vi.fn().mockResolvedValue({ id: 'sess-1', version: 1 });
    mockSessionRepo.delete = vi.fn().mockResolvedValue({ id: 'sess-1' });
    mockSessionRepo.deleteByIdAndUserId = vi.fn().mockResolvedValue({ count: 1 });
    mockSessionRepo.deleteByUserId = vi.fn().mockResolvedValue({ count: 1 });
    mockSessionRepo.updateVersion = vi.fn().mockResolvedValue({ id: 'sess-1', version: 2 });
    authService = new AuthService(mockUserRepo, mockSessionRepo, mockOutboxRepo);
    userService = new UserService(mockUserRepo);

    // Mock open redis connection by default
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(authRedisClient, 'set').mockResolvedValue('OK' as any);
    vi.spyOn(authRedisClient, 'get').mockResolvedValue(null as any);
    vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);
  });

  it('should hash passwords deterministically with bcrypt', async () => {
    const hash = await authService.hashPassword('MySecurePassword123');
    expect(hash).toBeDefined();
    expect(await authService.comparePassword('MySecurePassword123', hash)).toBe(true);
    expect(await authService.comparePassword('WrongPassword', hash)).toBe(false);
  });

  it('should register a new user without issuing tokens and staging verification events', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);
    mockUserRepo.create.mockImplementation((data: any) => Promise.resolve({ id: 'u-123', ...data, isEmailVerified: false, roles: ['RIDER'] }));

    const res = await authService.register({
      email: 'newrider@urbanfleet.com',
      password: 'Password@123',
      firstName: 'New',
      lastName: 'Rider',
      roles: ['RIDER'],
      userAgent: 'Mozilla/5.0',
      ipAddress: '127.0.0.1',
    });

    expect(res.user.firstName).toBe('New');
    expect(res.user.lastName).toBe('Rider');
    expect(res.user.email).toBe('newrider@urbanfleet.com');
    expect(res.user.isEmailVerified).toBe(false);
    expect((res as any).accessToken).toBeUndefined();
    expect((res as any).refreshToken).toBeUndefined();
    expect(authRedisClient.set).toHaveBeenCalled();
    expect(mockOutboxRepo.stageEvent).toHaveBeenCalled();
  });

  it('should immediately reject registration when email already exists as DRIVER and attempting to register as RIDER without checking password', async () => {
    const compareSpy = vi.spyOn(authService, 'comparePassword');
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'driver-123',
      email: 'driver@urbanfleet.com',
      passwordHash: 'some-hash',
      firstName: 'Existing',
      lastName: 'Driver',
      roles: ['DRIVER'],
    });

    await expect(authService.register({
      email: 'driver@urbanfleet.com',
      password: 'AnyPassword123!',
      firstName: 'Rider',
      lastName: 'Candidate',
      roles: ['RIDER'],
      userAgent: 'Mozilla/5.0',
      ipAddress: '127.0.0.1',
    })).rejects.toThrow('Email already exists as a driver role. Please go log in as a rider with the correct credentials.');

    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('should reject registration when email already exists with same role', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'rider-123',
      email: 'rider@urbanfleet.com',
      passwordHash: 'some-hash',
      firstName: 'Existing',
      lastName: 'Rider',
      roles: ['RIDER'],
    });

    await expect(authService.register({
      email: 'rider@urbanfleet.com',
      password: 'AnyPassword123!',
      firstName: 'Rider',
      lastName: 'Candidate',
      roles: ['RIDER'],
      userAgent: 'Mozilla/5.0',
      ipAddress: '127.0.0.1',
    })).rejects.toThrow('Email already exists as a rider role. Please go log in with the correct credentials.');
  });

  it('should block login when user email is not verified', async () => {
    const passwordHash = await authService.hashPassword('Password@123');
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'u-123',
      email: 'unverified@urbanfleet.com',
      passwordHash,
      firstName: 'Test',
      lastName: 'User',
      roles: ['RIDER'],
      isEmailVerified: false,
    });

    await expect(authService.login({
      email: 'unverified@urbanfleet.com',
      password: 'Password@123',
    })).rejects.toThrow(ForbiddenError);
  });

  it('BLOCKING: should fail fast with ServiceUnavailableError when Redis is down during registration', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);
    mockUserRepo.create.mockImplementation((data: any) => Promise.resolve({ id: 'u-123', ...data, isEmailVerified: false, roles: ['RIDER'] }));
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(false);

    await expect(authService.register({
      email: 'failedredis@urbanfleet.com',
      password: 'Password@123',
      firstName: 'Failed',
      lastName: 'Redis',
      roles: ['RIDER'],
      userAgent: 'Mozilla/5.0',
      ipAddress: '127.0.0.1',
    })).rejects.toThrow(ServiceUnavailableError);
  });

  it('BLOCKING: should fail fast with ServiceUnavailableError when Outbox staging fails during registration', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);
    mockUserRepo.create.mockImplementation((data: any) => Promise.resolve({ id: 'u-123', ...data, isEmailVerified: false, roles: ['RIDER'] }));
    mockOutboxRepo.stageEvent.mockRejectedValue(new Error('Outbox DB connection pool exhausted'));

    await expect(authService.register({
      email: 'failedoutbox@urbanfleet.com',
      password: 'Password@123',
      firstName: 'Failed',
      lastName: 'Outbox',
      roles: ['RIDER'],
      userAgent: 'Mozilla/5.0',
      ipAddress: '127.0.0.1',
    })).rejects.toThrow(ServiceUnavailableError);
  });

  it('should initiate login with OTP verification requirement and store OTP in Redis', async () => {
    const passwordHash = await authService.hashPassword('Password@123');
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'u-123',
      email: 'test@urbanfleet.com',
      passwordHash,
      firstName: 'Test',
      lastName: 'User',
      roles: ['RIDER'],
      isEmailVerified: true,
    });

    const result = await authService.login({
      email: 'test@urbanfleet.com',
      password: 'Password@123',
    });
    expect(result.email).toBe('test@urbanfleet.com');
    expect(authRedisClient.set).toHaveBeenCalled();
    expect(mockOutboxRepo.stageEvent).toHaveBeenCalled();
  });

  it('BLOCKING: should fail fast with ServiceUnavailableError when Redis is down during login OTP creation', async () => {
    const passwordHash = await authService.hashPassword('Password@123');
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'u-123',
      email: 'test@urbanfleet.com',
      passwordHash,
      firstName: 'Test',
      lastName: 'User',
      roles: ['RIDER'],
      isEmailVerified: true,
    });
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(false);

    await expect(authService.login({
      email: 'test@urbanfleet.com',
      password: 'Password@123',
    })).rejects.toThrow(ServiceUnavailableError);
  });

  it('should verify login OTP and complete authentication session', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'u-123',
      email: 'test@urbanfleet.com',
      firstName: 'Test',
      lastName: 'User',
      roles: ['RIDER'],
      isEmailVerified: true,
    });
    vi.spyOn(authRedisClient, 'get').mockResolvedValue('849201');

    const result = await authService.verifyLoginOtp({
      email: 'test@urbanfleet.com',
      otp: '849201',
    });

    expect(result.user.id).toBe('u-123');
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(mockSessionRepo.create).toHaveBeenCalled();
    expect(authRedisClient.del).toHaveBeenCalled();
  });

  it('BLOCKING: should reject invalid OTP with UnauthorizedError', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'u-123',
      email: 'test@urbanfleet.com',
      roles: ['RIDER'],
      isEmailVerified: true,
    });
    vi.spyOn(authRedisClient, 'get').mockResolvedValue('849201');

    await expect(authService.verifyLoginOtp({
      email: 'test@urbanfleet.com',
      otp: '999999',
    })).rejects.toThrow(UnauthorizedError);
  });

  it('BLOCKING: should fail with ServiceUnavailableError when Redis throws an unexpected error during verify OTP', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'u-123',
      email: 'test@urbanfleet.com',
      roles: ['RIDER'],
      isEmailVerified: true,
    });
    vi.spyOn(authRedisClient, 'get').mockRejectedValue(new Error('Redis connection timeout'));

    await expect(authService.verifyLoginOtp({
      email: 'test@urbanfleet.com',
      otp: '849201',
    })).rejects.toThrow(ServiceUnavailableError);
  });
  it('should list active sessions and accurately flag the current session', async () => {
    const futureDate = new Date(Date.now() + 100000);
    mockSessionRepo.findByUserId.mockResolvedValue([
      { id: 'sess-curr', browser: 'Chrome 122', os: 'Windows 11', deviceType: 'Desktop', ipAddress: '127.0.0.1', lastActiveAt: new Date(), createdAt: new Date(), expiresAt: futureDate },
      { id: 'sess-other', browser: 'Safari 17', os: 'iOS 17', deviceType: 'Mobile', ipAddress: '10.0.0.1', lastActiveAt: new Date(), createdAt: new Date(), expiresAt: futureDate }
    ]);

    const res = await authService.listActiveSessions('u-123', 'sess-curr');
    expect(res.currentSessionId).toBe('sess-curr');
    expect(res.sessions).toHaveLength(2);
    expect(res.sessions[0].isCurrent).toBe(true);
    expect(res.sessions[1].isCurrent).toBe(false);
  });

  it('should throw BadRequestError if currentSessionId is missing or empty when listing active sessions', async () => {
    await expect(authService.listActiveSessions('u-123', '')).rejects.toThrow(BadRequestError);
    await expect(authService.listActiveSessions('u-123', undefined as any)).rejects.toThrow(BadRequestError);
  });

  it('should revoke a specific session and purge it from Redis', async () => {
    mockSessionRepo.findById.mockResolvedValue({ id: 'sess-target', userId: 'u-123' });
    mockSessionRepo.delete.mockResolvedValue({ id: 'sess-target' });

    const res = await authService.revokeSession('u-123', 'sess-target');
    expect(res.success).toBe(true);
    expect(mockSessionRepo.delete).toHaveBeenCalledWith('sess-target');
  });

  it('should revoke all other sessions while preserving current session', async () => {
    mockSessionRepo.deleteByUserId.mockResolvedValue({ count: 3 });

    const res = await authService.revokeAllOtherSessions('u-123', 'sess-curr');
    expect(res.success).toBe(true);
    expect(mockSessionRepo.deleteByUserId).toHaveBeenCalledWith('u-123', 'sess-curr');
  });

  it('should detect refresh token replay attack and terminate compromised session', async () => {
    const { signRefreshToken } = await import('../src/crypto/keys.js');
    const oldToken = signRefreshToken({
      userId: 'u-123',
      sessionId: 'sess-compromised',
      sessionVersion: 1,
    });

    mockSessionRepo.findById.mockResolvedValue({
      id: 'sess-compromised',
      userId: 'u-123',
      version: 3, // Already at version 3! Replaying v1
      expiresAt: new Date(Date.now() + 100000),
    });

    await expect(authService.refreshAccessToken(oldToken)).rejects.toThrow(UnauthorizedError);
    expect(mockSessionRepo.delete).toHaveBeenCalledWith('sess-compromised');
    expect(authRedisClient.del).toHaveBeenCalled();
  });

  it('should delete all cached refresh and access tokens from Redis when version mismatch occurs', async () => {
    const { signRefreshToken } = await import('../src/crypto/keys.js');
    const mismatchedToken = signRefreshToken({
      userId: 'u-123',
      sessionId: 'sess-mismatch',
      sessionVersion: 2,
    });

    mockSessionRepo.findById.mockResolvedValue({
      id: 'sess-mismatch',
      userId: 'u-123',
      version: 5,
      expiresAt: new Date(Date.now() + 100000),
    });

    await expect(authService.refreshAccessToken(mismatchedToken)).rejects.toThrow('Security alert: Token reuse detected. Session terminated.');
    expect(mockSessionRepo.delete).toHaveBeenCalledWith('sess-mismatch');
    expect(authRedisClient.del).toHaveBeenCalledWith(expect.stringContaining('token:access:u-123'));
    expect(authRedisClient.del).toHaveBeenCalledWith(expect.stringContaining('token:refresh:u-123'));
  });

  it('should reject refresh token with 401 when sessionId is missing from payload', async () => {
    const privKey = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString('utf-8');
    const tokenWithoutSessionId = jwt.sign(
      { userId: 'u-123', sessionVersion: 1, tokenType: 'REFRESH' },
      privKey,
      { algorithm: 'RS256', expiresIn: '7d', issuer: 'urbanfleet-auth', audience: 'urbanfleet-api' }
    );

    await expect(authService.refreshAccessToken(tokenWithoutSessionId)).rejects.toThrow('Invalid refresh token');
  });

  it('should reject refresh token with 401 when sessionVersion is missing from payload', async () => {
    const privKey = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString('utf-8');
    const tokenWithoutVersion = jwt.sign(
      { userId: 'u-123', sessionId: 'sess-123', tokenType: 'REFRESH' },
      privKey,
      { algorithm: 'RS256', expiresIn: '7d', issuer: 'urbanfleet-auth', audience: 'urbanfleet-api' }
    );

    await expect(authService.refreshAccessToken(tokenWithoutVersion)).rejects.toThrow('Invalid refresh token');
  });

  it('should reject refresh token with 401 when session in DB has invalid or missing version', async () => {
    const { signRefreshToken } = await import('../src/crypto/keys.js');
    const token = signRefreshToken({
      userId: 'u-123',
      sessionId: 'sess-corrupt',
      sessionVersion: 1,
    });

    mockSessionRepo.findById.mockResolvedValue({
      id: 'sess-corrupt',
      userId: 'u-123',
      version: null, // Corrupt/missing version in DB
      expiresAt: new Date(Date.now() + 100000),
    });

    await expect(authService.refreshAccessToken(token)).rejects.toThrow('Session expired or invalid');
  });

  it('should accurately verify refresh token against claims and Postgres session by sessionId', async () => {
    const { signRefreshToken } = await import('../src/crypto/keys.js');
    const token = signRefreshToken({
      userId: 'u-123',
      sessionId: 'sess-verify-1',
      sessionVersion: 1,
    });

    mockSessionRepo.findById.mockResolvedValue({
      id: 'sess-verify-1',
      userId: 'u-123',
      version: 1,
      expiresAt: new Date(Date.now() + 100000),
    });

    const result = await authService.verifyRefreshToken(token);
    expect(result.valid).toBe(true);
    expect(result.payload.userId).toBe('u-123');
    expect(result.payload.sessionId).toBe('sess-verify-1');
    expect(result.session.id).toBe('sess-verify-1');
  });

  it('should reject verifyRefreshToken when session version has changed', async () => {
    const { signRefreshToken } = await import('../src/crypto/keys.js');
    const token = signRefreshToken({
      userId: 'u-123',
      sessionId: 'sess-verify-2',
      sessionVersion: 1,
    });

    mockSessionRepo.findById.mockResolvedValue({
      id: 'sess-verify-2',
      userId: 'u-123',
      version: 2, // Rotated to 2!
      expiresAt: new Date(Date.now() + 100000),
    });

    await expect(authService.verifyRefreshToken(token)).rejects.toThrow('Session version mismatch');
  });
});