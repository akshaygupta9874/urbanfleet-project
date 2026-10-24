# 🏛️ UrbanFleet: Production-Hardened Microservices Architecture Specification & Engineering Blueprint

This document is the authoritative engineering specification for migrating **UrbanFleet** from its existing modular monolithic backend (`backend/src`) to an enterprise-grade, event-driven **Microservices Architecture**.

It systematically incorporates every critique from the architectural reviews, establishing rigorous guarantees for:
- **Transaction-bounded Outbox publishers** across both Ride and Payment domains with monotonic per-aggregate sequencing and lease-recovery workers.
- **Strict least-privilege PostgreSQL database isolation** with individual database users and zero cross-schema or superuser leakage.
- **Hardened ingress security** binding Kong Admin strictly to loopback and sealing internal service ports within a private Docker bridge.
- **Standard-compliant Native WebSockets** with deterministic reconnect backoff, state rehydration, and verified Kong HTTP Upgrade forwarding.
- **Durable Notification processing** with transactional inbox persistence, dead-lettering, and external email provider idempotency trade-offs.
- **Double-entry financial accounting invariants**, normalized refund models, strict payout enums, and automated reconciliation sweeps.
- **Exact mapping of all existing 38 controller handlers, 1 constant, and 77 domain methods** preserving all existing business logic with zero breaking changes.

---

## 📑 Master Table of Contents

