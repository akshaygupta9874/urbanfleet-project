# 🚗 UrbanFleet: Production-Grade Event-Driven Microservices Platform

Welcome to **UrbanFleet**, a high-scale, event-driven ride-hailing and real-time fleet orchestration platform engineered with modern microservices, database-per-service isolation, transactional outbox publishing, double-entry financial accounting, native WebSockets, and Kong API Gateway routing.

---

## 🏛️ System Architecture Topology

```
                                  ┌───────────────────────────────┐
                                  │     Frontend (React / Vite)   │
                                  │      (Host Port: 5173)        │
                                  └───────────────┬───────────────┘
                                                  │ HTTP / Native WS (Port 3001)
                                                  ▼
                                  ┌───────────────────────────────┐
                                  │        KONG API GATEWAY       │
                                  │   (Port 3001 - DB-less Mode)  │
                                  │  CORS, Rate Limit, WS Upgrade │
                                  │  Admin on Loopback 127.0.0.1  │
                                  └───────┬───┬───┬───┬───────────┘
                                          │   │   │   │ (Private Docker Network: urbanfleet_internal)
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
    ┌───────────────────────────────────────────────────────────────────────────────────┐
    │                        APACHE KAFKA CLUSTER (KRaft Mode)                          │
    │             Topics: auth.events  |  ride.events  |  payment.events                │
    └────────────────────▲───────────────────────────────▲──────────────────────────────┘
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

---

## 📂 Repository Organization

```
urbanfleet-project/
├── packages/
│   ├── common/                    # Shared errors, logger, RS256 JWT middleware, Redis helper, ledger validator
│   └── contracts/                 # KafkaEnvelope<T>, Event schemas, Zod validation, DLQ topics
├── services/
│   ├── auth-service/              # Identity, sessions, RS256 keypair, 2FA, UserRegistered publisher (Port 4001)
│   ├── driver-service/            # Profiles, documents, vehicles, atomic consumer idempotency (Port 4002)
│   ├── ride-service/              # Lifecycle, Redis GEOSEARCH, Native WS, Outbox publisher + lease recovery (Port 4004)
│   ├── payment-service/           # Razorpay, balanced double-entry ledger, normalized refunds, Outbox publisher (Port 4005)
│   └── notification-service/      # Durable PostgreSQL inbox, SendGrid dispatcher, templates (Port 4003)
├── infra/
│   ├── init-databases.sql         # 5 databases + 5 least-privilege roles
│   ├── kafka-init.sh              # KRaft topic creation script
│   └── kong/
│       └── kong.yml               # Declarative DB-less gateway routes & plugins
├── frontend/                      # React/Vite with native WebSocket rehydration client (Port 5173)
├── docker-compose.yml             # Orchestration for all 5 services, DBs, Redis, Kafka, Kong
├── package.json                   # Root monorepo workspace configuration
├── tsconfig.base.json             # Root TypeScript compiler options
├── .gitignore                     # Excludes certs/, *.pem, and .env
├── .dockerignore                  # Clean container build rules
├── .env.example                   # Environment configuration template
└── URBANFLEET_MICROSERVICES_ARCHITECTURE_SPEC.md # Master engineering blueprint
```

---

## 🔑 Ports & Network Isolation Matrix

| Service / Infrastructure | Container Port | Host Port Mapping | Network Access | Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| **Kong API Gateway** | `8000` | **`3001`** | **Public** | Unified API Ingress, CORS, Rate-Limiting & Native WS Proxy. |
| **Kong Admin API** | `8001` | **`127.0.0.1:8001`** | **Loopback Only** | Routing & configuration inspection (never public). |
| **Frontend** | `5173` | **`5173`** | **Public** | React / Vite Single Page Application. |
| **`auth-service`** | `4001` | *None* | `urbanfleet_internal` | User identity, RS256 token issuance & verification. |
| **`driver-service`** | `4002` | *None* | `urbanfleet_internal` | Driver profiles, vehicle onboarding, trip aggregation. |
| **`ride-service`** | `4004` | *None* | `urbanfleet_internal` | Ride dispatch, Redis GEO tracking, Native WebSockets. |
| **`payment-service`** | `4005` | *None* | `urbanfleet_internal` | Razorpay capture, double-entry ledger, payouts & refunds. |
| **`notification-service`** | `4003` | *None* | `urbanfleet_internal` | Durable asynchronous receipt and verification dispatch. |
| **PostgreSQL 15** | `5432` | *None* | `urbanfleet_internal` | 5 isolated databases with least-privilege service roles. |
| **Redis 7** | `6379` | *None* | `urbanfleet_internal` | Telemetry caching, GEO index & ephemeral heartbeat TTLs. |
| **Apache Kafka** | `29092` | *None* | `urbanfleet_internal` | Asynchronous event streaming (KRaft mode). |

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: v20 or higher
- **Docker & Docker Compose**: v2.20 or higher

### 2. Setup Environment Variables
```bash
cp .env.example .env
```

### 3. Run Automated Unit & Invariant Tests
```bash
npm test
```
*Executes all Vitest test suites across `@urbanfleet/common`, `@urbanfleet/ride-service`, and `@urbanfleet/payment-service`.*

### 4. Build Monorepo Workspaces
```bash
npm run build
```
*Compiles all TypeScript packages and generates individual Prisma clients.*

### 5. Launch Full Production Stack
```bash
docker compose up -d
```

---

## 🛡️ Key Architectural Guarantees

1. **Transactional Outbox Publishing:**
   - Both `ride-service` and `payment-service` write business mutations and outbox records inside a single ACID `$transaction`.
   - Sequential aggregate claiming (`DISTINCT ON (partition_key) ... ORDER BY aggregate_sequence ASC`) guarantees in-order event publication to Kafka without concurrency race conditions.
   - Processing leases automatically recover stuck events after 30 seconds if a worker crashes.

2. **Strict Double-Entry Ledger Accounting:**
   - Prior to committing journal entries, `validateLedgerBalance()` asserts:
     $$\sum \text{Debits} - \sum \text{Credits} = 0$$
   - Normalized relational `Refund` model eliminates unvalidated JSON arrays and race conditions.

3. **Atomic Consumer Idempotency:**
   - Consumer updates to business state and insertions into `processed_events` commit within the **same local database transaction**. Kafka offsets commit only upon transaction completion.

4. **Native WebSocket State Rehydration:**
   - The browser WebSocket client features 25s ping/pong keepalive, exponential backoff, and automatically rehydrates active ride state from `GET /api/ride/current` against PostgreSQL upon reconnect.

---

## 📜 Full Master Specification

For complete in-depth architectural details, refer to [`URBANFLEET_MICROSERVICES_ARCHITECTURE_SPEC.md`](./URBANFLEET_MICROSERVICES_ARCHITECTURE_SPEC.md).
