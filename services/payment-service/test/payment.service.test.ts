import { describe, it, expect, vi } from 'vitest';
import { PaymentService } from '../src/services/payment.service.js';
import { razorpayClient } from '../src/config/razorpay.config.js';
import crypto from 'crypto';

describe('Payment Service Order Creation & Verification', () => {
  const mockPaymentRepo: any = {
    findByRideId: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  };
  const mockRefundRepo: any = { create: vi.fn() };
  const mockLedgerService: any = { recordPaymentCapture: vi.fn().mockResolvedValue('tx-1') };
  const mockOutboxRepo: any = { stageEvent: vi.fn().mockResolvedValue({}) };

  const paymentService = new PaymentService(mockPaymentRepo, mockRefundRepo, mockLedgerService, mockOutboxRepo);

  it('should create a real Razorpay payment order for a ride', async () => {
    mockPaymentRepo.findByRideId.mockResolvedValue(null);
    vi.spyOn(razorpayClient.orders, 'create').mockResolvedValue({ id: 'order_test_123' } as any);
    mockPaymentRepo.create.mockImplementation((data: any) => Promise.resolve({ id: 'pay-1', ...data }));

    const order = await paymentService.createOrder({
      rideId: 'ride-123',
      riderId: 'rider-456',
      amountPaise: 15000,
    });
    expect(order.rideId).toBe('ride-123');
    expect(order.amountPaise).toBe(15000);
    expect(order.gatewayOrderId).toBe('order_test_123');
    expect(order.status).toBe('PENDING');
  });

  it('should cryptographically verify payment signature via HMAC-SHA256', async () => {
    const secret = 'test_secret_123';
    process.env.RAZORPAY_KEY_SECRET = secret;

    const paymentId = 'pay-1';
    const gatewayOrderId = 'order_test_123';
    const gatewayPaymentId = 'pay_gateway_456';

    mockPaymentRepo.findById.mockResolvedValue({
      id: paymentId,
      gatewayOrderId,
      status: 'PENDING'
    });

    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest('hex');

    const verified = await paymentService.verifyPaymentSignature(paymentId, gatewayPaymentId, validSignature);
    expect(verified).toBe(true);

    // Should reject invalid signature
    await expect(
      paymentService.verifyPaymentSignature(paymentId, gatewayPaymentId, 'invalid_hex_signature_here_0000000000000000000000000000000000000000000000000000000000000000')
    ).rejects.toThrow('Invalid payment signature');
  });
});