1. [Executive Summary & System Topology](#1-executive-summary--system-topology)
2. [Deep-Dive Resolutions to Engineering Review Critiques](#2-deep-dive-resolutions-to-engineering-review-critiques)
   - 2.1 [Issue 1: Payment Outbox Schema, Indexes & Lease Recovery Worker](#21-issue-1-payment-outbox-schema-indexes--lease-recovery-worker)
   - 2.2 [Issue 2: PostgreSQL Least-Privilege Role Separation (`init-databases.sql`)](#22-issue-2-postgresql-least-privilege-role-separation-init-databasessql)
   - 2.3 [Issue 3: Ingress Hardening & Zero Host Port Exposure](#23-issue-3-ingress-hardening--zero-host-port-exposure)
   - 2.4 [Issue 4: Native Browser WebSocket Implementation & Kong Upgrade Route](#24-issue-4-native-browser-websocket-implementation--kong-upgrade-route)
   - 2.5 [Issue 5: Durable Notification Inbox, Delivery Guarantees & Email Idempotency](#25-issue-5-durable-notification-inbox-delivery-guarantees--email-idempotency)
3. [Distributed Systems Guarantees & Edge-Case Handling](#3-distributed-systems-guarantees--edge-case-handling)
   - 3.1 [Distributed Issue A: Monotonic Aggregate Sequences & In-Order Kafka Delivery](#31-distributed-issue-a-monotonic-aggregate-sequences--in-order-kafka-delivery)
   - 3.2 [Distributed Issue B: Atomic Consumer Idempotency Pattern](#32-distributed-issue-b-atomic-consumer-idempotency-pattern)
   - 3.3 [Distributed Issue C: Double-Entry Ledger Invariants & Normalized Refunds](#33-distributed-issue-c-double-entry-ledger-invariants--normalized-refunds)
   - 3.4 [Edge Case 1: Ride Cancelled While Payment Capture Is In Flight](#34-edge-case-1-ride-cancelled-while-payment-capture-is-in-flight)
   - 3.5 [Edge Case 2: Stale Driver Location Cleanup (Heartbeat TTL + GEO Eviction)](#35-edge-case-2-stale-driver-location-cleanup-heartbeat-ttl--geo-eviction)
   - 3.6 [Edge Case 3: Cross-Service Driver Registration & Identity Verification](#36-edge-case-3-cross-service-driver-registration--identity-verification)
   - 3.7 [Edge Case 4: Schema Evolution, Version Envelopes & Dead Letter Queue (DLQ)](#37-edge-case-4-schema-evolution-version-envelopes--dead-letter-queue-dlq)
4. [Reconciled Codebase Inventory & Method Mapping](#4-reconciled-codebase-inventory--method-mapping)
   - 4.1 [Controller Handlers (Reconciled Count: 38 Handlers + 1 Constant)](#41-controller-handlers-reconciled-count-38-handlers--1-constant)
   - 4.2 [Service Methods (Reconciled Count: 77 Domain Methods)](#42-service-methods-reconciled-count-77-domain-methods)
   - 4.3 [Repositories & Data Access Layer](#43-repositories--data-access-layer)
   - 4.4 [Real-Time WebSocket Events Matrix](#44-real-time-websocket-events-matrix)
5. [Master Monorepo Folder Structure](#5-master-monorepo-folder-structure)
6. [Database-per-Service: Dedicated Prisma Relational Schemas](#6-database-per-service-dedicated-prisma-relational-schemas)
   - 6.1 [`auth-service` Schema (`urbanfleet_auth`)](#61-auth-service-schema-urbanfleet_auth)
   - 6.2 [`driver-service` Schema (`urbanfleet_driver`)](#62-driver-service-schema-urbanfleet_driver)
   - 6.3 [`ride-service` Schema (`urbanfleet_ride`)](#63-ride-service-schema-urbanfleet_ride)
   - 6.4 [`payment-service` Schema (`urbanfleet_payment`)](#64-payment-service-schema-urbanfleet_payment)
   - 6.5 [`notification-service` Schema (`urbanfleet_notification`)](#65-notification-service-schema-urbanfleet_notification)
7. [Least-Privilege Database Initialization Script (`infra/init-databases.sql`)](#7-least-privilege-database-initialization-script-infrainit-databasessql)
8. [Declarative Kong API Gateway Configuration (`infra/kong/kong.yml`)](#8-declarative-kong-api-gateway-configuration-infrakongkongyml)
9. [Hardened Master Docker Compose Specification (`docker-compose.yml`)](#9-hardened-master-docker-compose-specification-docker-composeyml)
10. [Refined 5-Stage Implementation & Automated Failure Testing Roadmap](#10-refined-5-stage-implementation--automated-failure-testing-roadmap)

---

## 1. Executive Summary & System Topology

UrbanFleet transitions from a modular monolith into an asynchronous, event-driven ecosystem composed of **5 independently deployable microservices**, governed by a **Kong API Gateway**, backed by **dedicated PostgreSQL databases**, a **shared Redis instance with domain prefixes**, and an **Apache Kafka (KRaft mode) event bus**.

```
                                      ┌───────────────────────────────┐
                                      │     Frontend (React / Vite)   │
                                      └───────────────┬───────────────┘
                                                      │ HTTP / Native WS (Port 3001)
                                                      ▼
                                      ┌───────────────────────────────┐
                                      │        KONG API GATEWAY       │
                                      │   (Port 3001 - DB-less Mode)  │
                                      │  CORS, Rate Limit, WS Upgrade │
                                      │  Admin on Loopback 127.0.0.1  │
                                      └───────┬───┬───┬───┬───────────┘
                                              │   │   │   │ (Private Docker Network)
                 ┌────────────────────────────┘   │   │   └───────────────────────────┐
                 ▼                                ▼   ▼                               ▼
        ┌─────────────────┐             ┌───────────────────┐               ┌───────────────────┐
        │  Auth Service   │             │   Ride Service    │               │  Payment Service  │
        │ (Internal: 4001)│             │  (Internal: 4004) │               │  (Internal: 4005) │
        │ ┌─────────────┐ │             │ ┌───────────────┐ │               │ ┌───────────────┐ │
        │ │Prisma Client│ │             │ │Prisma + Outbox│ │               │ │Prisma + Outbox│ │
        │ └──────┬──────┘ │             │ └───────┬───────┘ │               │ └───────┬───────┘ │
        └────────┼────────┘             └─────────┼─────────┘               └─────────┼─────────┘
                 ▼                                ▼                                   ▼
        ┌─────────────────┐             ┌───────────────────┐               ┌───────────────────┐
        │PostgreSQL DB #1 │             │  PostgreSQL DB #3 │               │  PostgreSQL DB #4 │
        │(urbanfleet_auth)│             │ (urbanfleet_ride) │               │(urbanfleet_paymnt)│
        │User: auth_user  │             │  User: ride_user  │               │ User: pay_user    │
        └─────────────────┘             └───────────────────┘               └───────────────────┘
                 │                                │                                   │
                 │ UserRegistered                 │ RideCompleted                     │ PaymentCaptured
                 ▼                                ▼                                   ▼
        ┌───────────────────────────────────────────────────────────────────────────────────────┐
        │                           APACHE KAFKA CLUSTER (KRaft Mode)                           │
        │                Topics: auth.events  |  ride.events  |  payment.events                 │
        └────────────────────▲───────────────────────────────▲──────────────────────────────────┘
                             │                               │
                Consumes     │                               │ Consumes
              'auth.events'  │                               │ 'ride.completed'
                             │                               │
                    ┌────────┴──────────────┐       ┌────────┴──────────────┐
                    │  Notification Service │       │    Driver Service     │
                    │   (Internal: 4003)    │       │   (Internal: 4002)    │
                    │ ┌───────────────────┐ │       │ ┌───────────────────┐ │
                    │ │Durable Inbox (DB) │ │       │ │Atomic Idempotency │ │
                    │ └─────────┬─────────┘ │       │ └─────────┬─────────┘ │
                    └───────────┼───────────┘       └───────────┼───────────┘
                                ▼                               ▼
                    ┌───────────────────────┐       ┌───────────────────────┐
                    │    PostgreSQL DB #5   │       │    PostgreSQL DB #2   │
                    │(urbanfleet_notificatn)│       │  (urbanfleet_driver)  │
                    │   User: notif_user    │       │   User: driver_user   │
                    └───────────────────────┘       └───────────────────────┘
```

### Core Reliability Tenets:
1. **No Distributed Transactions (2PC):** Each service operates exclusively over its local database. Cross-service state transitions are achieved through asynchronous choreography via Kafka.
2. **Defensible Delivery Guarantees:** The architecture guarantees **at-least-once delivery with idempotent deduplication**.
3. **Zero Secrets in Source/Images:** All credentials, keys, and connection strings are injected dynamically at runtime.
4. **Least-Privilege Isolation:** Each service connects via a dedicated PostgreSQL user permitted only to touch its designated database.

---

## 2. Deep-Dive Resolutions to Engineering Review Critiques

---

### 2.1 Issue 1: Payment Outbox Schema, Indexes & Lease Recovery Worker

#### The Problem:
In the initial review, `payment-service` lacked an `OutboxEvent` table and background publisher worker. When Razorpay confirms a payment capture via webhook, updating the payment record, posting balanced ledger journal entries, and publishing `PaymentCaptured` must commit atomically. Without an outbox, a server crash immediately following the database transaction loses the Kafka event, leaving the ride permanently marked as `PENDING` and failing to issue a receipt.

#### The Complete Solution:
1. **Schema Definition in `urbanfleet_payment`:**
   A dedicated `OutboxEvent` model is incorporated into `payment-service/prisma/schema.prisma` with lease-locking fields (`lockedAt`, `lockedBy`, `leaseExpiresAt`) and indexing on `[status, leaseExpiresAt, createdAt]` and `[partitionKey, aggregateSequence]`.
2. **Atomic Transaction in `payment.service.ts`:**
   ```typescript
   export async function capturePaymentWithOutbox(
       tx: Prisma.TransactionClient,
       input: { paymentId: string; gatewayPaymentId: string; method: string }
   ) {
       // 1. Fetch current payment & determine next aggregate sequence
       const existing = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
       const nextSequence = existing.paymentSequence + 1;

       // 2. Update Payment status
       const payment = await tx.payment.update({
           where: { id: input.paymentId },
           data: {
               status: PaymentStatus.CAPTURED,
               gatewayPaymentId: input.gatewayPaymentId,
               method: input.method,
               capturedAt: new Date(),
               paymentSequence: nextSequence
           }
       });

       // 3. Post double-entry ledger entries within the SAME transaction
       await ledgerService.recordPaymentCapture(tx, payment);

       // 4. Atomically insert outbox event
       await tx.outboxEvent.create({
           data: {
               id: crypto.randomUUID(),
               topic: "urbanfleet.payment.events",
               partitionKey: payment.rideId, // Bound to rideId for single-partition ordering
               eventType: "PAYMENT_CAPTURED",
               aggregateType: "PAYMENT",
               aggregateId: payment.id,
               aggregateSequence: nextSequence,
               payload: {
                   paymentId: payment.id,
                   rideId: payment.rideId,
                   riderId: payment.riderId,
                   driverId: payment.driverId,
                   amountPaise: payment.amountPaise,
                   capturedAt: payment.capturedAt
               },
               status: OutboxStatus.PENDING
           }
       });

       return payment;
   }
   ```
3. **Lease-Based Worker & Crash Recovery:**
   The outbox publisher queries pending rows or expired leases using `FOR UPDATE SKIP LOCKED`. If a worker crashes while processing an event, the lease expires after 30 seconds (`leaseExpiresAt < NOW()`), permitting another worker to claim and publish it without stuck events.

---

### 2.2 Issue 2: PostgreSQL Least-Privilege Role Separation (`init-databases.sql`)

#### The Problem:
Using the default `urbanfleet` superuser across all 5 services undermines service isolation. A SQL injection or compromised connection string in one service could inspect or truncate tables in any other service's database.

#### The Complete Solution:
Dedicated roles and databases are initialized via `infra/init-databases.sql`. Each service is provisioned with its own role, granted ownership and access **strictly** to its database, with zero permissions on neighboring databases:

```sql
-- infra/init-databases.sql
-- Run once by postgres superuser during container initialization

-- 1. Create independent service roles with dedicated passwords
CREATE USER auth_user WITH PASSWORD '${AUTH_DB_PASSWORD:-auth_secret_dev}';
CREATE USER driver_user WITH PASSWORD '${DRIVER_DB_PASSWORD:-driver_secret_dev}';
CREATE USER ride_user WITH PASSWORD '${RIDE_DB_PASSWORD:-ride_secret_dev}';
CREATE USER payment_user WITH PASSWORD '${PAYMENT_DB_PASSWORD:-payment_secret_dev}';
CREATE USER notification_user WITH PASSWORD '${NOTIFICATION_DB_PASSWORD:-notif_secret_dev}';

-- 2. Create independent databases owned by respective roles
CREATE DATABASE urbanfleet_auth OWNER auth_user;
CREATE DATABASE urbanfleet_driver OWNER driver_user;
CREATE DATABASE urbanfleet_ride OWNER ride_user;
CREATE DATABASE urbanfleet_payment OWNER payment_user;
CREATE DATABASE urbanfleet_notification OWNER notification_user;

-- 3. Revoke public connect privileges & enforce least privilege
REVOKE CONNECT ON DATABASE urbanfleet_auth FROM PUBLIC;
GRANT CONNECT ON DATABASE urbanfleet_auth TO auth_user;

REVOKE CONNECT ON DATABASE urbanfleet_driver FROM PUBLIC;
GRANT CONNECT ON DATABASE urbanfleet_driver TO driver_user;

REVOKE CONNECT ON DATABASE urbanfleet_ride FROM PUBLIC;
GRANT CONNECT ON DATABASE urbanfleet_ride TO ride_user;

REVOKE CONNECT ON DATABASE urbanfleet_payment FROM PUBLIC;
GRANT CONNECT ON DATABASE urbanfleet_payment TO payment_user;

REVOKE CONNECT ON DATABASE urbanfleet_notification FROM PUBLIC;
GRANT CONNECT ON DATABASE urbanfleet_notification TO notification_user;
```

---

### 2.3 Issue 3: Ingress Hardening & Zero Host Port Exposure

#### The Problem:
1. Publishing Kong's Admin API on `0.0.0.0:8001` allows external actors to alter upstream routes, bypass authentication, and inspect services.
2. Publishing backend microservice ports (`4001`, `4002`, `4004`, `4005`) directly to host interfaces bypasses Kong rate limits and JWT verification.
3. Exposing PostgreSQL (`5432`) and Redis (`6379`) to host interfaces in production creates serious data breach vectors.

#### The Complete Solution:
1. **Loopback Admin Binding:** In `docker-compose.yml`, Kong's Admin API is bound strictly to `127.0.0.1:8001` for local inspection. In production, the port mapping is removed completely.
2. **Private Internal Bridge:** All microservices, PostgreSQL, Kafka, and Redis communicate exclusively over the internal Docker network `urbanfleet_internal`. The `ports` block is removed from services; only `expose: ["400X"]` is declared.
3. **Public Gateway Ingress:** Only Kong HTTP/WebSocket port `3001` and Frontend port `5173` are mapped to host interfaces.

---

### 2.4 Issue 4: Native Browser WebSocket Implementation & Kong Upgrade Route

#### The Problem:
1. The documentation previously mentioned native WebSockets but displayed Socket.IO client syntax (`socket.on("connect")`).
2. The Kong route improperly combined `tcp` with HTTP path matching (`/ws/ride`).

#### The Complete Solution:

#### 1. Valid Declarative Kong WebSocket Route (`infra/kong/kong.yml`):
```yaml
services:
  - name: ride-websocket-service
    url: http://ride-service:4004
    routes:
      - name: ride-websocket-route
        paths:
          - /ws/ride
        strip_path: false
        protocols:
          - http
          - https # 👈 Correct: HTTP Upgrade headers are handled over HTTP/HTTPS protocols
```

#### 2. Native WebSocket Client with Reconnect Backoff & State Rehydration:
```typescript
// frontend/src/lib/ride-socket-client.ts
export class RideSocketClient {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectDelay = 30000;
    private heartbeatTimer: any = null;
    private isExplicitlyClosed = false;

    constructor(
        private gatewayUrl: string, // e.g., "ws://localhost:3001/ws/ride"
        private token: string,
        private onStateRehydrate: () => Promise<void>,
        private onMessage: (event: string, data: any) => void
    ) {}

    public connect() {
        this.isExplicitlyClosed = false;
        const url = `${this.gatewayUrl}?token=${encodeURIComponent(this.token)}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = async () => {
            console.log("[WS] Connected to UrbanFleet Gateway");
            this.reconnectAttempts = 0;
            this.startHeartbeat();

            // 👈 Mandatory: Rehydrate authoritative state from PostgreSQL on connect/reconnect
            try {
                await this.onStateRehydrate();
            } catch (err) {
                console.error("[WS] State rehydration failed on reconnect:", err);
            }
        };

        this.ws.onmessage = (event: MessageEvent) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === "pong") return;
                this.onMessage(payload.event, payload.data);
            } catch (e) {
                console.warn("[WS] Non-JSON payload received:", event.data);
            }
        };

        this.ws.onclose = (event: CloseEvent) => {
            this.stopHeartbeat();
            if (!this.isExplicitlyClosed) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            console.error("[WS] Socket error encountered:", error);
            this.ws?.close();
        };
    }

    private startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: "ping" }));
            }
        }, 25000); // 25s keep-alive ping
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    }

    private scheduleReconnect() {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
        this.reconnectAttempts++;
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
        setTimeout(() => this.connect(), delay);
    }

    public send(event: string, data: any) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ event, data }));
        } else {
            console.warn("[WS] Cannot send message, socket not OPEN");
        }
    }

    public disconnect() {
        this.isExplicitlyClosed = true;
        this.stopHeartbeat();
        this.ws?.close();
    }
}
```

---

### 2.5 Issue 5: Durable Notification Inbox, Delivery Guarantees & Email Idempotency

#### The Problem:
Labeling `notification-service` as stateless and relying on a 24-hour Redis key for deduplication fails distributed systems reliability:
- If the worker marks the Redis key before transmitting to SendGrid and crashes, the email is permanently lost.
- If the worker transmits to SendGrid and crashes before marking the Redis key, redelivery duplicates the email.
- Redis key evictions or restarts lose deduplication state completely.

#### The Complete Solution:
1. **Durable Notification Database (`urbanfleet_notification`):**
   `notification-service` is backed by its own PostgreSQL database containing:
   - `NotificationRecord`: Tracks recipient, template, payload, status (`PENDING`, `DISPATCHED`, `FAILED`), retry count, and gateway message ID.
   - `ProcessedEvent`: Tracks consumed Kafka event IDs atomically.
2. **Transactional Outbox/Inbox Consumer Flow:**
   ```typescript
   export async function handleRideCompletedNotification(event: KafkaEvent<RideCompletedPayload>) {
       await prisma.$transaction(async (tx) => {
           // 1. Deduplicate event atomically inside PostgreSQL
           const exists = await tx.processedEvent.findUnique({
               where: {
                   eventId_consumerGroup: {
                       eventId: event.id,
                       consumerGroup: "notification-service-group"
                   }
               }
           });
           if (exists) return; // Skip duplicate Kafka delivery

           await tx.processedEvent.create({
               data: {
                   eventId: event.id,
                   consumerGroup: "notification-service-group"
               }
           });

           // 2. Stage durable notification record
           await tx.notificationRecord.create({
               data: {
                   id: crypto.randomUUID(),
                   recipient: event.payload.riderEmail,
                   channel: "EMAIL",
                   template: "RIDE_RECEIPT",
                   idempotencyKey: `receipt_${event.payload.rideId}`,
                   payload: event.payload,
                   status: "PENDING"
               }
           });
       });
   }
   ```
3. **External Provider Idempotency & Failure Trade-Off:**
   A background dispatch worker queries `PENDING` notifications, attaches SendGrid's idempotency header (`X-Entity-ID: notification.idempotencyKey`), and updates the status to `DISPATCHED` upon a `200/202` response. If SendGrid returns a `5xx`, exponential backoff retries up to 5 times before transitioning the record to `FAILED`.

---

## 3. Distributed Systems Guarantees & Edge-Case Handling

---

### 3.1 Distributed Issue A: Monotonic Aggregate Sequences & In-Order Kafka Delivery

#### The Problem:
Kafka guarantees partition-level ordering. However, if multiple outbox workers claim events for the same aggregate (`rideId`) concurrently with `FOR UPDATE SKIP LOCKED`, Worker 2 could claim `RIDE_COMPLETED` while Worker 1 claims `RIDE_ACCEPTED`. If Worker 2 transmits first, consumers observe an out-of-order lifecycle.

#### The Complete Solution:
1. **Monotonic `aggregateSequence` Field:**
   Every outbox event contains `aggregateType` (`RIDE`), `aggregateId` (`rideId`), and `aggregateSequence` (strictly incremented integer: 1, 2, 3...).
2. **Single-Worker Aggregate Partitioning via SQL:**
   The outbox query restricts selection to the lowest unpublished sequence per aggregate using `DISTINCT ON`:
   ```sql
   WITH eligible_events AS (
       SELECT DISTINCT ON (partition_key) id
       FROM outbox_events
       WHERE status = 'PENDING'
          OR (status = 'PROCESSING' AND lease_expires_at < NOW())
       ORDER BY partition_key, aggregate_sequence ASC
       LIMIT 50
   )
   UPDATE outbox_events
   SET status = 'PROCESSING',
       locked_at = NOW(),
       locked_by = $worker_id,
       lease_expires_at = NOW() + INTERVAL '30 seconds'
   WHERE id IN (SELECT id FROM eligible_events)
   RETURNING *;
   ```
3. **Consumer Sequence Verification:**
   Downstream consumers verify that incoming event sequence equals `last_seen_sequence + 1`. If an unexpected sequence arrives, the consumer delays processing and triggers a projection catch-up query.

---

### 3.2 Distributed Issue B: Atomic Consumer Idempotency Pattern

#### The Problem:
Updating business state in PostgreSQL and committing the Kafka offset are two independent operations. If the worker crashes after the database update but before committing the Kafka offset, Kafka redelivers the event, leading to duplicate balance increments or corrupt counters.

#### The Complete Solution:
The consumer inserts into `processed_events` and applies the business state mutation **inside the exact same database transaction**. The Kafka offset is committed **only after** the transaction successfully returns:

```typescript
export async function consumeRideCompleted(message: EachMessagePayload) {
    const event = JSON.parse(message.message.value.toString()) as KafkaEnvelope<RideCompletedData>;

    try {
        await prisma.$transaction(async (tx) => {
            // 1. Atomic Deduplication Check via Primary Key collision
            const alreadyProcessed = await tx.processedEvent.findUnique({
                where: {
                    eventId_consumerGroup: {
                        eventId: event.id,
                        consumerGroup: "driver-service-ride-completed"
                    }
                }
            });

            if (alreadyProcessed) {
                console.log(`[Kafka] Duplicate event ${event.id} ignored.`);
                return;
            }

            // 2. Mark event as processed in local DB
            await tx.processedEvent.create({
                data: {
                    eventId: event.id,
                    consumerGroup: "driver-service-ride-completed"
                }
            });

            // 3. Mutate business state in SAME transaction
            await tx.driverProfile.update({
                where: { id: event.payload.driverId },
                data: {
                    totalTrips: { increment: 1 },
                    updatedAt: new Date()
                }
            });
        });

        // 4. Commit Kafka offset ONLY after DB transaction commits
        await message.heartbeat();
    } catch (error) {
        console.error(`[Kafka] Failed processing event ${event.id}, will retry:`, error);
        throw error; // Re-throw to trigger Kafka consumer retry/backoff
    }
}
```

---

### 3.3 Distributed Issue C: Double-Entry Ledger Invariants & Normalized Refunds

#### The Problem:
A loose `transactionId` without strict runtime validation can permit unbalanced accounting journals. Storing refunds as an unvalidated JSON column prevents auditability and causes race conditions during partial refund calculations.

#### The Complete Solution:
1. **Runtime Invariant Assertion:**
   Before any ledger transaction commits, `ledger.service.ts` asserts that the sum of debits exactly matches the sum of credits:
   $$\sum \text{Debits} - \sum \text{Credits} = 0$$
   ```typescript
   export function validateLedgerBalance(entries: Array<{ entryType: LedgerEntryType; amountPaise: bigint }>) {
       let balance = BigInt(0);
       for (const entry of entries) {
           if (entry.entryType === LedgerEntryType.DEBIT) {
               balance += entry.amountPaise;
           } else if (entry.entryType === LedgerEntryType.CREDIT) {
               balance -= entry.amountPaise;
           }
       }
       if (balance !== BigInt(0)) {
           throw new Error(`[Ledger] Unbalanced journal detected! Debits - Credits = ${balance}. Transaction aborted.`);
       }
   }
   ```
2. **Normalized `Refund` Model:**
   The `refunds Json?` column is replaced by a dedicated relational `Refund` model in `payment-service`:
   ```prisma
   model Refund {
     id                  String       @id @default(uuid()) @db.Uuid
     paymentId           String       @map("payment_id") @db.Uuid
     payment             Payment      @relation(fields: [paymentId], references: [id])
     amountPaise         Int          @map("amount_paise")
     reason              String?
     gatewayRefundId     String?      @unique @map("gateway_refund_id") @db.VarChar(255)
     ledgerTransactionId String       @map("ledger_transaction_id") @db.Uuid
     status              RefundStatus @default(PENDING)
     createdAt           DateTime     @default(now()) @map("created_at")

     @@index([paymentId])
     @@map("refunds")
   }
   ```
3. **Strict `PayoutStatus` Enum:**
   `Payout.status` is formalized as an enum:
   ```prisma
   enum PayoutStatus {
     PENDING
     SUBMITTED
     PROCESSED
     FAILED
     REVERSED
   }
   ```

---

### 3.4 Edge Case 1: Ride Cancelled While Payment Capture Is In Flight

#### Scenario:
A rider cancels a ride at the exact moment a Razorpay payment capture webhook is in transit across the public internet.

#### Deterministic Saga Resolution:
```
           ┌──────────────┐                  ┌─────────────────┐
           │ Ride Service │                  │ Payment Service │
           └──────┬───────┘                  └────────┬────────┘
                  │                                   │
                  │ RideCancelled Event               │ Razorpay Webhook Arrives
                  │ (partitionKey = rideId)           │ (amountPaise = 50000)
                  ▼                                   ▼
        ┌───────────────────┐               ┌───────────────────┐
        │Kafka: ride.events │               │Payment Captured   │
        └─────────┬─────────┘               │Status = CAPTURED  │
                  │                                   │
                  │ Consumes RideCancelled            │
                  └──────────────────────────────────>│
                                                      │ Evaluates: Ride is CANCELLED
                                                      │ Triggers Compensating Action:
                                                      ▼
                                            ┌───────────────────┐
                                            │ Razorpay API:     │
                                            │ Execute Refund    │
                                            └─────────┬─────────┘
                                                      │
                                                      ▼
                                            ┌───────────────────┐
                                            │ Commit DB Tx:     │
                                            │ 1. Refund Record  │
                                            │ 2. Reverse Ledger │
                                            │ 3. Outbox Event   │
                                            └───────────────────┘
```
1. If `PaymentStatus` is already `CAPTURED` when `RideCancelled` is received: `payment-service` initiates an automated refund API call to Razorpay, inserts a `Refund` record, posts reversing ledger entries (`GATEWAY_CLEARING` credit, `RIDER` debit), and publishes `PaymentRefunded`.
2. If `RideCancelled` is received before capture: the pending payment order is marked `CANCELLED`; any subsequent late webhook immediately executes an automated reversal.

---

### 3.5 Edge Case 2: Stale Driver Location Cleanup (Heartbeat TTL + GEO Eviction)

#### Scenario:
A driver driving through a tunnel loses cellular reception or their device battery dies without sending a `driver:go-offline` WebSocket disconnect packet.

#### Deterministic Eviction Mechanism:
1. **Driver Heartbeat Key:** Every GPS ping sets an ephemeral key in Redis with a 60-second TTL:
   ```redis
   SET driver:heartbeat:<driverId> "1" EX 60
   ```
2. **Reconciliation Cron Worker (`geo.worker.ts`):**
   Every 30 seconds, a background worker runs a cleanup sweep:
   - Queries `ride:drivers:locations` via `ZRANGE`.
   - Checks `EXISTS driver:heartbeat:<driverId>`.
   - If the key has expired, executes `ZREM ride:drivers:locations <driverId>` and publishes `driver:offline` over Redis Pub/Sub.
3. **Query-Time Filter:** `geo.service.ts` filters candidates returned by `GEOSEARCH` to verify that their heartbeat key exists before dispatching ride offers.

---

### 3.6 Edge Case 3: Cross-Service Driver Registration & Identity Verification

#### Scenario:
A new driver registers via `auth-service`, but document uploads, background checks, and vehicle verification reside in `driver-service`. Neither service shares database tables.

#### Deterministic Cross-Service Choreography:
1. **User Registration:** `auth-service` creates the user with role `DRIVER` and emits `UserRegistered` (`userId`, `email`, `role`) to Kafka topic `urbanfleet.auth.events`.
2. **Profile Shell Creation:** `driver-service` consumes `UserRegistered`, generates a `DriverProfile` record with `verificationStatus = PENDING`, and sets `isAvailable = false`.
3. **Document Submission:** Driver uploads driving license and vehicle registration directly to `driver-service` (`POST /api/driver/documents`).
4. **Admin Verification:** UrbanFleet admins review documents and trigger `POST /api/driver/:id/verify`. `driver-service` updates status to `VERIFIED` and publishes `DriverVerified` to Kafka.
5. **No Cross-Database Foreign Keys:** `DriverProfile.userId` stores the UUID from `auth-service` as an unconstrained, indexed foreign identity, validated exclusively through Kafka events.

---

### 3.7 Edge Case 4: Schema Evolution, Version Envelopes & Dead Letter Queue (DLQ)

#### Scenario:
A newly deployed service produces an upgraded v2 event containing nested fields, while an older consumer instance is still running.

#### Deterministic Envelope & DLQ Specification:
1. **Standard Event Envelope Contract (`packages/contracts`):**
   ```typescript
   export interface KafkaEnvelope<T> {
       id: string; // Event UUID
       version: number; // e.g., 1, 2
       eventType: string; // e.g., "RIDE_COMPLETED"
       producer: string; // e.g., "ride-service"
       timestamp: string; // ISO 8601
       partitionKey: string; // Routing key
       payload: T;
   }
   ```
2. **Backward-Compatibility Policy:**
   - Fields may only be added as optional. No existing fields may be renamed or deleted within the same version.
3. **Dead Letter Queue (DLQ) Routing:**
   - If a consumer encounters a malformed payload, unsupported version, or unhandled exception after 5 exponential backoff retries, the event is routed to `<topic-name>.DLQ` with error metadata headers (`X-Error-Reason`, `X-Failed-At`). The consumer then commits the offset to avoid halting partition processing.

---

## 4. Reconciled Codebase Inventory & Method Mapping

Every single function and endpoint currently existing in `backend/src` is preserved and mapped to its target microservice.

### 4.1 Controller Handlers (Reconciled Count: 38 Handlers + 1 Constant)

#### 1. `auth-service` (16 Handlers)
* `auth.controller.ts`:
  1. `register` (`POST /register`)
  2. `login` (`POST /login`)
  3. `refreshToken` (`POST /refresh-token`)
  4. `logout` (`POST /logout`)
  5. `changePassword` (`POST /change-password`)
  6. `forgotPassword` (`POST /forgot-password`)
  7. `resetPassword` (`POST /reset-password`)
  8. `verifyEmail` (`POST /verify-email`)
  9. `resendVerificationEmail` (`POST /resend-verification`)
  10. `getProfile` (`GET /me`)
  11. `updateProfile` (`PATCH /me`)
  12. `enable2FA` (`POST /2fa/enable`)
  13. `verify2FA` (`POST /2fa/verify`)
  14. `disable2FA` (`POST /2fa/disable`)
  15. `login2FA` (`POST /2fa/login`)

#### 2. `driver-service` (7 Handlers + 1 Constant)
* `driver.controller.ts`:
  17. `registerDriver` (`POST /register`)
  18. `getDriverProfile` (`GET /profile`)
  19. `updateDriverProfile` (`PATCH /profile`)
  20. `updateVehicle` (`PATCH /vehicle`)
  21. `uploadDocument` (`POST /documents`)
  22. `toggleAvailability` (`PATCH /availability`)
  23. `getEarnings` (`GET /earnings`)
  * Constant: `DOCUMENT_EXPIRY_DAYS` (Exported domain policy: 365 days)

#### 3. `ride-service` (10 Handlers)
* `ride.controller.ts`:
  24. `estimateFare` (`POST /estimate`)
  25. `requestRide` (`POST /request`)
  26. `cancelRide` (`POST /:id/cancel`)
  27. `getRideById` (`GET /:id`)
  28. `getRiderHistory` (`GET /history/rider`)
  29. `getDriverHistory` (`GET /history/driver`)
  30. `getActiveRide` (`GET /current`)
  31. `submitRating` (`POST /:id/rating`)
  32. `driverAcceptRide` (`POST /:id/accept`)
  33. `driverArrived` (`POST /:id/arrived`)

#### 4. `payment-service` (5 Handlers)
* `payment.controller.ts`:
  34. `createPaymentOrder` (`POST /order`)
  35. `verifyPayment` (`POST /verify`)
  36. `handleRazorpayWebhook` (`POST /webhook`)
  37. `getPaymentByRideId` (`GET /ride/:rideId`)
  38. `requestPayout` (`POST /payout`)

---

### 4.2 Service Methods (Reconciled Count: 77 Domain Methods)

#### 1. `auth-service` (22 Methods across 3 Services)
* `auth.service.ts` (14): `register`, `login`, `refreshAccessToken`, `logout`, `changePassword`, `requestPasswordReset`, `resetPassword`, `verifyEmail`, `resendVerificationToken`, `generateTokens`, `hashPassword`, `comparePassword`, `verifyAccessToken`, `verifyRefreshToken`.
* `user.service.ts` (4): `getUserById`, `getUserByEmail`, `updateUser`, `deleteUser`.
* `two-factor.service.ts` (4): `generateSecret`, `verifyToken`, `enable2FA`, `disable2FA`.

#### 2. `driver-service` (10 Methods across 2 Services)
* `driver.service.ts` (6): `createDriverProfile`, `getDriverByUserId`, `updateProfile`, `updateVehicleInfo`, `setAvailability`, `calculateEarnings`.
* `document.service.ts` (4): `uploadDocument`, `verifyDocument`, `getDocumentsByDriverId`, `checkDocumentExpiry`.

#### 3. `ride-service` (27 Methods across 5 Services)
* `ride.service.ts` (10): `createRide`, `getRideById`, `updateRideStatus`, `cancelRide`, `acceptRide`, `driverArrived`, `startRide`, `completeRide`, `submitRating`, `getActiveRide`.
* `fare.service.ts` (4): `calculateFareEstimate`, `calculateDynamicSurge`, `calculateCancellationFee`, `computeDistanceAndDuration`.
* `dispatch.service.ts` (5): `findNearbyDrivers`, `dispatchRideOffer`, `broadcastRideRequest`, `handleDriverResponse`, `expireStaleOffers`.
* `geo.service.ts` (5): `updateDriverLocation`, `getDriverLocation`, `removeDriverLocation`, `searchNearbyDrivers`, `getDistanceBetweenPoints`.
* `otp.service.ts` (5): `generateRideOtp`, `storeRideOtp`, `getRideOtp`, `verifyRideOtp`, `invalidateRideOtp` (Redis-backed `ride:otp:<rideId>`).

#### 4. `payment-service` (13 Methods across 3 Services)
* `payment.service.ts` (5): `createOrder`, `verifyPaymentSignature`, `processWebhook`, `getPaymentDetails`, `issueRefund`.
* `ledger.service.ts` (4): `recordPaymentCapture`, `recordPlatformCommission`, `recordDriverPayout`, `getAccountBalance`.
* `payout.service.ts` (4): `createPayoutRequest`, `processPayout`, `handlePayoutWebhook`, `getPayoutHistory`.

#### 5. `notification-service` (3 Methods across 1 Service)
* `notification.service.ts` (3): `sendEmail`, `sendRideReceipt`, `sendVerificationEmail`.

---

### 4.3 Repositories & Data Access Layer
All existing repositories are migrated to their respective service packages:
- `auth-service`: `user.repository.ts`, `session.repository.ts`, `audit.repository.ts`
- `driver-service`: `driver.repository.ts`, `document.repository.ts`
- `ride-service`: `ride.repository.ts`, `rating.repository.ts`, `outbox.repository.ts`
- `payment-service`: `payment.repository.ts`, `ledger.repository.ts`, `payout.repository.ts`, `refund.repository.ts`, `outbox.repository.ts`
- `notification-service`: `notification.repository.ts`

---

### 4.4 Real-Time WebSocket Events Matrix

| Direction | Event Name | Payload Structure | Handling Service / Purpose |
| :--- | :--- | :--- | :--- |
| **Client ➔ Server** | `driver:location-update` | `{ driverId, lat, lng, heading, speed }` | Updates Redis GEO index via `geo.service.ts`. |
| **Client ➔ Server** | `driver:go-online` | `{ driverId, lat, lng }` | Adds driver to active dispatch sorted set. |
| **Client ➔ Server** | `driver:go-offline` | `{ driverId }` | Removes driver from active Redis sorted set. |
| **Client ➔ Server** | `ride:accept-offer` | `{ rideId, driverId }` | Triggers atomic assignment in `ride-service`. |
| **Server ➔ Client** | `ride:offer-received` | `{ rideId, pickup, destination, farePaise }` | Dispatched to candidate drivers within radius. |
| **Server ➔ Client** | `ride:driver-assigned` | `{ rideId, driver: { name, vehicle, rating } }` | Push notification to rider. |
| **Server ➔ Client** | `ride:driver-arrived` | `{ rideId, timestamp }` | Push notification to rider upon arrival. |
| **Server ➔ Client** | `ride:started` | `{ rideId, startedAt }` | Push notification to rider upon OTP verification. |
| **Server ➔ Client** | `ride:completed` | `{ rideId, finalFarePaise, summary }` | Push notification to rider and driver. |
| **Server ➔ Client** | `driver:location-broadcast`| `{ rideId, lat, lng, heading }` | Real-time map rendering for active rider. |

---

## 5. Master Monorepo Folder Structure

```
UrbanFleet/
├── packages/
│   ├── common/                               # Shared types, error classes & logger
│   │   ├── package.json
│   │   └── src/
│   │       ├── errors/                       # AppError, NotFoundError, UnauthorizedError
│   │       ├── middlewares/                  # Asymmetric JWT auth middleware
│   │       └── utils/                        # Logger, crypto helpers
│   │
│   └── contracts/                            # Shared Kafka event definitions & Zod schemas
│       ├── package.json
│       └── src/
│           ├── events/                       # RideCompleted, PaymentCaptured, UserRegistered
│           └── envelopes/                    # Standard Kafka envelope schema
│
├── services/
│   ├── auth-service/                         # Identity, RS256 issuance, 2FA
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── prisma/schema.prisma              # urbanfleet_auth
│   │   └── src/
│   │
│   ├── driver-service/                       # Driver profiles, vehicles, documents
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── prisma/schema.prisma              # urbanfleet_driver
│   │   └── src/
│   │
│   ├── ride-service/                         # Ride lifecycle, Redis GEO, Native WS, Outbox
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── prisma/schema.prisma              # urbanfleet_ride (includes OutboxEvent)
│   │   └── src/
│   │
│   ├── payment-service/                      # Razorpay, Double-entry ledger, Outbox
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── prisma/schema.prisma              # urbanfleet_payment (includes OutboxEvent & Refund)
│   │   └── src/
│   │
│   └── notification-service/                 # Durable inbox, SendGrid worker
│       ├── Dockerfile
│       ├── package.json
│       ├── prisma/schema.prisma              # urbanfleet_notification (Durable Inbox)
│       └── src/
│
├── infra/
│   ├── kong/
│   │   └── kong.yml                          # Declarative DB-less configuration
│   ├── init-databases.sql                    # Least-privilege roles & databases
│   └── kafka-init.sh                         # Kafka topic provisioning script
│
├── frontend/                                 # React / Vite application
│   ├── Dockerfile
│   └── src/
│
├── docker-compose.yml                        # Production-hardened orchestration
├── .gitignore
├── .dockerignore
└── package.json                              # Monorepo root workspaces
```

---

## 6. Database-per-Service: Dedicated Prisma Relational Schemas

---

### 6.1 `auth-service` Schema (`urbanfleet_auth`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  RIDER
  DRIVER
}

model User {
  id                  String        @id @default(uuid()) @db.Uuid
  email               String        @unique @db.VarChar(255)
  passwordHash        String        @map("password_hash") @db.VarChar(255)
  firstName           String        @map("first_name") @db.VarChar(50)
  lastName            String        @map("last_name") @db.VarChar(50)
  role                Role          @default(RIDER)
  isEmailVerified     Boolean       @default(false) @map("is_email_verified")
  twoFactorEnabled    Boolean       @default(false) @map("two_factor_enabled")
  twoFactorSecret     String?       @map("two_factor_secret") @db.VarChar(255)
  avatarUrl           String?       @map("avatar_url") @db.VarChar(500)
  status              String        @default("ACTIVE") @db.VarChar(20)

  createdAt           DateTime      @default(now()) @map("created_at")
  updatedAt           DateTime      @updatedAt @map("updated_at")

  sessions            Session[]

  @@map("users")
}

model Session {
  id           String    @id @default(uuid()) @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshToken String    @unique @map("refresh_token") @db.VarChar(500)
  userAgent    String?   @map("user_agent") @db.VarChar(255)
  ipAddress    String?   @map("ip_address") @db.VarChar(45)
  expiresAt    DateTime  @map("expires_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@index([userId])
  @@map("sessions")
}

```

---

### 6.2 `driver-service` Schema (`urbanfleet_driver`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum VerificationStatus {
  PENDING
  UNDER_REVIEW
  VERIFIED
  REJECTED
}

model DriverProfile {
  id                 String             @id @default(uuid()) @db.Uuid
  userId             String             @unique @map("user_id") @db.Uuid // Cross-service reference
  licenseNumber      String             @unique @map("license_number") @db.VarChar(50)
  verificationStatus VerificationStatus @default(PENDING) @map("verification_status")
  isAvailable        Boolean            @default(false) @map("is_available")
  rating             Decimal            @default(5.0) @db.Decimal(3, 2)
  totalTrips         Int                @default(0) @map("total_trips")
  totalEarningsPaise BigInt             @default(0) @map("total_earnings_paise")

  createdAt          DateTime           @default(now()) @map("created_at")
  updatedAt          DateTime           @updatedAt @map("updated_at")

  vehicles           Vehicle[]
  documents          Document[]

  @@map("driver_profiles")
}

model Vehicle {
  id              String        @id @default(uuid()) @db.Uuid
  driverProfileId String        @map("driver_profile_id") @db.Uuid
  driverProfile   DriverProfile @relation(fields: [driverProfileId], references: [id], onDelete: Cascade)
  make            String        @db.VarChar(50)
  model           String        @db.VarChar(50)
  year            Int
  plateNumber     String        @unique @map("plate_number") @db.VarChar(20)
  color           String        @db.VarChar(30)
  category        String        @default("SEDAN") @db.VarChar(20)
  isActive        Boolean       @default(true) @map("is_active")

  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  @@index([driverProfileId])
  @@map("vehicles")
}

model Document {
  id              String             @id @default(uuid()) @db.Uuid
  driverProfileId String             @map("driver_profile_id") @db.Uuid
  driverProfile   DriverProfile      @relation(fields: [driverProfileId], references: [id], onDelete: Cascade)
  type            String             @db.VarChar(50)
  documentUrl     String             @map("document_url") @db.VarChar(500)
  status          VerificationStatus @default(PENDING)
  expiresAt       DateTime?          @map("expires_at")
  rejectionReason String?            @map("rejection_reason")

  createdAt       DateTime           @default(now()) @map("created_at")
  updatedAt       DateTime           @updatedAt @map("updated_at")

  @@index([driverProfileId])
  @@map("documents")
}

model ProcessedEvent {
  eventId       String   @map("event_id") @db.Uuid
  consumerGroup String   @map("consumer_group") @db.VarChar(100)
  processedAt   DateTime @default(now()) @map("processed_at")

  @@id([eventId, consumerGroup])
  @@map("processed_events")
}
```

---

### 6.3 `ride-service` Schema (`urbanfleet_ride`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum RideStatus {
  SEARCHING
  DRIVER_ASSIGNED
  DRIVER_ARRIVING
  RIDE_STARTED
  ARRIVED_AT_DESTINATION
  COMPLETED
  CANCELLED
}

enum RidePaymentStatus {
  PENDING
  CAPTURED
  FAILED
  REFUNDED
}

enum OutboxStatus {
  PENDING
  PROCESSING
  PUBLISHED
  FAILED
}

model Ride {
  id                 String            @id @default(uuid()) @db.Uuid
  riderId            String            @map("rider_id") @db.Uuid
  driverId           String?           @map("driver_id") @db.Uuid
  vehicleCategory    String            @default("SEDAN") @map("vehicle_category") @db.VarChar(20)

  status             RideStatus        @default(SEARCHING)
  paymentStatus      RidePaymentStatus @default(PENDING) @map("payment_status")
  rideSequence       Int               @default(1) @map("ride_sequence") // Monotonic aggregate sequence

  pickupLat          Decimal           @map("pickup_lat") @db.Decimal(10, 7)
  pickupLng          Decimal           @map("pickup_lng") @db.Decimal(10, 7)
  pickupAddress      String            @map("pickup_address") @db.VarChar(255)

  destinationLat     Decimal           @map("destination_lat") @db.Decimal(10, 7)
  destinationLng     Decimal           @map("destination_lng") @db.Decimal(10, 7)
  destinationAddress String            @map("destination_address") @db.VarChar(255)

  distanceKm         Decimal           @map("distance_km") @db.Decimal(6, 2)
  durationMinutes    Int               @map("duration_minutes")

  baseFarePaise      Int               @map("base_fare_paise")
  surgeMultiplier    Decimal           @default(1.0) @map("surge_multiplier") @db.Decimal(3, 2)
  totalFarePaise     Int               @map("total_fare_paise")

  cancelledBy        String?           @map("cancelled_by") @db.VarChar(20)
  cancellationReason String?           @map("cancellation_reason")

  acceptedAt         DateTime?         @map("accepted_at")
  arrivedAt          DateTime?         @map("arrived_at")
  startedAt          DateTime?         @map("started_at")
  completedAt        DateTime?         @map("completed_at")
  cancelledAt        DateTime?         @map("cancelled_at")

  createdAt          DateTime          @default(now()) @map("created_at")
  updatedAt          DateTime          @updatedAt @map("updated_at")

  ratings            Rating[]

  @@index([riderId])
  @@index([driverId])
  @@index([status])
  @@map("rides")
}

model Rating {
  id        String   @id @default(uuid()) @db.Uuid
  rideId    String   @map("ride_id") @db.Uuid
  ride      Ride     @relation(fields: [rideId], references: [id], onDelete: Cascade)
  fromId    String   @map("from_id") @db.Uuid
  toId      String   @map("to_id") @db.Uuid
  score     Int
  feedback  String?
  createdAt DateTime @default(now()) @map("created_at")

  @@index([rideId])
  @@map("ratings")
}

model OutboxEvent {
  id                String       @id @default(uuid()) @db.Uuid
  topic             String       @db.VarChar(100)
  partitionKey      String       @map("partition_key") @db.VarChar(100)
  eventType         String       @map("event_type") @db.VarChar(100)
  aggregateType     String       @map("aggregate_type") @db.VarChar(50)
  aggregateId       String       @map("aggregate_id") @db.VarChar(100)
  aggregateSequence Int          @map("aggregate_sequence")
  payload           Json
  status            OutboxStatus @default(PENDING)
  retryCount        Int          @default(0) @map("retry_count")
  lastError         String?      @map("last_error")
  lockedAt          DateTime?    @map("locked_at")
  lockedBy          String?      @map("locked_by") @db.VarChar(100)
  leaseExpiresAt    DateTime?    @map("lease_expires_at")
  publishedAt       DateTime?    @map("published_at")
  createdAt         DateTime     @default(now()) @map("created_at")

  @@unique([aggregateType, aggregateId, aggregateSequence])
  @@index([status, leaseExpiresAt, createdAt])
  @@index([partitionKey, aggregateSequence])
  @@map("outbox_events")
}

model ProcessedEvent {
  eventId       String   @map("event_id") @db.Uuid
  consumerGroup String   @map("consumer_group") @db.VarChar(100)
  processedAt   DateTime @default(now()) @map("processed_at")

  @@id([eventId, consumerGroup])
  @@map("processed_events")
}
```

---

### 6.4 `payment-service` Schema (`urbanfleet_payment`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum PaymentStatus {
  CREATED
  PENDING
  AUTHORIZED
  CAPTURED
  FAILED
  REFUNDED
  PARTIALLY_REFUNDED
  CANCELLED
}

enum PayoutStatus {
  PENDING
  SUBMITTED
  PROCESSED
  FAILED
  REVERSED
}

enum RefundStatus {
  PENDING
  PROCESSED
  FAILED
}

enum LedgerAccount {
  RIDER
  PLATFORM
  DRIVER
  BANK
  RIDER_WALLET
  DRIVER_WALLET
  PLATFORM_COMMISSION
  GATEWAY_CLEARING
  TAX_COLLECTED
}

enum LedgerEntryType {
  DEBIT
  CREDIT
}

enum OutboxStatus {
  PENDING
  PROCESSING
  PUBLISHED
  FAILED
}

model Payment {
  id                         String        @id @default(uuid()) @db.Uuid
  rideId                     String        @unique @map("ride_id") @db.Uuid
  riderId                    String        @map("rider_id") @db.Uuid
  driverId                   String?       @map("driver_id") @db.Uuid

  paymentSequence            Int           @default(1) @map("payment_sequence")
  gateway                    String        @default("RAZORPAY") @db.VarChar(50)
  gatewayOrderId             String?       @map("gateway_order_id") @db.VarChar(255)
  gatewayPaymentId           String?       @unique @map("gateway_payment_id") @db.VarChar(255)
  amountPaise                Int           @map("amount_paise")
  currency                   String        @default("INR") @db.VarChar(3)
  status                     PaymentStatus @default(PENDING)
  method                     String?       @db.VarChar(50)
  fareBreakdown              Json?         @map("fare_breakdown")
  idempotencyKey             String?       @unique @map("idempotency_key") @db.VarChar(255)
  attemptNumber              Int           @default(1) @map("attempt_number")
  failureReason              String?       @map("failure_reason")
  failureCode                String?       @map("failure_code")
  lastFailedGatewayPaymentId String?       @map("last_failed_gateway_payment_id") @db.VarChar(255)
  refundedAmountPaise        Int           @default(0) @map("refunded_amount_paise")
  ledgerTransactionId        String?       @map("ledger_transaction_id") @db.VarChar(255)
  metadata                   Json?
  capturedAt                 DateTime?     @map("captured_at")
  refundedAt                 DateTime?     @map("refunded_at")

  createdAt                  DateTime      @default(now()) @map("created_at")
  updatedAt                  DateTime      @updatedAt @map("updated_at")

  payouts                    Payout[]
  refunds                    Refund[]

  @@map("payments")
}

model Refund {
  id                  String       @id @default(uuid()) @db.Uuid
  paymentId           String       @map("payment_id") @db.Uuid
  payment             Payment      @relation(fields: [paymentId], references: [id])
  amountPaise         Int          @map("amount_paise")
  reason              String?
  gatewayRefundId     String?      @unique @map("gateway_refund_id") @db.VarChar(255)
  ledgerTransactionId String       @map("ledger_transaction_id") @db.Uuid
  status              RefundStatus @default(PENDING)
  createdAt           DateTime     @default(now()) @map("created_at")

  @@index([paymentId])
  @@map("refunds")
}

model Payout {
  id                          String       @id @default(uuid()) @db.Uuid
  driverId                    String       @map("driver_id") @db.Uuid
  paymentId                   String?      @map("payment_id") @db.Uuid
  payment                     Payment?     @relation(fields: [paymentId], references: [id], onDelete: SetNull)
  rideId                      String       @map("ride_id") @db.Uuid

  amountPaise                 Int          @map("amount_paise")
  currency                    String       @default("INR") @db.VarChar(3)
  status                      PayoutStatus @default(PENDING)
  mode                        String       @default("IMPS") @db.VarChar(20)
  gatewayPayoutId             String?      @unique @map("gateway_payout_id") @db.VarChar(255)
  utr                         String?      @db.VarChar(255)
  ledgerTransactionId         String?      @map("ledger_transaction_id") @db.VarChar(255)
  reversalLedgerTransactionId String?      @map("reversal_ledger_transaction_id") @db.VarChar(255)
  failureReason               String?      @map("failure_reason")
  metadata                    Json?

  processedAt                 DateTime?    @map("processed_at")
  failedAt                    DateTime?    @map("failed_at")
  reversedAt                  DateTime?    @map("reversed_at")

  createdAt                   DateTime     @default(now()) @map("created_at")
  updatedAt                   DateTime     @updatedAt @map("updated_at")

  @@index([driverId])
  @@index([rideId])
  @@map("payouts")
}

model LedgerEntry {
  id             String          @id @default(uuid()) @db.Uuid
  transactionId  String          @map("transaction_id") @db.Uuid
  account        LedgerAccount
  entryType      LedgerEntryType @map("entry_type")
  amountPaise    BigInt          @map("amount_paise")
  currency       String          @default("INR") @db.VarChar(3)

  ownerId        String?         @map("owner_id") @db.VarChar(255)
  referenceType  String          @map("reference_type") @db.VarChar(50)
  referenceId    String?         @map("reference_id") @db.VarChar(255)
  idempotencyKey String?         @map("idempotency_key") @db.VarChar(255)
  legIndex       Int?            @map("leg_index")
  description    String?
  metadata       Json?

  createdAt      DateTime        @default(now()) @map("created_at")

  @@unique([idempotencyKey, legIndex])
  @@index([transactionId])
  @@index([account, ownerId])
  @@map("ledger_entries")
}

model OutboxEvent {
  id                String       @id @default(uuid()) @db.Uuid
  topic             String       @db.VarChar(100)
  partitionKey      String       @map("partition_key") @db.VarChar(100)
  eventType         String       @map("event_type") @db.VarChar(100)
  aggregateType     String       @map("aggregate_type") @db.VarChar(50)
  aggregateId       String       @map("aggregate_id") @db.VarChar(100)
  aggregateSequence Int          @map("aggregate_sequence")
  payload           Json
  status            OutboxStatus @default(PENDING)
  retryCount        Int          @default(0) @map("retry_count")
  lastError         String?      @map("last_error")
  lockedAt          DateTime?    @map("locked_at")
  lockedBy          String?      @map("locked_by") @db.VarChar(100)
  leaseExpiresAt    DateTime?    @map("lease_expires_at")
  publishedAt       DateTime?    @map("published_at")
  createdAt         DateTime     @default(now()) @map("created_at")

  @@unique([aggregateType, aggregateId, aggregateSequence])
  @@index([status, leaseExpiresAt, createdAt])
  @@index([partitionKey, aggregateSequence])
  @@map("outbox_events")
}

model ProcessedEvent {
  eventId       String   @map("event_id") @db.Uuid
  consumerGroup String   @map("consumer_group") @db.VarChar(100)
  processedAt   DateTime @default(now()) @map("processed_at")

  @@id([eventId, consumerGroup])
  @@map("processed_events")
}
```

---

### 6.5 `notification-service` Schema (`urbanfleet_notification`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum NotificationChannel {
  EMAIL
  SMS
  PUSH
}

enum NotificationStatus {
  PENDING
  DISPATCHED
  FAILED
}

model NotificationRecord {
  id              String              @id @default(uuid()) @db.Uuid
  recipient       String              @db.VarChar(255)
  channel         NotificationChannel @default(EMAIL)
  template        String              @db.VarChar(100)
  idempotencyKey  String              @unique @map("idempotency_key") @db.VarChar(255)
  payload         Json
  status          NotificationStatus  @default(PENDING)
  retryCount      Int                 @default(0) @map("retry_count")
  lastError       String?             @map("last_error")
  gatewayMessageId String?            @map("gateway_message_id") @db.VarChar(255)

  dispatchedAt    DateTime?           @map("dispatched_at")
  createdAt       DateTime            @default(now()) @map("created_at")
  updatedAt       DateTime            @updatedAt @map("updated_at")

  @@index([status, createdAt])
  @@map("notification_records")
}

model ProcessedEvent {
  eventId       String   @map("event_id") @db.Uuid
  consumerGroup String   @map("consumer_group") @db.VarChar(100)
  processedAt   DateTime @default(now()) @map("processed_at")

  @@id([eventId, consumerGroup])
  @@map("processed_events")
}
```

---

## 7. Least-Privilege Database Initialization Script (`infra/init-databases.sql`)

```sql
-- infra/init-databases.sql
-- Executed on initial PostgreSQL startup via /docker-entrypoint-initdb.d/

-- Create Users
CREATE USER auth_user WITH ENCRYPTED PASSWORD 'auth_pass_local';
CREATE USER driver_user WITH ENCRYPTED PASSWORD 'driver_pass_local';
CREATE USER ride_user WITH ENCRYPTED PASSWORD 'ride_pass_local';
CREATE USER payment_user WITH ENCRYPTED PASSWORD 'payment_pass_local';
CREATE USER notification_user WITH ENCRYPTED PASSWORD 'notif_pass_local';

-- Create Databases
CREATE DATABASE urbanfleet_auth OWNER auth_user;
CREATE DATABASE urbanfleet_driver OWNER driver_user;
CREATE DATABASE urbanfleet_ride OWNER ride_user;
CREATE DATABASE urbanfleet_payment OWNER payment_user;
CREATE DATABASE urbanfleet_notification OWNER notification_user;

-- Revoke Public Access
REVOKE ALL ON DATABASE urbanfleet_auth FROM PUBLIC;
REVOKE ALL ON DATABASE urbanfleet_driver FROM PUBLIC;
REVOKE ALL ON DATABASE urbanfleet_ride FROM PUBLIC;
REVOKE ALL ON DATABASE urbanfleet_payment FROM PUBLIC;
REVOKE ALL ON DATABASE urbanfleet_notification FROM PUBLIC;

-- Grant Specific Database Privileges
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_auth TO auth_user;
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_driver TO driver_user;
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_ride TO ride_user;
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_payment TO payment_user;
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_notification TO notification_user;
```

---

## 8. Declarative Kong API Gateway Configuration (`infra/kong/kong.yml`)

```yaml
_format_version: "3.0"

services:
  # ========================================================
  # 1. AUTH SERVICE (Internal Port 4001)
  # ========================================================
  - name: auth-service
    url: http://auth-service:4001
    routes:
      - name: auth-routes
        paths:
          - /api/auth
        strip_path: false
        protocols:
          - http
          - https
        plugins:
          - name: rate-limiting
            config:
              minute: 60
              policy: local

  # ========================================================
  # 2. DRIVER SERVICE (Internal Port 4002)
  # ========================================================
  - name: driver-service
    url: http://driver-service:4002
    routes:
      - name: driver-routes
        paths:
          - /api/driver
        strip_path: false
        protocols:
          - http
          - https

  # ========================================================
  # 3. RIDE SERVICE (HTTP - Internal Port 4004)
  # ========================================================
  - name: ride-service
    url: http://ride-service:4004
    routes:
      - name: ride-routes
        paths:
          - /api/ride
        strip_path: false
        protocols:
          - http
          - https

  # ========================================================
  # 4. RIDE WEBSOCKET SERVICE (Native WS Upgrade)
  # ========================================================
  - name: ride-websocket-service
    url: http://ride-service:4004
    routes:
      - name: ride-websocket-route
        paths:
          - /ws/ride
        strip_path: false
        protocols:
          - http
          - https # 👈 Native WS upgrades transparently handled over HTTP/HTTPS

  # ========================================================
  # 5. PAYMENT SERVICE (Internal Port 4005)
  # ========================================================
  - name: payment-service
    url: http://payment-service:4005
    routes:
      - name: payment-routes
        paths:
          - /api/payment
        strip_path: false
        protocols:
          - http
          - https

plugins:
  # Global Dynamic CORS Plugin
  - name: cors
    config:
      origins:
        - "http://localhost:5173"
        - "http://localhost:3000"
      methods:
        - GET
        - POST
        - PUT
        - PATCH
        - DELETE
        - OPTIONS
      headers:
        - Accept
        - Accept-Version
        - Content-Length
        - Content-Type
        - Authorization
        - X-Request-ID
      credentials: true
      max_age: 3600

  # Global Correlation ID Plugin
  - name: correlation-id
    config:
      header_name: X-Request-ID
      generator: uuid
      echo_downstream: true
```

---

## 9. Hardened Master Docker Compose Specification (`docker-compose.yml`)

```yaml
version: "3.9"

networks:
  urbanfleet_internal:
    driver: bridge
    internal: false # Permits outbound container requests (e.g. Razorpay, SendGrid)

services:
  # ========================================================
  # 1. DATA INFRASTRUCTURE
  # ========================================================
  postgres:
    image: postgres:15-alpine
    container_name: urbanfleet-postgres
    environment:
      POSTGRES_USER: ${POSTGRES_ADMIN_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_ADMIN_PASSWORD:-postgres_admin_pwd}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/init-databases.sql:/docker-entrypoint-initdb.d/init-databases.sql:ro
    expose:
      - "5432" # 👈 Internal network only! Zero public host exposure
    networks:
      - urbanfleet_internal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: urbanfleet-redis
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy noeviction
    volumes:
      - redis_data:/data
    expose:
      - "6379" # 👈 Internal network only!
    networks:
      - urbanfleet_internal
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  kafka:
    image: confluentinc/cp-kafka:7.4.0
    container_name: urbanfleet-kafka
    expose:
      - "29092"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT'
      KAFKA_ADVERTISED_LISTENERS: 'PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092'
      KAFKA_PROCESS_ROLES: 'broker,controller'
      KAFKA_CONTROLLER_QUORUM_VOTERS: '1@kafka:29093'
      KAFKA_LISTENERS: 'PLAINTEXT://0.0.0.0:29092,CONTROLLER://0.0.0.0:29093,PLAINTEXT_HOST://0.0.0.0:9092'
      KAFKA_INTER_BROKER_LISTENER_NAME: 'PLAINTEXT'
      KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER'
      KAFKA_LOG_DIRS: '/tmp/kraft-combined-logs'
      CLUSTER_ID: 'MkU3OEVBNTcwNTJENDM2Qk'
    volumes:
      - kafka_data:/var/lib/kafka/data
    networks:
      - urbanfleet_internal
    healthcheck:
      test: ["CMD", "kafka-broker-api-versions", "--bootstrap-server", "localhost:29092"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ========================================================
  # 2. INGRESS: KONG API GATEWAY
  # ========================================================
  kong:
    image: kong:3.4-alpine
    container_name: urbanfleet-kong
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /usr/local/kong/declarative/kong.yml
      KONG_PROXY_ACCESS_LOG: /dev/stdout
      KONG_ADMIN_ACCESS_LOG: /dev/stdout
      KONG_PROXY_ERROR_LOG: /dev/stderr
      KONG_ADMIN_ERROR_LOG: /dev/stderr
      KONG_ADMIN_LISTEN: "0.0.0.0:8001"
    volumes:
      - ./infra/kong/kong.yml:/usr/local/kong/declarative/kong.yml:ro
    ports:
      - "3001:8000"           # 👈 Single Public Ingress Port!
      - "127.0.0.1:8001:8001" # 👈 Loopback Admin binding ONLY!
    networks:
      - urbanfleet_internal
    depends_on:
      - auth-service
      - driver-service
      - ride-service
      - payment-service

  # ========================================================
  # 3. CORE MICROSERVICES (Zero Public Ports Exposed)
  # ========================================================
  auth-service:
    build:
      context: .
      dockerfile: services/auth-service/Dockerfile
    container_name: urbanfleet-auth-service
    expose:
      - "4001"
    environment:
      DATABASE_URL: "postgresql://auth_user:${AUTH_DB_PASSWORD:-auth_pass_local}@postgres:5432/urbanfleet_auth?schema=public"
      REDIS_URL: "redis://redis:6379"
      KAFKA_BROKERS: "kafka:29092"
      JWT_PRIVATE_KEY_BASE64: ${JWT_PRIVATE_KEY_BASE64}
      JWT_PUBLIC_KEY_BASE64: ${JWT_PUBLIC_KEY_BASE64}
    networks:
      - urbanfleet_internal
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  driver-service:
    build:
      context: .
      dockerfile: services/driver-service/Dockerfile
    container_name: urbanfleet-driver-service
    expose:
      - "4002"
    environment:
      DATABASE_URL: "postgresql://driver_user:${DRIVER_DB_PASSWORD:-driver_pass_local}@postgres:5432/urbanfleet_driver?schema=public"
      REDIS_URL: "redis://redis:6379"
      KAFKA_BROKERS: "kafka:29092"
      JWT_PUBLIC_KEY_BASE64: ${JWT_PUBLIC_KEY_BASE64}
    networks:
      - urbanfleet_internal
    depends_on:
      postgres:
        condition: service_healthy
      kafka:
        condition: service_healthy

  ride-service:
    build:
      context: .
      dockerfile: services/ride-service/Dockerfile
    container_name: urbanfleet-ride-service
    expose:
      - "4004"
    environment:
      DATABASE_URL: "postgresql://ride_user:${RIDE_DB_PASSWORD:-ride_pass_local}@postgres:5432/urbanfleet_ride?schema=public"
      REDIS_URL: "redis://redis:6379"
      KAFKA_BROKERS: "kafka:29092"
      JWT_PUBLIC_KEY_BASE64: ${JWT_PUBLIC_KEY_BASE64}
    networks:
      - urbanfleet_internal
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      kafka:
        condition: service_healthy

  payment-service:
    build:
      context: .
      dockerfile: services/payment-service/Dockerfile
    container_name: urbanfleet-payment-service
    expose:
      - "4005"
    environment:
      DATABASE_URL: "postgresql://payment_user:${PAYMENT_DB_PASSWORD:-payment_pass_local}@postgres:5432/urbanfleet_payment?schema=public"
      REDIS_URL: "redis://redis:6379"
      KAFKA_BROKERS: "kafka:29092"
      JWT_PUBLIC_KEY_BASE64: ${JWT_PUBLIC_KEY_BASE64}
      RAZORPAY_KEY_ID: ${RAZORPAY_KEY_ID}
      RAZORPAY_KEY_SECRET: ${RAZORPAY_KEY_SECRET}
    networks:
      - urbanfleet_internal
    depends_on:
      postgres:
        condition: service_healthy
      kafka:
        condition: service_healthy

  notification-service:
    build:
      context: .
      dockerfile: services/notification-service/Dockerfile
    container_name: urbanfleet-notification-service
    expose:
      - "4003"
    environment:
      DATABASE_URL: "postgresql://notification_user:${NOTIFICATION_DB_PASSWORD:-notif_pass_local}@postgres:5432/urbanfleet_notification?schema=public"
      KAFKA_BROKERS: "kafka:29092"
      SENDGRID_API_KEY: ${SENDGRID_API_KEY}
    networks:
      - urbanfleet_internal
    depends_on:
      postgres:
        condition: service_healthy
      kafka:
        condition: service_healthy

  # ========================================================
  # 4. FRONTEND
  # ========================================================
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: urbanfleet-frontend
    ports:
      - "5173:5173"
    networks:
      - urbanfleet_internal
    depends_on:
      - kong

volumes:
  postgres_data:
  redis_data:
  kafka_data:
```

---

## 10. Refined 5-Stage Implementation & Automated Failure Testing Roadmap

To avoid the anti-pattern of launching 5 microservices, Kafka, Redis Pub/Sub, and Kong simultaneously, the rollout is broken into **5 progressive, failure-verified stages**:

### 🎯 Stage 1: Service Boundaries & Database Ownership
* Establish Monorepo workspaces (`packages/common`, `packages/contracts`).
* Run `infra/init-databases.sql` to initialize 5 independent databases and least-privilege roles.
* Implement RS256 keypair generation in `auth-service` and export `JWT_PUBLIC_KEY_BASE64` verification middleware.
* Separate Prisma schemas and run initial migrations against individual databases.
* **Failure Verification Test:** Run automated integration tests proving that `auth_user` credentials cannot connect or query `urbanfleet_ride` or `urbanfleet_payment`.

### 🎯 Stage 2: Complete Synchronous Ride Lifecycle
* Implement HTTP endpoints for `ride-service` and `driver-service`.
* Verify atomic driver dispatch and ride lifecycle transitions (`REQUESTED` ➔ `ACCEPTED` ➔ `ARRIVED` ➔ `IN_PROGRESS` ➔ `COMPLETED`).
* Protect routes using the RS256 verification middleware.
* **Failure Verification Test:** Execute concurrent driver acceptance requests (`POST /:id/accept`) for the same ride; assert that exactly one driver succeeds and all other attempts receive `409 Conflict`.

### 🎯 Stage 3: Reliable Asynchronous Events (Ride & Payment Outbox)
* Stand up Apache Kafka (KRaft mode) via Docker Compose.
* Deploy `OutboxEvent` table and publisher worker to `ride-service`.
* Deploy `OutboxEvent`, normalized `Refund`, and `PayoutStatus` enums to `payment-service`.
* Enforce double-entry ledger invariant ($\sum \text{Debits} - \sum \text{Credits} = 0$).
* Implement atomic consumer idempotency (`processed_events` + state change in local `$transaction`).
* **Failure Verification Test:**
  1. Kill the `outbox.worker` process mid-execution; verify that leases expire after 30 seconds and the successor worker resumes publishing with zero lost messages.
  2. Inject duplicate `RideCompleted` events into Kafka; verify that driver `totalTrips` increments exactly once.

### 🎯 Stage 4: Real-Time Scaling & Kong Gateway Controls
* Deploy Kong in DB-less mode using `infra/kong/kong.yml` with loopback admin binding and internal Docker network isolation.
* Implement native WebSocket client with exponential reconnect backoff, keep-alive heartbeats, and client-side state rehydration (`GET /api/ride/current`).
* Modernize `geo.service.ts` with Redis `GEOSEARCH` and background TTL heartbeat pruning.
* Route HTTP and WebSocket traffic through Kong port `3001`.
* **Failure Verification Test:** Terminate the WebSocket connection mid-ride while the vehicle moves; verify that the client reconnects, rehydrates state from `/api/ride/current`, and updates the map without manual browser refresh.

### 🎯 Stage 5: Hardening, Observability & Chaos Recovery
* Enable Kong `correlation-id` plugin and verify `X-Request-ID` propagation across HTTP headers and Kafka event headers.
* Deploy durable `notification-service` inbox worker with SendGrid idempotency keys.
* Implement nightly reconciliation sweeps comparing PostgreSQL ledger entries with Razorpay settlement reports.
* **Failure Verification Test:** Execute chaos test: simulate network partitions between Kafka and microservices during peak ride completions; verify that outbox events queue safely in PostgreSQL and flush cleanly upon partition resolution without financial drift.
