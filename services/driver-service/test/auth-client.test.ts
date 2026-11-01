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
      role: 'DRIVER',
      isEmailVerified: true,
    };

    const getSpy = vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockResolvedValue({
      status: 200,
      data: { success: true, data: mockUser },
    });

    const result = await client.getUserById('usr-123');
    expect(result).toEqual(mockUser);
    expect(getSpy).toHaveBeenCalledWith('/v1/auth/users/usr-123');
  });

  it('returns null when user is not found (404)', async () => {
    const notFoundError = new Error('Request failed with status code 404');
    Object.assign(notFoundError, { isAxiosError: true, response: { status: 404 } });

    vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockRejectedValue(notFoundError);

    const result = await client.getUserById('non-existent-user');
    expect(result).toBeNull();
  });

  it('throws an error when auth service responds with server error (500)', async () => {
    const serverError = new Error('Request failed with status code 500');
    Object.assign(serverError, { isAxiosError: true, response: { status: 500 } });

    vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockRejectedValue(serverError);

    await expect(client.getUserById('usr-err')).rejects.toThrow('Auth Service returned HTTP 500');
  });

  it('requests a driver-role grant from auth service', async () => {
    const postSpy = vi.spyOn(
      (client as unknown as { client: { post: Function } }).client,
      'post'
    ).mockResolvedValue({ status: 200 });

    await client.grantDriverRole('usr-driver-1');

    expect(postSpy).toHaveBeenCalledWith(
      '/v1/auth/internal/users/usr-driver-1/driver-role'
    );
  });

  it('configures x-internal-service-key default header on client', () => {
    const internalKey =
      process.env.INTERNAL_SERVICE_KEY || 'urbanfleet-internal-service-secret';
    const axiosHeaders = (client as any).client.defaults.headers;
    expect(axiosHeaders['x-internal-service-key']).toBe(internalKey);
  });
});
