import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '../src/services/notification.service.js';

describe('Notification Service Durable Inbox Staging', () => {
  const mockNotifRepo: any = {
    create: vi.fn().mockImplementation((data: any) => Promise.resolve({ id: 'notif-1', ...data })),
    findPending: vi.fn(),
    markDispatched: vi.fn()
  };

  const notifService = new NotificationService(mockNotifRepo);

  it('should stage a ride receipt with deterministic idempotency key', async () => {
    const receipt = await notifService.sendRideReceipt('rider@example.com', {
      rideId: 'ride-999',
      paymentId: 'pay-888',
      amountPaise: 25000
    });

    expect(receipt.recipient).toBe('rider@example.com');
    expect(receipt.idempotencyKey).toBe('receipt_ride-999_pay-888');
    expect(receipt.status).toBe('PENDING');
  });

  it('should stage an email verification request', async () => {
    const verify = await notifService.sendVerificationEmail('user@example.com', 'tok-abc');
    expect(verify.idempotencyKey).toBe('verify_user@example.com_tok-abc');
    expect(verify.channel).toBe('EMAIL');
  });
});
