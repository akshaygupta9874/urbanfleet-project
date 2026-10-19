import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthClient } from '../src/clients/auth.client.js';

describe('AuthClient Inter-Service HTTP Communication in notification-service', () => {
  const originalFetch = globalThis.fetch;
  let client: AuthClient;

  beforeEach(() => {
    client = new AuthClient('http://test-auth-service:4001');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches recipient user email by rider ID over HTTP GET API', async () => {
    const mockUser = {
      id: 'rider-123',
      email: 'john.rider@example.com',
      firstName: 'John',
      lastName: 'Rider',
      role: 'RIDER',
      isEmailVerified: true,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockUser }),
    } as any);

    const user = await client.getUserById('rider-123');
    expect(user).toEqual(mockUser);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test-auth-service:4001/api/auth/users/rider-123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          'x-internal-service-key': expect.any(String),
        }),
      })
    );
  });

  it('handles 404 gracefully by returning null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const user = await client.getUserById('missing');
    expect(user).toBeNull();
  });
});
