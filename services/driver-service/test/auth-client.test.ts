import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthClient } from '../src/clients/auth.client.js';

describe('AuthClient Inter-Service HTTP Communication in driver-service', () => {
  const originalFetch = globalThis.fetch;
  let client: AuthClient;

  beforeEach(() => {
    client = new AuthClient('http://test-auth-service:4001');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches user details by user ID over HTTP GET API', async () => {
    const mockUser = {
      id: 'usr-123',
      email: 'driver@urbanfleet.com',
      firstName: 'John',
      lastName: 'Driver',
      phone: '+919876543210',
      role: 'DRIVER',
      isEmailVerified: true,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockUser }),
    } as any);

    const result = await client.getUserById('usr-123');
    expect(result).toEqual(mockUser);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test-auth-service:4001/api/auth/users/usr-123',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      })
    );
  });

  it('returns null when user is not found (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const result = await client.getUserById('non-existent-user');
    expect(result).toBeNull();
  });

  it('throws an error when auth service responds with server error (500)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as any);

    await expect(client.getUserById('usr-err')).rejects.toThrow('Auth Service returned HTTP 500');
  });
});
