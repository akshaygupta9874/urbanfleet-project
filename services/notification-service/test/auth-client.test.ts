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

    const getSpy = vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockResolvedValue({
      status: 200,
      data: { success: true, data: mockUser },
    });

    const user = await client.getUserById('rider-123');
    expect(user).toEqual(mockUser);
    expect(getSpy).toHaveBeenCalledWith('/api/auth/users/rider-123');
  });

  it('handles 404 gracefully by returning null', async () => {
    const notFoundError = new Error('Request failed with status code 404');
    Object.assign(notFoundError, { isAxiosError: true, response: { status: 404 } });

    vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockRejectedValue(notFoundError);

    const user = await client.getUserById('missing');
    expect(user).toBeNull();
  });
});
