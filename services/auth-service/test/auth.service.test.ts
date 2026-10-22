import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/services/auth.service.js';
import { UserService } from '../src/services/user.service.js';
import { authRedisClient } from '../src/redis/client.js';
import { ServiceUnavailableError, UnauthorizedError } from '@urbanfleet/common';

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
    delete: vi.fn(),
    deleteByUserId: vi.fn()
  };

  const mockAuditRepo: any = {
    record: vi.fn().mockResolvedValue({})
  };

  const mockOutboxRepo: any = {
    stageEvent: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
  };

  let authService: AuthService;
  let userService: UserService;

  beforeEach(() => {
    vi.restoreAllMocks();
    authService = new AuthService(mockUserRepo, mockSessionRepo, mockAuditRepo, mockOutboxRepo);
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

  it('should register a new user and return tokens when Redis and Outbox succeed', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);
    mockUserRepo.create.mockImplementation((data: any) => Promise.resolve({ id: 'u-123', ...data, isEmailVerified: false, roles: ['RIDER'] }));

    const res = await authService.register({
      email: 'newrider@urbanfleet.com',
      password: 'Password@123',
      firstName: 'New',
      lastName: 'Rider',
      roles: ['RIDER']
    });

    expect(res.user.firstName).toBe('New');
    expect(res.user.lastName).toBe('Rider');
    expect(res.user.email).toBe('newrider@urbanfleet.com');
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();
    expect(authRedisClient.set).toHaveBeenCalled();
    expect(mockOutboxRepo.stageEvent).toHaveBeenCalled();
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
      isEmailVerified: false,
    });

    const result = await authService.login({
      email: 'test@urbanfleet.com',
      password: 'Password@123',
    });

    expect(result.requiresOtp).toBe(true);
    expect(result.userId).toBe('u-123');
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
      isEmailVerified: false,
    });
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(false);

    await expect(authService.login({
      email: 'test@urbanfleet.com',
      password: 'Password@123',
    })).rejects.toThrow(ServiceUnavailableError);
  });

  it('should verify login OTP and complete authentication session', async () => {
    mockUserRepo.findById.mockResolvedValue({
      id: 'u-123',
      email: 'test@urbanfleet.com',
      firstName: 'Test',
      lastName: 'User',
      roles: ['RIDER'],
      isEmailVerified: true,
    });
    vi.spyOn(authRedisClient, 'get').mockResolvedValue('849201');

    const result = await authService.verifyLoginOtp({
      userId: 'u-123',
      otp: '849201',
    });

    expect(result.user.id).toBe('u-123');
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(mockSessionRepo.create).toHaveBeenCalled();
    expect(authRedisClient.del).toHaveBeenCalled();
  });

  it('BLOCKING: should reject invalid OTP with UnauthorizedError', async () => {
    mockUserRepo.findById.mockResolvedValue({
      id: 'u-123',
      email: 'test@urbanfleet.com',
      roles: ['RIDER'],
    });
    vi.spyOn(authRedisClient, 'get').mockResolvedValue('849201');

    await expect(authService.verifyLoginOtp({
      userId: 'u-123',
      otp: '999999',
    })).rejects.toThrow(UnauthorizedError);
  });

  it('BLOCKING: should fail with ServiceUnavailableError when Redis throws an unexpected error during verify OTP', async () => {
    mockUserRepo.findById.mockResolvedValue({
      id: 'u-123',
      email: 'test@urbanfleet.com',
      roles: ['RIDER'],
    });
    vi.spyOn(authRedisClient, 'get').mockRejectedValue(new Error('Redis connection timeout'));

    await expect(authService.verifyLoginOtp({
      userId: 'u-123',
      otp: '849201',
    })).rejects.toThrow(ServiceUnavailableError);
  });
});
