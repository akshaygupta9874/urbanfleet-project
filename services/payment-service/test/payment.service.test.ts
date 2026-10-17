import { describe, it, expect, vi } from 'vitest';
import { PaymentService } from '../src/services/payment.service.js';

describe('Payment Service Order Creation & Verification', () => {
  const mockPaymentRepo: any = {
    findByRideId: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  };
  const mockRefundRepo: any = { create: vi.fn() };
  const mockLedgerService: any = { recordPaymentCapture: vi.fn().mockResolvedValue('tx-1') };
  const mockOutboxRepo: any = { stageEvent: vi.fn().mockResolvedValue({}) };

  const paymentService = new PaymentService(mockPaymentRepo, mockRefundRepo, mockLedgerService, mockOutboxRepo);

  it('should idempotently create a payment order for a ride', async () => {
    mockPaymentRepo.findByRideId.mockResolvedValue(null);
    mockPaymentRepo.create.mockImplementation((data: any) => Promise.resolve({ id: 'pay-1', ...data }));

    const order = await paymentService.createOrder('ride-123', 'rider-456', 15000);
    expect(order.rideId).toBe('ride-123');
    expect(order.amountPaise).toBe(15000);
    expect(order.status).toBe('PENDING');
  });

  it('should verify payment signature', async () => {
    const verified = await paymentService.verifyPaymentSignature('pay-1', 'razorpay-p1', 'sig-123');
    expect(verified).toBe(true);
  });
});
