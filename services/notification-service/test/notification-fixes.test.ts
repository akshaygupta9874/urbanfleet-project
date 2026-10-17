import { describe, expect, it, vi, beforeEach } from 'vitest';
import { initNotificationConsumer } from '../src/consumers/notification.consumer.js';
import { NotificationRepository } from '../src/repositories/notification.repository.js';
import { getRideReceiptHtml } from '../src/services/email.service.js';

const { mockKafkaConsumer, getCapturedHandler } = vi.hoisted(() => {
  let capturedHandler: any = null;
  const consumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation(async ({ eachMessage }: any) => {
      capturedHandler = eachMessage;
    }),
  };
  return {
    mockKafkaConsumer: consumer,
    getCapturedHandler: () => capturedHandler,
  };
});

vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    consumer: () => mockKafkaConsumer,
  })),
}));

describe('Notification Service End-to-End Fixes & Integration Suite', () => {
  let mockPrisma: any;
  let mockNotifService: any;
  let stagedNotifications: any[];
  let processedEvents: any[];

  beforeEach(() => {
    stagedNotifications = [];
    processedEvents = [];

    mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (cb: any) => {
        const tx = {
          processedEvent: {
            findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
              return processedEvents.find((e) => e.eventId === where.eventId_consumerGroup.eventId) || null;
            }),
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              processedEvents.push(data);
              return data;
            }),
          },
          notificationRecord: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              stagedNotifications.push(data);
              return { id: `notif-${stagedNotifications.length}`, ...data };
            }),
            findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
              return stagedNotifications.find((n) => n.id === where.id) || null;
            }),
            update: vi.fn().mockImplementation(async ({ where, data }: any) => {
              const idx = stagedNotifications.findIndex((n) => n.id === where.id);
              if (idx !== -1) {
                stagedNotifications[idx] = { ...stagedNotifications[idx], ...data };
                return stagedNotifications[idx];
              }
              return { id: where.id, ...data };
            }),
            findMany: vi.fn().mockImplementation(async ({ where }: any) => {
              return stagedNotifications.filter((n) => {
                if (where.status && n.status !== where.status) return false;
                return true;
              });
            }),
          },
        };
        return cb(tx);
      }),
      notificationRecord: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          stagedNotifications.push(data);
          return { id: `notif-${stagedNotifications.length}`, ...data };
        }),
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          return stagedNotifications.find((n) => n.id === where.id) || null;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => {
          const idx = stagedNotifications.findIndex((n) => n.id === where.id);
          if (idx !== -1) {
            stagedNotifications[idx] = { ...stagedNotifications[idx], ...data };
            return stagedNotifications[idx];
          }
          return { id: where.id, ...data };
        }),
      },
    };

    mockNotifService = {
      sendVerificationEmail: vi.fn().mockImplementation(async (to: string, token: string) => {
        stagedNotifications.push({ recipient: to, template: 'EMAIL_VERIFICATION', token });
      }),
      sendRideReceipt: vi.fn().mockImplementation(async (to: string, payload: any) => {
        stagedNotifications.push({ recipient: to, template: 'RIDE_RECEIPT', payload });
      }),
    };
  });

  describe('Consumer Event Processing & Real Email Verification Tokens', () => {
    it('processes USER_EMAIL_VERIFICATION_REQUESTED and stages authentic verifyToken', async () => {
      await initNotificationConsumer(mockPrisma, mockNotifService);
      const handler = getCapturedHandler();

      const envelope = {
        id: 'evt-verify-1',
        eventType: 'USER_EMAIL_VERIFICATION_REQUESTED',
        payload: {
          userId: 'usr-123',
          email: 'driver@urbanfleet.com',
          verifyToken: 'authentic-crypto-token-778899',
        },
      };

      await handler({
        message: {
          key: Buffer.from('usr-123'),
          value: Buffer.from(JSON.stringify(envelope)),
        },
      });

      expect(mockNotifService.sendVerificationEmail).toHaveBeenCalledWith(
        'driver@urbanfleet.com',
        'authentic-crypto-token-778899'
      );
      expect(processedEvents).toHaveLength(1);
      expect(processedEvents[0].eventId).toBe('evt-verify-1');
    });

    it('processes USER_PASSWORD_RESET_REQUESTED and stages reset notification', async () => {
      await initNotificationConsumer(mockPrisma, mockNotifService);
      const handler = getCapturedHandler();

      const envelope = {
        id: 'evt-reset-1',
        eventType: 'USER_PASSWORD_RESET_REQUESTED',
        payload: {
          userId: 'usr-456',
          email: 'rider@example.com',
          resetToken: 'reset-token-abc-xyz',
        },
      };

      await handler({
        message: {
          key: Buffer.from('usr-456'),
          value: Buffer.from(JSON.stringify(envelope)),
        },
      });

      expect(stagedNotifications).toHaveLength(1);
      expect(stagedNotifications[0].recipient).toBe('rider@example.com');
      expect(stagedNotifications[0].template).toBe('PASSWORD_RESET');
      expect(stagedNotifications[0].payload.token).toBe('reset-token-abc-xyz');
    });

    it('does not send broken fake token when USER_REGISTERED lacks verifyToken', async () => {
      await initNotificationConsumer(mockPrisma, mockNotifService);
      const handler = getCapturedHandler();

      const envelope = {
        id: 'evt-reg-plain',
        eventType: 'USER_REGISTERED',
        payload: {
          userId: 'usr-789',
          email: 'plain@example.com',
          fullName: 'Plain User',
        },
      };

      await handler({
        message: {
          key: Buffer.from('usr-789'),
          value: Buffer.from(JSON.stringify(envelope)),
        },
      });

      // Does NOT call sendVerificationEmail with dummy 'sample-verification-token'
      expect(mockNotifService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('does not fallback to unrelated rider@urbanfleet.com when user lookup fails for PAYMENT_CAPTURED', async () => {
      await initNotificationConsumer(mockPrisma, mockNotifService);
      const handler = getCapturedHandler();

      const envelope = {
        id: 'evt-pay-unresolvable',
        eventType: 'PAYMENT_CAPTURED',
        payload: {
          paymentId: 'pay-uuid-999',
          rideId: 'ride-uuid-888',
          riderId: 'nonexistent-rider',
          amountPaise: 50000,
        },
      };

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
        } as any);

        await handler({
          message: {
            key: Buffer.from('pay-uuid-999'),
            value: Buffer.from(JSON.stringify(envelope)),
          },
        });

        // Verification: MUST NOT stage email to rider@urbanfleet.com
        expect(mockNotifService.sendRideReceipt).not.toHaveBeenCalledWith(
          'rider@urbanfleet.com',
          expect.anything()
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Terminal FAILED Status on Max Retries', () => {
    it('sets status to FAILED on 5th retry attempt in notification repository', async () => {
      const repo = new NotificationRepository(mockPrisma);
      stagedNotifications.push({
        id: 'notif-retry-1',
        status: 'PENDING',
        retryCount: 4,
      });

      await repo.recordFailure('notif-retry-1', 'SendGrid rate limit exceeded');

      const updated = stagedNotifications.find((n) => n.id === 'notif-retry-1');
      expect(updated.retryCount).toBe(5);
      expect(updated.status).toBe('FAILED');
      expect(updated.lastError).toBe('SendGrid rate limit exceeded');
    });
  });

  describe('Ride Receipt Email Template Generation', () => {
    it('renders clean HTML containing trip details, fare in rupees, and pickup/dropoff', () => {
      const html = getRideReceiptHtml({
        rideId: 'ride-9999',
        paymentId: 'pay-8888',
        amountPaise: 45000,
        pickupAddress: 'Connaught Place, New Delhi',
        dropoffAddress: 'Cyber City, Gurugram',
      });

      expect(html).toContain('ride-9999');
      expect(html).toContain('pay-8888');
      expect(html).toContain('₹450.00');
      expect(html).toContain('Connaught Place, New Delhi');
      expect(html).toContain('Cyber City, Gurugram');
    });
  });
});
