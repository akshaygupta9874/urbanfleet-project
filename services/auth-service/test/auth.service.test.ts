import { describe, it, expect, vi } from 'vitest';
import { AuthService } from '../src/services/auth.service.js';
import { UserService } from '../src/services/user.service.js';
import { TwoFactorService } from '../src/services/two-factor.service.js';

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

  const authService = new AuthService(mockUserRepo, mockSessionRepo, mockAuditRepo);
  const userService = new UserService(mockUserRepo);
  const twoFactorService = new TwoFactorService(mockUserRepo);

  it('should hash passwords deterministically with bcrypt', async () => {
    const hash = await authService.hashPassword('MySecurePassword123');
    expect(hash).toBeDefined();
    expect(await authService.comparePassword('MySecurePassword123', hash)).toBe(true);
    expect(await authService.comparePassword('WrongPassword', hash)).toBe(false);
  });

  it('should register a new user and return tokens', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);
    mockUserRepo.create.mockImplementation((data: any) => Promise.resolve({ id: 'u-123', ...data, isEmailVerified: false }));

    const res = await authService.register({
      email: 'newrider@urbanfleet.com',
      password: 'Password@123',
      fullName: 'New Rider',
      role: 'RIDER'
    });

    expect(res.user.email).toBe('newrider@urbanfleet.com');
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();
  });

  it('should generate a 2FA secret and QR code URL', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u-123', email: 'test@example.com' });
    mockUserRepo.update.mockResolvedValue({});

    const { secret, qrCodeUrl } = await twoFactorService.generateSecret('u-123');
    expect(secret).toBeDefined();
    expect(qrCodeUrl).toContain('data:image/png;base64');
  });
});
