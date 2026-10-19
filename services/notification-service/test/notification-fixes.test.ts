import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { initNotificationConsumer } from '../src/consumers/notification.consumer.js';
import { NotificationRepository } from '../src/repositories/notification.repository.js';
import { createNotificationRouter } from '../src/routes/notification.routes.js';
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
        findMany: vi.fn().mockImplementation(async ({ where }: any) => {
          return stagedNotifications.filter((n) => {
            if (where.OR) {
              return where.OR.some((cond: any) => {
                if (cond.recipient && n.recipient === cond.recipient) return true;
                return false;
              });
            }
            if (where.recipient && n.recipient !== where.recipient) return false;
            return true;
          });
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
          firstName: 'Plain',
          lastName: 'User',
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

  describe('Notification Ownership & Query Bounding Suite', () => {
    let app: express.Express;
    let server: http.Server;
    let baseUrl: string;
    const secret = 'test-access-secret-only';

    beforeEach(async () => {
      const repo = new NotificationRepository(mockPrisma);
      (repo as any).prisma = mockPrisma;
      app = express();
      app.use(express.json());
      app.use('/api/notifications', createNotificationRouter(repo));

      server = http.createServer(app);
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as any;
          baseUrl = `http://127.0.0.1:${addr.port}/api/notifications`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (server?.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('GET /my: token without email returns strictly notifications for userId, preventing whole-table scan', async () => {
      stagedNotifications.push(
        { id: 'notif-user-1', recipient: 'usr-bounded-1', status: 'SENT', createdAt: new Date() },
        { id: 'notif-victim', recipient: 'victim@example.com', status: 'SENT', createdAt: new Date() },
        { id: 'notif-other', recipient: 'usr-other', status: 'SENT', createdAt: new Date() }
      );

      const tokenNoEmail = jwt.sign({ userId: 'usr-bounded-1', role: 'RIDER' }, secret);

      const res = await fetch(`${baseUrl}/my`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenNoEmail}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('notif-user-1');
      expect(body.data.some((n: any) => n.id === 'notif-victim')).toBe(false);
    });

    it('GET /my: token for user without notifications returns empty list', async () => {
      stagedNotifications.push({ id: 'notif-1', recipient: 'someone@example.com', status: 'SENT' });

      // Token for user with no matching notifications
      const tokenEmpty = jwt.sign({ userId: 'usr-no-notifications', role: 'RIDER' }, secret);

      const res = await fetch(`${baseUrl}/my`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenEmpty}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('GET /:id: rejects access to another user notification with 403 Forbidden', async () => {
      stagedNotifications.push({
        id: 'notif-confidential-99',
        recipient: 'victim@example.com',
        status: 'SENT',
        payload: { token: 'reset-token-123' },
      });

      const attackerToken = jwt.sign({ userId: 'usr-attacker', email: 'attacker@example.com', role: 'RIDER' }, secret);

      const res = await fetch(`${baseUrl}/notif-confidential-99`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${attackerToken}` },
      });

      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body.code).toBe('FORBIDDEN');
    });

    it('GET /:id: permits recipient by email to view their notification', async () => {
      stagedNotifications.push({
        id: 'notif-user-doc',
        recipient: 'rider@example.com',
        status: 'SENT',
      });

      const ownerToken = jwt.sign({ userId: 'usr-owner', email: 'rider@example.com', role: 'RIDER' }, secret);

      const res = await fetch(`${baseUrl}/notif-user-doc`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('notif-user-doc');
    });

    it('GET /:id: permits recipient by userId to view their notification', async () => {
      stagedNotifications.push({
        id: 'notif-user-by-id',
        recipient: 'usr-direct-id',
        status: 'SENT',
      });

      const ownerToken = jwt.sign({ userId: 'usr-direct-id', role: 'RIDER' }, secret);

      const res = await fetch(`${baseUrl}/notif-user-by-id`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('notif-user-by-id');
    });

    it('GET /:id: permits ADMIN to view any notification', async () => {
      stagedNotifications.push({
        id: 'notif-admin-inspect',
        recipient: 'random@example.com',
        status: 'SENT',
      });

      const adminToken = jwt.sign({ userId: 'admin-id', role: 'ADMIN' }, secret);

      const res = await fetch(`${baseUrl}/notif-admin-inspect`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('notif-admin-inspect');
    });

    it('GET /:id: permits internal service to query notification via x-internal-service-key', async () => {
      stagedNotifications.push({
        id: 'notif-internal-inspect',
        recipient: 'anyone@example.com',
        status: 'SENT',
      });

      const res = await fetch(`${baseUrl}/notif-internal-inspect`, {
        method: 'GET',
        headers: {
          'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || '9fef5ba5e9688b75efee1781b80dad81703c29df93181ab9c474532c3281dd99',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('notif-internal-inspect');
    });
  });
});
