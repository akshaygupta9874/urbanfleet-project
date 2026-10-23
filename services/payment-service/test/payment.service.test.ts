import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/redis/redis-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(async () => {}),
}));

import { PaymentService } from '../src/services/payment.service.js';
import { razorpayClient } from '../src/config/razorpay.config.js';
import { rideClient } from '../src/clients/ride.client.js';
import { paymentRepository } from '../src/repositories/payment.repository.js';
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
    const validRide = {
      id: 'ride-123',
      riderId: 'rider-456',
      driverId: 'driver-789',
      status: 'ARRIVED_AT_DESTINATION',
      paymentStatus: 'PENDING',
      fare: {
        breakdown: {
          baseFarePaise: 5000,
          distanceFarePaise: 5000,
          timeFarePaise: 5000,
          surgePaise: 0,
          platformCommissionPaise: 3000,
          driverEarningPaise: 12000,
          totalPaise: 15000,
        }
      }
    };

    vi.spyOn(rideClient, 'getRideById').mockResolvedValue(validRide as any);
    vi.spyOn(paymentRepository, 'findRideById').mockResolvedValue(validRide as any);
    vi.spyOn(paymentRepository, 'findByRide').mockResolvedValue([]);
    vi.spyOn(paymentRepository, 'findByIdempotencyKey').mockResolvedValue(null);
    vi.spyOn(razorpayClient.orders, 'create').mockResolvedValue({ id: 'order_test_123' } as any);
    vi.spyOn(paymentRepository, 'transaction').mockImplementation(async (cb: any) => {
      return cb({
        ride: {
          findUnique: vi.fn().mockResolvedValue(validRide)
        }
      });
    });
    vi.spyOn(paymentRepository, 'create').mockImplementation((data: any) => Promise.resolve({ id: 'pay-1', ...data }));
    vi.spyOn(paymentRepository, 'setGatewayOrderId').mockImplementation(async (_id: any, gatewayOrderId: string) => ({
      id: 'pay-1',
      rideId: 'ride-123',
      amountPaise: 15000,
      gatewayOrderId,
      status: 'PENDING'
    } as any));

    const order: any = await paymentService.createOrder({
      rideId: 'ride-123',
      riderId: 'rider-456',
      amountPaise: 15000,
    });
    expect(order.paymentId).toBe('pay-1');
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
