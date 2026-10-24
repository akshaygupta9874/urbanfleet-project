import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/services/auth.service.js';
import { UserService } from '../src/services/user.service.js';
import { authRedisClient } from '../src/redis/client.js';
import { ServiceUnavailableError, UnauthorizedError, ForbiddenError } from '@urbanfleet/common';

describe('Auth Service Business Logic', () => {
  const mockUserRepo: any = {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn().mockResolvedValue(10)
  };

  const mockSessionRepo: any = {
    create: vi.fn().mockResolvedValue({ id: 'sess-1' }),
    findByToken: vi.fn(),
    delete: vi.fn().mockResolvedValue({}),
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
    mockSessionRepo.create = vi.fn().mockResolvedValue({ id: 'sess-1' });
    mockSessionRepo.delete = vi.fn().mockResolvedValue({ id: 'sess-1' });
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
  });
});