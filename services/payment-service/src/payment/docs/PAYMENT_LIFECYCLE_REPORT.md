# UrbanFleet — Payment Module: Lifecycle Report & Upgrade Notes

**Scope:** the complete `payment/` folder of the UrbanFleet ride-hailing backend (Node.js · TypeScript · Express · MongoDB/Mongoose · Redis · Razorpay).
**What this document is:** (1) a line-by-line explanation of how a rider's payment travels through the system — from "ride finished" to "money in the ledger", refunds and driver payouts; (2) the defects I found in the code you sent, with proof; (3) what I changed in the module; (4) what you must change in the *rest* of the project.

> **Two versions are discussed. Read the labels.**
> **ORIGINAL** = the `payment.zip` you sent. **UPGRADED** = the folder in the final zip. Sections 3–8 describe the **UPGRADED** module (that is what you will run). Section 9 lists what was wrong in the ORIGINAL and what changed.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Architecture at a glance](#2-architecture-at-a-glance)
3. [Data model](#3-data-model)
4. [The payment lifecycle, step by step](#4-the-payment-lifecycle-step-by-step)
5. [HTTP API reference](#5-http-api-reference)
6. [Security model](#6-security-model)
7. [Concurrency & failure matrix](#7-concurrency--failure-matrix)
8. [Operations: reconciliation, logs, alerts](#8-operations-reconciliation-logs-alerts)
9. [Findings in the ORIGINAL code and how they were fixed](#9-findings-in-the-original-code-and-how-they-were-fixed)
10. [Change log (file by file)](#10-change-log-file-by-file)
11. [What you must change in the rest of the project](#11-what-you-must-change-in-the-rest-of-the-project)
12. [Verification performed](#12-verification-performed)
13. [Known limitations & suggested next steps](#13-known-limitations--suggested-next-steps)
- [Appendix A — Error-code catalogue](#appendix-a--error-code-catalogue)
- [Appendix B — Configuration reference](#appendix-b--configuration-reference)
- [Appendix C — Testing webhooks by hand](#appendix-c--testing-webhooks-by-hand)
- [Appendix D — Glossary](#appendix-d--glossary)

---

## 1. Executive summary

### 1.1 What the module does

When a ride ends (`ARRIVED_AT_DESTINATION`) the rider pays through **Razorpay Checkout**. The backend:

1. creates a **Razorpay Order** for exactly the fare stored on the server (never a client-supplied amount) and a local **Payment** document;
2. lets the browser/app collect the money through Razorpay;
3. learns about the result **twice, independently** — synchronously from the rider's app (`/verify`) and asynchronously from Razorpay (**webhooks**) — and records the capture **exactly once** no matter how those signals race;
4. writes an immutable **double-entry ledger** (rider → platform commission + driver earning) in the *same database transaction* as the status change;
5. supports **refunds** (full/partial, admin only) that reverse the ledger proportionally and stay consistent with the gateway even when the gateway is slow, fails or is used directly from its dashboard;
6. tracks **driver payouts** and posts them to the ledger when money leaves;
7. **reconciles** the gateway, the payment records and the ledger to catch and repair what webhooks missed.

### 1.2 The ORIGINAL was well-structured but had money-correctness and security defects

What was already good (kept): integer **paise** everywhere; the fare is read from the ride on the server; HMAC signature checks with `timingSafeEqual`; raw-body webhook parsing; Redis lock with an atomic Lua release; a ledger that validates *debits = credits*; Mongo **transactions**; a compare-and-swap (`transitionStatus`); a unique idempotency key; layered routes → controllers → services → repositories.

What was wrong — the seven that matter most (five reproduced by automated tests against the untouched original, two established by reading the code; see §9 for the evidence of each):

| # | Severity | Defect in the ORIGINAL | Consequence |
|---|---|---|---|
| F-01 | **Critical (security)** | `POST /payments/:id/refund` had **no role check anywhere** | any logged-in user could refund any payment |
| F-02 | **Critical (money)** | capture handler wrote ledger rows **before** the status compare-and-swap and ignored a lost swap | concurrent `verify` + `payment.captured` + `order.paid`, or a transaction retry, could **post the ledger twice** |
| F-03 | **Critical (money)** | webhook de-duplication marked an event "done" **before** processing it | if processing failed once, Razorpay's retry was ignored → **payment lost forever** |
| F-04 | **Critical (money)** | a failed *attempt* made the payment terminally `FAILED`; a later success on the same order was rejected with 409, `ride.paymentStatus=FAILED` blocked new orders, and the deterministic idempotency key blocked a replacement | **card fails → UPI succeeds ⇒ money captured, nothing recorded**; no working retry path |
| F-05 | **Critical (money)** | refund called Razorpay **before** the DB commit, ignored a lost swap, never handled `refund.failed` | gateway refunded but books unchanged (or the reverse) |
| F-06 | High (accounting) | partial-refund reversal scaled the original legs by a **floating-point fraction** | rounding drift: a ₹1.01 payment refunded 33+33+35 paise over-reversed the platform by 1 paise |
| F-07 | High (money) | a fare with `0` commission or `0` driver earning made the ledger **throw** | payment captured at Razorpay, capture handler fails on every retry |

Plus 21 further findings (28 in total) (payouts were a stub, `refund.*`/`payout.*` webhooks ignored, no per-driver ledger balances, incomplete ledger immutability, conflicting Mongo index declarations, missing input validation, …) — all in §9.

### 1.3 What the UPGRADED module adds

- **Exactly-once capture** (claim-first compare-and-swap inside one transaction) + a database-level **unique key on every ledger posting**.
- **Retry-safe payments**: `FAILED` is no longer terminal; the same Razorpay order is re-opened; a later capture is accepted.
- **Robust webhooks**: 3-step dedupe (claim → complete / release), `order.paid` as a second capture signal, `payment.authorized`, `refund.*`, `payout.*`; permanent errors are acknowledged (200) and alerted instead of retried forever.
- **Refund engine**: book → send → settle with compensation; exact integer allocation between driver and platform; handles gateway timeouts, gateway-side failures and refunds created in the Razorpay dashboard.
- **Payout lifecycle**: compare-and-swap state machine, ledger postings (`DRIVER → BANK`), reversal handling, one live payout per payment enforced by the database.
- **Ledger v2**: owner-aware legs (per-driver balance), `BANK` account, idempotency keys, complete append-only enforcement.
- **Reconciliation** (real, not a stub) + a periodic job + global ledger integrity check.
- **Security fixes**: admin-only refunds, ownership checks, tighter validation, sanitized API responses.

### 1.4 What you have to do (details in §11)

1. **Mount the webhook router before `express.json()`** (and exclude it from CSRF) — critical.
2. Run **`syncIndexes()`** once for the three models (new unique indexes; two old index definitions are replaced).
3. Start the reconciliation job in `server.ts`.
4. Enable the listed events in the Razorpay dashboard.
5. Small frontend changes (send only `rideId`; handle `PENDING` / `FAILED`; refunds are admin-only).
6. Verify the **Driver ID vs User ID** comparison in `getPayment` (flagged, not changed — I cannot see your ride/driver models).

### 1.5 What I could **not** verify

There is no MongoDB replica set, Redis or Razorpay sandbox in my environment. Everything that does not need them was verified (type-checking under strict settings; 139 unit tests for the upgraded module, including randomized property tests and model-level checks). Mongo transactions, real index builds and live Razorpay calls need **your** integration run — §12 lists exactly what to run.

---

## 2. Architecture at a glance

```
                            ┌──────────────────────── Razorpay ────────────────────────┐
  Rider app / browser       │  Orders API   Checkout   Payments API   Refunds API   Webhooks │
  (Razorpay Checkout)       └──────▲───────────▲──────────▲──────────────▲────────────┬─────┘
        │  ▲                       │           │          │              │            │
   HTTPS│  │ JSON                  │           │          │              │ POST (signed)
        ▼  │                       │           │          │              │            ▼
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ Express app                                                                               │
│  routes/payment.routes.ts  ── authMiddleware ──▶ controllers/payment.controller.ts        │
│  routes/webhook.routes.ts  ── express.raw()  ──▶ controllers/webhook.controller.ts        │
│                    │ validation (zod)                       │ HMAC verify                 │
│                    ▼                                        ▼                             │
│  services/payment.service.ts   ◀───────────────  services/webhook.service.ts              │
│    createOrder · verify · capture · failed         dedupe · dispatch                      │
│        │            │                                  │        │         │               │
│        │            └────▶ services/refund.service.ts ◀┘        │         │               │
│        │                     book · send · settle · compensate  │         │               │
│        ▼                                                        ▼         ▼               │
│  services/ledger.service.ts  ◀────────── services/payout.service.ts   reconciliation      │
│    posting rules (capture, refund, payout)                              service + job     │
│        │                                                                                  │
│  repositories/*  (all Mongo access; compare-and-swap helpers)     utils/redis-lock.ts     │
└────────┬───────────────────────────────────────────────────────────────┬──────────────────┘
         ▼                                                               ▼
   MongoDB (replica set: transactions)                              Redis
   payments · ledger entries · payouts                              locks · webhook dedupe
```

### 2.1 Layers and their single responsibility

| Layer | Files | Responsibility |
|---|---|---|
| Routes | `routes/*.ts` | URL → middleware chain → controller. Order matters (`/ride/:rideId` above `/:paymentId`). |
| Middleware | `validation/payment.validation.ts`, `middlewares/require-admin.middleware.ts` | zod validation (422); admin gate (403). Authentication itself is your existing `authMiddleware`. |
| Controllers | `controllers/*.ts` | HTTP only: read request, call one service, shape response. No business rules. |
| Services | `services/*.ts` | Business rules and orchestration; own all transactions. |
| Repositories | `repositories/*.ts` | The only code that touches Mongoose models. Contains the **compare-and-swap** primitives. |
| Models | `models/*.ts` | Schemas, validation, indexes, ledger immutability. |
| Utilities | `utils/*.ts`, `errors/*.ts` | Redis lock, structured logger, refund allocation math, refund totals, error helpers. |
| Jobs | `jobs/payment-reconciliation.job.ts` | Periodic reconciliation, one runner across instances. |

### 2.2 Five ideas the whole design rests on

1. **Money is an integer number of paise** (₹1 = 100 paise). No floats are stored or computed anywhere in the money path (the refund split uses `BigInt` integer division).
2. **The server decides the price.** The amount comes from `ride.fare.breakdown` in your database; anything the client sends about fare is ignored.
3. **The gateway is the source of truth for money; the ledger is the source of truth for accounting.** Payment records and the ledger are written **together** (one transaction); reconciliation compares all three.
4. **Every state change is a compare-and-swap (CAS).** "Move payment from `{CREATED, PENDING, FAILED}` to `CAPTURED` — only if it is *currently* in one of those states." The database decides who wins a race; losers write nothing.
5. **Every external signal is idempotent.** Checkout verification, `payment.captured`, `order.paid` and reconciliation can all announce the same capture; the result is always exactly one payment update and one ledger transaction.

### 2.3 Where the payment folder plugs into the rest of the project

| Dependency (imported by the module) | Used for |
|---|---|
| `../../utils/AppError.js` | typed HTTP errors `(message, statusCode, code)` |
| `../../middlewares/TryCatch.js` (`asyncHandler`) | async controller wrapper |
| `../../middlewares/auth.middleware.js` (`authMiddleware`, `AuthenticatedRequest`) | authentication; `req.userId` |
| `../../models/user.model.js` (`UserModel`, `UserRole`) | role lookup (admin / participant checks) |
| `../../models/ride.model.js` (`RideModel`, `RideStatus`, `RidePaymentStatus`) | the ride being paid; `paymentStatus` is updated by the module |
| `../../redis/client.js` (`redisClient`) | locks, webhook dedupe |
| `../../config/razorpay.config.js` (`razorpayClient`) | Razorpay SDK instance |
| `../../sockets/emitters/driver.emitter.js`, `rider.emitter.js` (`emitPaymentCaptured`) | real-time "payment captured" notifications |

---

## 3. Data model

Conventions: `Paise` = integer paise. Timestamps are added by Mongoose (`createdAt`, `updatedAt`) unless stated.

### 3.1 `Payment` (one per ride per rider)

| Field | Type | Meaning |
|---|---|---|
| `ride`, `rider`, `driver` | ObjectId | who paid for which ride, and who drove it. `driver` is copied from `ride.driver` at order time. |
| `gateway` | `RAZORPAY` | enum (only one gateway today) |
| `gatewayOrderId` | string | Razorpay `order_…`. **1 Payment ↔ 1 Razorpay order.** Indexed. |
| `gatewayPaymentId` | string? | Razorpay `pay_…` of the attempt that is being / was captured. **Unique + sparse.** |
| `amountPaise`, `currency` | Paise, `INR` | equals `fareBreakdown.totalPaise` |
| `status` | enum | see state machine (§4.1) |
| `method` | enum `UPI` · `CARD` · `NETBANKING` · `WALLET` · `EMI` · `UNKNOWN` (optional) | set on authorize/capture from Razorpay's `method` |
| `fareBreakdown` | 7 × Paise | **snapshot** of the ride's fare at order time: base, distance, time, surge, `platformCommissionPaise`, `driverEarningPaise`, `totalPaise` |
| `idempotencyKey` | string, **unique** | `sha256("<rideId>:<riderId>")` — derived on the server |
| `attemptNumber` | int (starts 1) | +1 for every failed gateway attempt |
| `failureReason`, `failureCode` | string? | of the latest failed attempt (kept for audit even after a later success) |
| `lastFailedGatewayPaymentId` | string? | **new** — makes `payment.failed` idempotent per gateway payment |
| `refundedAmountPaise` | Paise | **new meaning:** sum of refunds that are `PENDING` or `PROCESSED` (never `FAILED`) |
| `refunds[]` | sub-documents | **new** — one record per refund attempt (see 3.2) |
| `ledgerTransactionId` | string? | id of the capture's ledger transaction |
| `metadata` | object | free-form bookkeeping (ride status at order time, …) |
| `capturedAt`, `refundedAt` | Date? | `capturedAt` = when *we* recorded the capture (ORIGINAL wrongly used the gateway's payment-creation time) |

**Indexes (`payments`)**

| Index | Purpose |
|---|---|
| `{idempotencyKey:1}` **unique** | one payment per (ride, rider); race-proof order creation |
| `{gatewayPaymentId:1}` **unique, sparse** | a gateway payment can belong to only one Payment |
| `{gatewayOrderId:1}` | webhook lookups |
| `{refunds.gatewayRefundId:1}` (new, non-unique) | `refund.*` webhook lookups |
| `{ride:1, createdAt:-1}`, `{rider:1, …}`, `{driver:1, …}`, `{status:1, createdAt:-1}` | listing and the reconciliation sweep |
| single-field `ride`, `rider`, `driver`, `status` | (declared via `index: true`) |

> The refund lookup index is deliberately **not unique**: a unique multikey index would treat every refund without a gateway id as the same `null` key.

### 3.2 `Payment.refunds[]` — refund record (new)

| Field | Meaning |
|---|---|
| `_id` | our refund id; sent to Razorpay as `receipt` and in `notes.refundRecordId` so webhooks can find the record |
| `gatewayRefundId` | Razorpay `rfnd_…`, filled when the gateway acknowledges it |
| `amountPaise` | refunded amount |
| `status` | `PENDING` (booked, not yet confirmed) → `PROCESSED`; or `FAILED` (booking undone) |
| `origin` | `APP` (admin API) or `GATEWAY` (discovered from a webhook — e.g. started in the Razorpay dashboard) |
| `reason`, `initiatedBy` | why / which admin |
| `driverReversalPaise`, `platformReversalPaise` | how the refund was split when it was booked (sum = `amountPaise`) |
| `ledgerTransactionId` | the ledger transaction that booked it |
| `compensationLedgerTransactionId` | the transaction that undid it (only if `FAILED`) |
| `driverClawbackRequired` | true when the driver's payout had already been sent / was in flight |
| `failureReason`, `processedAt`, `createdAt` | audit |

### 3.3 `LedgerEntry` (append-only)

One row = one **leg** of a transaction. A transaction = ≥ 2 legs sharing `transactionId` whose debits equal credits.

| Field | Meaning |
|---|---|
| `transactionId` | UUID shared by all legs of one transaction (may be pre-allocated by the caller) |
| `account` | `RIDER`, `PLATFORM`, `DRIVER`, **`BANK`** (new: money that left to an external bank) |
| `ownerId` | **new** — which rider / driver the leg belongs to (`PLATFORM`, `BANK`: none). Enables per-driver balances. |
| `entryType` | `DEBIT` or `CREDIT` |
| `amountPaise` | integer > 0 (a zero leg is never stored) |
| `referenceType`, `referenceId` | `PAYMENT` / `REFUND` (→ payment id), `PAYOUT` (→ payout id), `ADJUSTMENT` |
| `idempotencyKey`, `legIndex` | **new** — logical posting key + position; **unique together** |
| `description`, `metadata`, `createdAt` | audit |

**Sign convention used by this ledger (read this once, then everything is consistent):**
**DEBIT = value leaves that account. CREDIT = value arrives at that account.**
So a rider payment DEBITs `RIDER` and CREDITs `PLATFORM` and `DRIVER`. A driver's **balance** (what the platform still owes them) is `credits − debits` on `DRIVER` for that `ownerId`.

**Indexes (`ledger entries`)**: single-field `account`, `referenceType`, `referenceId`, `transactionId`; compound `{account, createdAt}`, `{referenceType, referenceId}`, **new** `{account, ownerId, createdAt}`; **new** unique partial `{idempotencyKey, legIndex}` where `idempotencyKey` is a string (rows written before this upgrade are outside the index).

**Immutability (enforced by the model):** `updateOne`, `updateMany`, `findOneAndUpdate`, `findOneAndDelete`, `deleteOne`, `deleteMany` (ORIGINAL) **plus** `replaceOne`, `findOneAndReplace`, `doc.deleteOne()` and `doc.save()` on an existing entry (UPGRADED). Corrections are made by posting **new** transactions, never by editing rows.

### 3.4 `Payout`

| Field | Meaning |
|---|---|
| `driver`, `payment`, `ride` | who is paid, for which payment/ride |
| `amountPaise`, `currency`, `mode` | amount; `IMPS`/`NEFT`/`RTGS`/`UPI` |
| `status` | `PENDING` → `PROCESSING` → `PROCESSED` → (`REVERSED`); or `FAILED`; or `CANCELLED` |
| `gatewayPayoutId` | RazorpayX `pout_…` (**unique, sparse**) |
| `utr` | bank reference once processed *(new)* |
| `ledgerTransactionId`, `reversalLedgerTransactionId` | postings made at `PROCESSED` / `REVERSED` *(new)* |
| `processedAt`, `failedAt`, `reversedAt`, `failureReason`, `metadata` | audit (`failedAt` was written by the ORIGINAL code but **missing from the schema**, so Mongoose silently dropped it) |

**Indexes:** `{gatewayPayoutId:1}` unique sparse; **new** unique partial `payment_1_live_unique` = `{payment:1}` where `status ∈ {PENDING, PROCESSING, PROCESSED}` ⇒ **at most one live payout per payment** (needs MongoDB ≥ 6.0); `{payment:1, createdAt:-1}`; `{driver:1, status:1, createdAt:-1}`; single-field `driver`, `ride`, `status`.

### 3.5 Redis keys

| Key | Value / TTL | Purpose |
|---|---|---|
| `lock:payment:order:<rideId>` | random token, 60 s | only one request creates the order for a ride |
| `lock:payment:refund:<paymentId>` | random token, 30 s | serialises *all* refund mutations of one payment (API, webhooks, reconciliation) |
| `webhook:razorpay:processed:<eventId>` | `"processing"` 5 min → `"done"` 7 days | webhook de-duplication (3-step protocol, §4.6) |
| `lock:payment:reconciliation` | token, 0.8 × job interval | one reconciliation runner across all instances |

Locks are released with an atomic Lua *compare-and-delete*, so a process whose lock expired can never delete the lock of the process that took over.

### 3.6 Constants (`constants/payment.constants.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `MIN_PAYMENT_AMOUNT_PAISE` / `MAX_…` | 100 / 5 000 000 | ₹1 … ₹50 000 per payment |
| `IDEMPOTENCY_LOCK_TTL_MS` | 60 000 | order-creation lock |
| `REFUND_LOCK_TTL_MS` | 30 000 | refund lock |
| `WEBHOOK_DEDUPE_TTL_SECONDS` | 604 800 | "done" marker lifetime |
| `WEBHOOK_PROCESSING_TTL_SECONDS` | 300 | "processing" marker lifetime |
| `MAX_PAYMENT_ATTEMPTS` | 8 | failed attempts after which re-opening checkout is refused |
| `RECONCILE_MIN_AGE_MINUTES` / `MAX_AGE_DAYS` / `BATCH_LIMIT` | 10 / 7 / 100 | sweep window and batch size |
| `RECONCILE_UNSENT_REFUND_GIVE_UP_MINUTES` | 60 | grace period before an unacknowledged refund booking is undone |
| `CAPTURABLE_FROM_STATUSES` | CREATED, PENDING, AUTHORIZED, FAILED, CANCELLED | statuses from which a gateway "captured" is accepted |
| `PAID_STATUSES` | CAPTURED, PARTIALLY_REFUNDED, REFUNDED | money has been captured |
| `REFUNDABLE_STATUSES` | CAPTURED, PARTIALLY_REFUNDED | refunds/payouts allowed |
| `UNSETTLED_STATUSES` | CREATED, PENDING, AUTHORIZED, FAILED | still waiting for money (reconciliation sweep) |
| `LIVE_PAYOUT_STATUSES` | PENDING, PROCESSING, PROCESSED | payout "reserves" the driver's money |

---

## 4. The payment lifecycle, step by step

### 4.1 The big picture

**Payment status machine (UPGRADED)**

```
                      verify OK              gateway "captured"
   ┌─────────┐   ┌──────────────┐   ┌──────────────────────────────┐   refund(s)      ┌───────────────────┐
   │ CREATED ├──▶│   PENDING    ├──▶│          CAPTURED            ├─────────────────▶│ PARTIALLY_REFUNDED│
   └────┬────┘   └──────┬───────┘   └──────────────┬───────────────┘                  └─────────┬─────────┘
        │  ▲            │  ▲                       │ full refund                                │ rest refunded
        │  │reopen      │  │                       ▼                                            ▼
        │  │(retry)     │  │              ┌────────────────┐                          ┌────────────────┐
        │  └────────┐   │  │              │    REFUNDED    │◀─────────────────────────┤  (REFUNDED)    │
        │           │   ▼  │              └────────────────┘                          └────────────────┘
        │        ┌──┴───────┴─┐   payment.failed (an ATTEMPT failed — NOT terminal)
        └───────▶│   FAILED   │◀──── from CREATED / PENDING / AUTHORIZED / FAILED
   payment.      └─────┬──────┘
   authorized          │  gateway "captured" is still accepted from FAILED
        ▼              ▼
   ┌────────────┐   (→ CAPTURED)              CANCELLED: reserved, no code path sets it today
   │ AUTHORIZED │──────────────────────────▶ CAPTURED
   └────────────┘
```

Rules that hold everywhere:

- A move happens **only** through a compare-and-swap that names the allowed *from*-states.
- `CAPTURED`, `PARTIALLY_REFUNDED`, `REFUNDED` are "paid" states; nothing ever moves a paid payment back to an unpaid state.
- `FAILED` means "the **last attempt** failed". The Razorpay order stays open (Razorpay lets a customer retry on the same order), so a later capture is accepted.
- A refund that fails moves the payment **backwards among the paid states** (`REFUNDED → PARTIALLY_REFUNDED → CAPTURED`) because the refunded total shrinks.

**End-to-end sequence (happy path)**

```
Rider app          UrbanFleet API                    Redis     MongoDB            Razorpay
   │ POST /payments/orders {rideId}                                                   │
   ├──────────────────▶│ authMiddleware → validate                                    │
   │                   │ ride = findById; owner? payable?                             │
   │                   │ findByIdempotencyKey ───────────────────▶│ (miss)            │
   │                   │ SET lock:payment:order:<ride> NX ──▶│                        │
   │                   │ re-read ride, validate fare, re-check key                    │
   │                   │ orders.create(amount = ride fare) ─────────────────────────▶│
   │                   │◀────────────────────────────────────────────────── order_id │
   │                   │ insert Payment {CREATED} ───────────────▶│                   │
   │                   │ DEL lock (Lua compare-and-delete) ──▶│                       │
   │◀──────────────────┤ 201 {gatewayOrderId, amountPaise, razorpayKeyId, status}     │
   │                                                                                  │
   │ Razorpay Checkout(order_id, key) ───────────────────────────────────────────────▶│
   │◀───────────────────────────── handler(razorpay_payment_id, order_id, signature)  │
   │ POST /payments/verify {…3 fields…}                                               │
   ├──────────────────▶│ HMAC check → ownership → CAS CREATED|FAILED→PENDING          │
   │                   │ payments.fetch(pay_id) ────────────────────────────────────▶│
   │                   │◀──────────────────────────────────────── status: captured    │
   │                   │ handlePaymentCaptured ── one DB transaction:                 │
   │                   │    1 CAS →CAPTURED  2 ledger legs  3 ride.paymentStatus      │
   │◀──────────────────┤ 200 {status: CAPTURED}          (+ socket event to both)     │
   │                                                                                  │
   │                   │◀──── POST webhook payment.captured (+ order.paid) ───────────┤
   │                   │ dedupe → handlePaymentCaptured → already CAPTURED → no-op    │
   │                   │ 200 {status:"ok"}                                            │
```

The rider's `/verify` and Razorpay's webhook race each other; whichever arrives first records the capture, the other is a harmless no-op.

---

### 4.2 Phase 0 — preconditions

A payment can only start when the ride is **finished and unpaid**:

- `ride.status === ARRIVED_AT_DESTINATION`
- `ride.paymentStatus ∈ {PENDING, FAILED}` (`FAILED` = the rider is retrying)
- the caller is the ride's **rider**
- the ride has an assigned **driver** and a stored **`fare.breakdown`**

The fare breakdown is produced by your ride module. The payment module *trusts the stored numbers but re-validates them* (§4.3, step 7).

---

### 4.3 Phase 1 — create the order (`POST /payments/orders`)

**Controller** (`createOrder`): requires `req.userId` (else `401 UNAUTHENTICATED`), takes `rideId` from the validated body, derives

```
idempotencyKey = sha256_hex("<rideId>:<riderId>")
```

and calls `paymentService.createOrder({ ride, rider, idempotencyKey })`. The client cannot influence the key (the ORIGINAL controller already ignored a client-supplied key, but its validation schema still **required** a `driverId` and a full `fareBreakdown` in the request body even though the server never used them — both are now dropped from the schema).

**Service** (`createOrder`), in order:

| # | Step | Failure → |
|---|---|---|
| 1 | Load the ride | `404 RIDE_NOT_FOUND` |
| 2 | **Ownership first** — `ride.rider === caller` | `403 FORBIDDEN` (moved *before* the state check so strangers learn nothing about a ride) |
| 3 | Ride is `ARRIVED_AT_DESTINATION` and payable (`PENDING`/`FAILED`) | `400 RIDE_NOT_READY_FOR_PAYMENT` |
| 4 | **Fast path**: a Payment with this idempotency key exists → `resumeOrder()` (see below) and return | — |
| 5 | Acquire `lock:payment:order:<rideId>` (`SET NX PX 60000`) | `409 PAYMENT_ORDER_IN_PROGRESS` (double-click while the first request runs) |
| 6 | Inside the lock: re-load the ride; driver assigned?; fare breakdown present? | `404`, `400 DRIVER_NOT_ASSIGNED`, `500 FARE_BREAKDOWN_MISSING` |
| 7 | **Validate the fare** (`validateFareBreakdown`) | `422 FARE_BREAKDOWN_INVALID` / `422 PAYMENT_AMOUNT_OUT_OF_RANGE` |
| 8 | Ride still payable? | `409 PAYMENT_ALREADY_COMPLETED` |
| 9 | Re-check the idempotency key (a concurrent request may have won while we waited) → `resumeOrder()` | — |
| 10 | `razorpay.orders.create({ amount: totalPaise, currency: "INR", receipt: rideId, payment_capture: true, notes: {ride, rider, driver} })` | Razorpay error propagates |
| 11 | Insert `Payment{status: CREATED, attemptNumber: 1, refundedAmountPaise: 0, fareBreakdown snapshot, idempotencyKey, …}` | on duplicate key (E11000): the other request won → return *its* payment (before: `500`) |
| 12 | Release the lock (`finally`) | — |
| 13 | Return `{paymentId, gatewayOrderId, amountPaise, currency, razorpayKeyId, status}` | — |

**Fare validation rules (step 7)** — all must hold:

1. every one of the 7 components is a **safe non-negative integer** (new: fractional paise are rejected);
2. `base + distance + time + surge == total`;
3. `driverEarning + platformCommission == total`;
4. `100 ≤ total ≤ 5 000 000`.

Rules 2–4 existed; rule 1 is new.

**Why two idempotency checks and a lock?** Check 4 makes the common case (page reload, retry) cheap and lock-free. The lock (step 5) stops two *simultaneous first* requests from creating two Razorpay orders. The re-check (9) closes the window between (4) and (5). The unique index on `idempotencyKey` (step 11) is the last line of defence if the lock expired mid-request (a Razorpay call slower than 60 s).

**`resumeOrder()` — how retries work (new)**

The same (ride, rider) always maps to the same Payment. When asked again:

- If the stored `amountPaise` no longer equals the ride's fare → `409 PAYMENT_AMOUNT_CHANGED` (the rider must not pay a stale amount).
- If the payment is not `FAILED` → return the same order (idempotent).
- If it is `FAILED`:
  - `attemptNumber > 8` → `409 PAYMENT_ATTEMPTS_EXHAUSTED` (guards against card-testing);
  - otherwise **re-open the same order**: CAS `FAILED → CREATED`, put `ride.paymentStatus` back to `PENDING` (only if it is currently `FAILED`), return the *same* `order_…`.

Re-using the order (instead of creating a second one) means a rider can never end up paying two different orders for one ride.

---

### 4.4 Phase 2 — Razorpay Checkout (outside this module)

The app opens Checkout with `key = razorpayKeyId` and `order_id = gatewayOrderId`. Razorpay collects the payment (UPI/card/netbanking/wallet) and — if the customer succeeds — calls the client `handler` with `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`. If an attempt fails, Checkout offers "retry" *inside the same modal on the same order*; each failed attempt produces a `payment.failed` webhook, the successful one `payment.captured`.

With `payment_capture: true` Razorpay captures automatically after authorisation, so the usual sequence of webhooks is `payment.authorized → payment.captured → order.paid`.

---

### 4.5 Phase 3 — verify (`POST /payments/verify`)

Purpose: give the rider an **immediate** answer without waiting for the webhook.

| # | Step | Failure → |
|---|---|---|
| 1 | `RAZORPAY_KEY_SECRET` configured | `500 PAYMENT_CONFIG_MISSING` |
| 2 | `expected = HMAC-SHA256(key_secret, "<order_id>\|<payment_id>")`; compare with the supplied signature using `timingSafeEqual` (length checked first) | `400 PAYMENT_SIGNATURE_INVALID` — **before any DB access** |
| 3 | Load Payment by `gatewayOrderId` | `404 PAYMENT_NOT_FOUND` |
| 4 | **Ownership** — caller must be `payment.rider` *(new)* | `403 FORBIDDEN` |
| 5 | Already paid (`CAPTURED`/`PARTIALLY_REFUNDED`/`REFUNDED`)? return that status | — |
| 6 | CAS `{CREATED, FAILED} → PENDING`, store `gatewayPaymentId` *(FAILED added: a retry on the same order)* | — |
| 7 | `razorpay.payments.fetch(payment_id)` — if Razorpay's read API fails, **do not fail** the request (signature is valid); return the current status, the webhook will finish | — |
| 8 | `fetched.order_id === payment.gatewayOrderId` *(new)* | `409 PAYMENT_ORDER_MISMATCH` |
| 9 | `captured` → `handlePaymentCaptured()` and return `CAPTURED`; `failed` → `handlePaymentFailed()` and return `FAILED`; otherwise return `PENDING` | — |

A valid signature proves the `(order_id, payment_id)` pair came from a genuine Razorpay checkout for **your** key. It does *not* prove the payment is captured — hence step 7.

The response `{data:{status}}` is one of `CAPTURED`, `PENDING`, `FAILED`, `REFUNDED`, `PARTIALLY_REFUNDED`. `PENDING` means "signature ok, capture not confirmed yet" — the client should wait for the socket event or poll.

---

### 4.6 Phase 4 — webhooks

**Endpoint:** `POST <mount>/razorpay` (`routes/webhook.routes.ts`) with `express.raw({type:"application/json"})`. The **raw bytes** are required because the signature is computed over the exact body Razorpay sent; if `express.json()` ran first, verification would be impossible (§11.1).

**Controller pipeline (`handleRazorpayWebhook`)**

1. `RAZORPAY_WEBHOOK_SECRET` set? else `500 WEBHOOK_SECRET_MISSING`.
2. `x-razorpay-signature` header present **and** body is a `Buffer`? else `400 INVALID_WEBHOOK_REQUEST`.
3. `HMAC-SHA256(webhook_secret, rawBody)` == header (timing-safe)? else `400 INVALID_WEBHOOK_SIGNATURE`.
4. Parse JSON (`400 INVALID_WEBHOOK_PAYLOAD` if malformed).
5. `webhookService.handleEvent(payload, x-razorpay-event-id)`.
6. Log **ids only** as one structured line (the ORIGINAL printed banner-style `console.log` debug lines), respond `200 {status:"ok"}`.

Anything thrown reaches your error middleware → non-2xx → **Razorpay retries** (exponential back-off for ~24 h).

**The de-duplication protocol (fixed).** Razorpay delivers *at least once*, so the same event can arrive several times. The key is the `x-razorpay-event-id` header (fallback: `event:entityId:created_at`).

```
            claim(key)                       dispatch(event)               complete(key)
   SET key "processing" NX EX 300  ──▶  run the handler (idempotent) ──▶  SET key "done" EX 604800
        │ fails (key exists)                     │ throws
        ▼                                        ▼
   "duplicate" → 200, skip          retryable? DEL key, rethrow  → non-2xx → Razorpay retries → reprocessed
                                    NonRetryable? complete(key) → 200 (+ error log)
```

- ORIGINAL: `SET key NX EX 7d` **before** the handler. If the handler failed once (DB blip), the retry found the key and was skipped ⇒ the capture was *never* recorded.
- UPGRADED: the "done" marker exists only after success. While an event is in flight the short "processing" marker makes concurrent deliveries skip. **If Redis is down the protocol fails open** (process without dedupe) because every handler is idempotent on its own (CAS + unique indexes); dedupe is an optimisation, not the safety mechanism.

**Dispatch table**

| Razorpay event | Handler | Effect |
|---|---|---|
| `payment.authorized` | `paymentService.handlePaymentAuthorized` | CAS `{CREATED,PENDING} → AUTHORIZED` (informational) |
| `payment.captured` | `handlePaymentCaptured` | record the capture (§4.7) |
| `order.paid` | `handlePaymentCaptured` (uses the payment inside the event) | second, independent capture signal — safe because capture is idempotent |
| `payment.failed` | `handlePaymentFailed` | record a failed attempt (§4.8) |
| `refund.created` / `refund.processed` / `refund.failed` | `refundService.handleGatewayRefundEvent(kind, entity)` | settle / compensate / discover dashboard refunds (§4.10) |
| `payout.initiated` | `payoutService.handleGatewayPayoutEvent` | `PENDING → PROCESSING` |
| `payout.processed` | same | `→ PROCESSED` + ledger `DRIVER → BANK` |
| `payout.failed`, `payout.rejected` | same | `→ FAILED` |
| `payout.reversed` | same | `PROCESSED → REVERSED` + ledger reversal (or `FAILED` if never processed) |
| anything else | ignored | outcome `ignored`, still `200` |

**Which errors are retried?**

| Error | Meaning | Answer |
|---|---|---|
| database down, Redis lock busy, unexpected exception | transient | **non-2xx** → Razorpay retries; dedupe marker released |
| `NonRetryablePaymentError`: unknown order (`404 PAYMENT_NOT_FOUND`), amount/currency mismatch (`409`), malformed payload (`400`), unknown payout | retrying can never fix it | **200** + `webhook.non_retryable_error` log ⇒ a human is alerted, Razorpay stops retrying (and does not auto-disable the webhook) |

This matters in practice: if the same Razorpay account also serves another product, its events would otherwise be answered with 404 forever.

---

### 4.7 Phase 5 — the capture (the critical section)

`paymentService.handlePaymentCaptured(entity)` is called by **verify**, by **`payment.captured`**, by **`order.paid`** and by **reconciliation**. It must be safe to call any number of times, in any order, concurrently.

**Pre-checks (no writes):**

1. `entity.order_id` and `entity.id` present → else non-retryable `400 INVALID_CAPTURE_PAYLOAD`.
2. Payment found by `gatewayOrderId` → else non-retryable `404 PAYMENT_NOT_FOUND`.
3. Already `CAPTURED`/`PARTIALLY_REFUNDED`/`REFUNDED` → return (idempotent fast path).
4. `entity.amount === payment.amountPaise` → else non-retryable `409 PAYMENT_AMOUNT_MISMATCH` (+ `payment.amount_mismatch` error log).
5. `entity.currency === payment.currency` (new) → else non-retryable `409 PAYMENT_CURRENCY_MISMATCH`.

**One database transaction (`session.withTransaction`):**

```
 ① CLAIM   paymentRepository.transitionStatus(
               paymentId,
               from  = {CREATED, PENDING, AUTHORIZED, FAILED, CANCELLED},
               set   = {status: CAPTURED, gatewayPaymentId, method, capturedAt: now, ledgerTransactionId: <new uuid>})
           → null?  another request already recorded it → return, NOTHING has been written
 ② LEDGER  ledgerService.recordPaymentCapture(claimedPayment, transactionId)
               RIDER    DEBIT   amountPaise
               PLATFORM CREDIT  platformCommissionPaise   (skipped if 0)
               DRIVER   CREDIT  driverEarningPaise        (skipped if 0)
 ③ RIDE    Ride.findByIdAndUpdate(ride, {paymentStatus: CAPTURED})
           → ride missing? throw 404 → the whole transaction (including ①) rolls back
```

**After commit (best effort):** `emitPaymentCaptured` to the driver's and the rider's sockets; a failing socket does **not** fail the capture (the money is already recorded).

**Why "claim first" is the fix for F-02.** In the ORIGINAL the order was *ledger → CAS*, and a lost CAS just `return`ed — but the transaction then **committed** the ledger rows it had already inserted. Two racing captures (or one capture whose transaction the driver transparently retried after a write conflict) produced two full sets of ledger rows. Now the CAS is the first write; the loser writes nothing. As a second safety net, the ledger rows carry the key `payment:<paymentId>:capture` and a unique index on `(idempotencyKey, legIndex)` — even a future coding mistake cannot post the capture twice.

**Why `FAILED` and `CANCELLED` are in the "capturable-from" list (fix for F-04).** If money was captured at the gateway, that is a fact. Refusing to record it because *we* had marked an earlier attempt as failed leaves the customer charged and the ride unpaid.

**Why `capturedAt` is `now`.** Razorpay's payment entity only has `created_at` (when the payment *attempt* began); the ORIGINAL stored that as "captured at". The upgraded value is the moment the capture was recorded.

---

### 4.8 Phase 6 — failed attempts and the retry path

`handlePaymentFailed(entity)` (from `payment.failed` or from `verify` when Razorpay reports `failed`):

1. No `order_id` (payment not created through one of our orders) → ignore.
2. Unknown order → log a warning, ignore.
3. Payment already paid, **or** `lastFailedGatewayPaymentId === entity.id` (duplicate delivery) → ignore.
4. One atomic update `recordFailedAttempt`: `status → FAILED`, `failureReason`, `failureCode`, `lastFailedGatewayPaymentId`, **`attemptNumber + 1`**, allowed only from `{CREATED, PENDING, AUTHORIZED, FAILED}` and only if this `entity.id` was not recorded yet. If it returns null (captured meanwhile / already recorded) stop.
5. `Ride.updateOne({_id, paymentStatus: PENDING}, {paymentStatus: FAILED})` — **conditional**, so a stale failure can never overwrite a ride that has already been paid.

The customer's options after a failure:

- **Inside the open Checkout modal:** retry on the same order → later `payment.captured` → accepted (the fix for card-fails/UPI-succeeds).
- **From your app:** call `POST /payments/orders` again → `resumeOrder()` re-opens the *same* order (`FAILED → CREATED`, ride back to `PENDING`).

Event ordering is not guaranteed by Razorpay; the design tolerates all orders:

| Arrival order | Result |
|---|---|
| failed(1) → captured(2) | `FAILED` then `CAPTURED` ✔ |
| captured(2) → failed(1) (late) | second event ignored (already paid) ✔ |
| failed(1) delivered twice | second ignored (`lastFailedGatewayPaymentId`) ✔ |
| captured via `/verify` and via webhook simultaneously | one wins the CAS, the other writes nothing ✔ |

---

### 4.9 Phase 7 — the ledger

#### 4.9.1 Posting rules (all in `ledger.service.ts`)

Every money movement is defined in exactly one method, so the accounting can be audited by reading one file.

| Event | Method | Legs | Idempotency key |
|---|---|---|---|
| Rider payment captured | `recordPaymentCapture` | `RIDER` **DEBIT** total · `PLATFORM` **CREDIT** commission · `DRIVER` **CREDIT** driver earning | `payment:<id>:capture` |
| Refund booked | `recordRefundBooking` | `RIDER` **CREDIT** amount · `PLATFORM` **DEBIT** its share · `DRIVER` **DEBIT** its share | `refund:<paymentId>:<refundId>:book` |
| Refund failed (undo) | `recordRefundCompensation` | exact mirror of the booking | `refund:<paymentId>:<refundId>:undo` |
| Payout processed | `recordPayoutDisbursement` | `DRIVER` **DEBIT** amount · `BANK` **CREDIT** amount | `payout:<id>:disburse` |
| Payout returned by bank | `recordPayoutReversal` | `BANK` **DEBIT** · `DRIVER` **CREDIT** | `payout:<id>:reverse` |

Zero-paise legs are skipped (a 0 % commission fare posts only `RIDER` and `DRIVER`); the generic validator still rejects zero/fractional legs so mistakes cannot slip in.

#### 4.9.2 Worked example — a ₹250.00 ride

Fare (paise): base 10 000 · distance 9 000 · time 4 000 · surge 2 000 = **25 000**. Commission 20 % = **5 000**, driver earning = **20 000**.

**(a) Capture**

| Account | Owner | Type | Amount |
|---|---|---|---|
| RIDER | rider | DEBIT | 25 000 |
| PLATFORM | — | CREDIT | 5 000 |
| DRIVER | driver | CREDIT | 20 000 |

Debits 25 000 = credits 25 000 ✔ · driver balance = 20 000 − 0 = **₹200.00**.

**(b) Partial refund of ₹100.00 (10 000)** — split proportionally: driver = ⌊10 000 × 20 000 / 25 000⌋ = 8 000, platform = 2 000.

| Account | Type | Amount |
|---|---|---|
| RIDER | CREDIT | 10 000 |
| PLATFORM | DEBIT | 2 000 |
| DRIVER | DEBIT | 8 000 |

**(c) Refund of the remaining ₹150.00 (15 000)** — cumulative refund is now 25 000 ⇒ driver target = 20 000, already reversed 8 000 ⇒ **12 000**; platform **3 000**.

Net effect after (b)+(c): RIDER +25 000 − 25 000 = 0 · PLATFORM 5 000 − 2 000 − 3 000 = **0** · DRIVER 20 000 − 8 000 − 12 000 = **0**. The ledger nets out **exactly**.

**(d) Payout instead of refund**: after (a) the platform sends the driver ₹200 → `DRIVER DEBIT 20 000 / BANK CREDIT 20 000` ⇒ driver balance 0.

#### 4.9.3 Guarantees and how each is enforced

| Guarantee | Enforced by |
|---|---|
| Every transaction balances | `recordTransaction` refuses unbalanced input (`LEDGER_UNBALANCED`); reconciliation re-checks every stored transaction |
| Amounts are positive integers | validator (`LEDGER_INVALID_AMOUNT`) **and** the schema validator |
| A posting is written once | unique partial index `(idempotencyKey, legIndex)`; duplicate → `409 LEDGER_DUPLICATE_POSTING` |
| Rows are never edited or deleted | model hooks on every update/replace/delete path (§3.3) |
| Ledger and payment change atomically | both written inside one Mongo transaction |
| Whole-ledger invariant Σdebits = Σcredits | `reconciliationService.verifyLedgerIntegrity()` |

> **Hardening tip (outside the code):** give the application's MongoDB user only `insert` and `find` on the ledger collection. Mongoose hooks cannot stop someone using the raw driver (`collection.updateOne`), a database role can.

---

### 4.10 Phase 8 — refunds

**Who / how:** `POST /payments/:paymentId/refund` — **admin only** (`requireAdmin`), body `{ amountPaise?: int>0, reason: 3..500 chars }`. No amount = refund everything still refundable.

A refund touches three systems (our DB, our ledger, Razorpay) that cannot be committed together. The design books our side first, then asks the gateway, then settles:

```
 admin ──▶ requireAdmin ──▶ refundService.initiateRefund
                                │
                 lock:payment:refund:<id>  (409 REFUND_IN_PROGRESS if busy)
                                │
   VALIDATE  status ∈ {CAPTURED, PARTIALLY_REFUNDED}; gatewayPaymentId; capture ledger exists;
             0 < amount ≤ amountPaise − refundedAmountPaise, integer  (422 REFUND_AMOUNT_INVALID)
                                │
   1 BOOK    one DB transaction:
               a) payoutService.handleRefundBooked   (cancel a PENDING payout / flag clawback)
               b) CAS payment on (status, refundedAmountPaise) → new status, new refunded total,
                  $push refund record {PENDING, split, ledgerTransactionId, …}
               c) ledger: RIDER CREDIT / PLATFORM DEBIT / DRIVER DEBIT
                  (409 REFUND_CONFLICT if the payment changed meanwhile — nothing written)
                                │
   2 SEND    razorpay.payments.refund(pay_id, {amount, receipt: <refundId>, notes: {…, refundRecordId}})
                                │
        ┌───────────────────────┼─────────────────────────────────────────┐
     4xx rejection        timeout / 5xx / network                     success
   (definitely NOT done)   (outcome UNKNOWN)                    status pending|processed
        │                        │                                         │
   COMPENSATE:               keep booking PENDING,               3 SETTLE: store gatewayRefundId
   record FAILED, restore    log refund.gateway_outcome_unknown,  (+ PROCESSED if already processed)
   totals & status, mirror   answer 202 with refundStatus PENDING
   the ledger, → 502         reconciliation resolves it (§8)
```

**The split between driver and platform (`utils/refund-allocation.ts`).** For a refund `r` when `c` paise are already refunded, `D` = driver earning, `T` = total:

```
target_driver_cumulative = floor( (c + r) × D / T )                (BigInt integer division)
driver   = clamp(target − driver_already_reversed, 0, min(r, D − driver_already_reversed))
platform = r − driver          (capped by the platform's remaining commission; overflow → driver)
```

Properties, verified by 4 000 + 3 000 randomized simulations (including refunds that later *fail*): the two parts always add up to `r`; nothing is negative; nothing exceeds the original legs; when the payment is eventually refunded in full — in any number of steps — the driver leg is reversed by exactly `D` and the platform leg by exactly `T − D`. Rounding paise fall on the platform side (the driver's reversal rounds down).

The *already reversed* amounts are read from the stored refund records (not recomputed), so a failed-and-compensated refund is simply excluded and the next refund lands exactly. Payments refunded **before** this upgrade have only `refundedAmountPaise` (no records); that "legacy" part is attributed proportionally so old and new payments share one code path (`utils/refund-totals.ts`).

**Refund webhooks** (`handleGatewayRefundEvent`, executed under the same per-payment lock):

| Event | Record found | Effect |
|---|---|---|
| `refund.created` | yes, no gateway id yet | attach `gatewayRefundId` (this is how a booking whose HTTP answer was lost gets linked, through `notes.refundRecordId`) |
| `refund.processed` | yes | `PENDING → PROCESSED` (idempotent) |
| `refund.failed` | yes, not already `FAILED` | **compensate**: record `FAILED`, refunded total and payment status restored, ledger mirrored — the amount is refundable again |
| `created`/`processed` | **no** (refund started in the Razorpay dashboard) | **book it** (`origin: GATEWAY`): ledger reversal + record + totals; never refunds again at the gateway. Rejected + logged if the payment is not refundable or the amount exceeds what is left. |
| any | payment unknown | ignored (logged) |
| any | lock busy | `409` → retried by Razorpay |
| `processed` after we had compensated | record is `FAILED` | **not** silently re-booked: logged as `refund.event_after_compensation` for a human |

**Interplay with payouts.** A refund reduces the driver's share. `handleRefundBooked` runs inside the booking transaction: a `PENDING` payout is **cancelled** (create a smaller one later); a `PROCESSING`/`PROCESSED` payout cannot be recalled, so the refund record gets `driverClawbackRequired = true` and the driver's ledger balance simply goes lower (possibly negative) — finance can net it against future earnings.

---

### 4.11 Phase 9 — driver payouts

Status machine (compare-and-swap at every step):

```
 PENDING ──initiated──▶ PROCESSING ──processed──▶ PROCESSED ──reversed──▶ REVERSED
    │                       │                        │
    ├──failed/rejected──────┴───▶ FAILED             └─ ledger: DRIVER DEBIT / BANK CREDIT posted at this step,
    └──cancelled (refund before sending)──▶ CANCELLED     undone (BANK DEBIT / DRIVER CREDIT) on REVERSED
```

| Operation | Rules |
|---|---|
| `createPayout({driverId, paymentId, rideId, amountPaise, mode?, metadata?})` | amount positive integer; payment `CAPTURED`/`PARTIALLY_REFUNDED`; driver and ride must match the payment; `amountPaise ≤ driverEarning − driver share already refunded`; **no other live payout for the payment** (checked in code *and* by the partial unique index). Creates `PENDING`. |
| `markProcessing(id, gatewayPayoutId?)` | `PENDING → PROCESSING` |
| `markProcessed(id, gatewayPayoutId?, utr?)` | `{PENDING,PROCESSING} → PROCESSED` **and** the ledger posting in one transaction; a duplicate call is a no-op |
| `markFailed(id, reason?, gatewayPayoutId?)` | `{PENDING,PROCESSING} → FAILED`; nothing was posted, nothing to undo |
| `markReversed(id, reason?, gatewayPayoutId?)` | `PROCESSED → REVERSED` + reversal posting; if the payout never reached `PROCESSED` it simply `FAILED` |
| `getDriverBalance(driverId)` | `{earnedPaise, debitedPaise, balancePaise, reservedPaise, availablePaise}` where `available = ledger balance − PENDING/PROCESSING payouts` |

**Not implemented (deliberately):** the actual **RazorpayX payout API call** (needs a RazorpayX account, driver contacts/fund accounts, KYC/bank data your `Driver` model must hold). The service is ready for it: create the payout at RazorpayX with `reference_id = payout._id` (so webhooks can find it), then call `markProcessing(payout._id, pout_…)`; the `payout.*` webhooks do the rest. Nothing in the module *calls* `createPayout` either — decide whether to create payouts per capture or from a scheduled batch (§13).

---

## 5. HTTP API reference

Mount points are chosen in your `app.ts` (typically `/api/payments` and `/api/webhooks`). Paths below are relative to those mounts. All `/payments/*` routes sit behind `authMiddleware`. Error bodies are produced by **your** error middleware from `AppError(message, statusCode, code)`; codes are listed in Appendix A.

| Method & path | Who | Validation (zod) | Success | Notable errors |
|---|---|---|---|---|
| `POST /orders` | the ride's rider | body `{rideId: 24-hex ObjectId}` (other fields ignored) | `201 {data: {paymentId, gatewayOrderId, amountPaise, currency, razorpayKeyId, status}}` | 400 not ready · 403 not your ride · 404 · 409 in progress / attempts exhausted / amount changed · 422 fare invalid |
| `POST /verify` | the payment's rider | body `razorpay_order_id` (`order_…`), `razorpay_payment_id` (`pay_…`), `razorpay_signature` (64 hex) | `200 {data: {status}}` | 400 bad signature · 403 not your payment · 404 · 409 order mismatch |
| `GET /` | any user (admin sees all) | query `page` (default 1), `limit` (1–100, default 20), `status` (must be a `PaymentStatus`) | `200 {data: Payment[], meta: {page, limit, total, totalPages}}` | 422 |
| `GET /ride/:rideId` | participant or admin | `rideId` ObjectId | `200 {data: Payment[]}` | 403 |
| `GET /:paymentId` | participant or admin | `paymentId` ObjectId | `200 {data: Payment}` | 403 · 404 |
| `POST /:paymentId/refund` | **admin only** | `paymentId` ObjectId; body `{amountPaise?: int>0, reason: 3–500}` | `202 {message: "Refund initiated", data: {refundId, gatewayRefundId?, amountPaise, refundStatus, paymentStatus, refundedAmountPaise}}` | 401/403 · 404 · 409 not refundable / in progress / conflict · 422 amount · 502 gateway rejected |
| `POST <webhook mount>/razorpay` | Razorpay | HMAC over the raw body | `200 {status:"ok"}` | 400 bad/missing signature or payload · 500 secret missing · any other → Razorpay retries |

**Response sanitising (new).** For non-admins the payment object no longer contains `idempotencyKey`, `metadata`, `ledgerTransactionId`, `lastFailedGatewayPaymentId`, `__v`; `refunds[]` shows only `_id, amountPaise, status, createdAt, processedAt` (no ledger ids, no reversal split, no admin id). Admins receive the full document.

**Listing semantics.** Non-admins list payments where they are the **rider**. (See §11.7 about drivers.)

**Compatibility notes** — for the frontend:

- `POST /orders`: extra body fields from older clients are silently dropped — no breaking change.
- `GET /`: `data` is still an array; `meta` is additive.
- Unauthenticated requests reaching a handler now return **401 `UNAUTHENTICATED`** (was `400` with the misspelt code `Unaauthenticated`).
- `POST /:id/refund`: **breaking for non-admin callers** (intended — that was the vulnerability). It now returns `data`.

---

## 6. Security model

| Threat | Control |
|---|---|
| Rider tampers with the price | fare read from the server-side ride; client fare ignored; fare re-validated (integers, sums, range) |
| Rider pays for someone else's ride / probes ride state | ownership check happens **first**, before any state is revealed |
| Forged "payment succeeded" call | `/verify` needs a valid HMAC over `order_id\|payment_id` (needs the Razorpay **secret**); constant-time comparison; then the gateway is asked directly (`payments.fetch`) and `order_id` must match; then ownership |
| Forged webhook | HMAC-SHA256 over the **raw** body with the webhook secret, constant-time; nothing is parsed before it passes |
| Replayed webhook | de-dupe protocol + idempotent handlers (a replay can never double-post) |
| Anyone refunding money | `requireAdmin` (role checked from the database on every call); refund validated against the remaining refundable balance; per-payment lock + CAS |
| Double refund / over-refund | balance check + CAS on `(status, refundedAmountPaise)` + Redis lock + Razorpay's own limit |
| Ledger tampering | append-only model hooks (all update/replace/delete paths); unique posting keys; recommended DB-role restriction; reconciliation detects imbalance |
| Amount/currency confusion | captured amount and currency must equal the order's |
| Card testing / brute-forcing checkout | `MAX_PAYMENT_ATTEMPTS`; (recommended: rate-limit `/orders` and `/verify`, §11.9) |
| Data leakage in responses | non-admin sanitising (§5); logs contain ids/amounts only, never signatures, secrets or raw bodies |
| NoSQL injection through ids | all ids validated as 24-hex before reaching Mongoose; `status` validated as an enum |
| Secrets | `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` only from environment; the module refuses to run a check when missing (`500`) instead of comparing against `undefined` |

---

## 7. Concurrency & failure matrix

"Before" = ORIGINAL, "Now" = UPGRADED. ✔ = correct, ✘ = incorrect.

| Scenario | Before | Now |
|---|---|---|
| Rider double-clicks *Pay* | ✔ one order (lock/idempotency) | ✔ same; a lost unique-index race now returns the winner instead of `500` |
| `/verify`, `payment.captured` and `order.paid` arrive together | ✘ ledger may be posted 2–3× (rows written before the CAS, lost CAS ignored) | ✔ exactly one capture; losers write nothing; unique posting key as backstop |
| Mongo transparently retries the capture transaction | ✘ retry re-inserts ledger rows | ✔ retry loses the CAS → nothing written |
| Webhook handler fails once (DB blip) | ✘ event marked done → Razorpay's retry skipped → capture lost | ✔ marker released → retry processed |
| Same webhook delivered twice | ✔ skipped | ✔ skipped (and only after success) |
| Card attempt fails, rider retries with UPI on the same order and succeeds | ✘ later capture rejected (409); ride stays `FAILED`; **money taken, nothing recorded** | ✔ `FAILED → CAPTURED` accepted |
| Rider re-opens checkout after a failure | ✘ `400 RIDE_NOT_READY_FOR_PAYMENT` (ride `FAILED`) — no retry path | ✔ same order re-opened |
| Late `payment.failed` after the capture | ✔ ignored | ✔ ignored (+ ride update is conditional) |
| Fare with 0 commission / 0 driver earning | ✘ ledger throws forever, money captured & unrecorded | ✔ zero leg skipped |
| Captured amount differs from the order | ✘ `409` → endless retries | ✔ acknowledged with `200`, error log for a human |
| Event for an order we do not know | ✘ `404` → endless retries | ✔ acknowledged, logged |
| Redis down during webhook | ✘ request fails | ✔ fail-open (handlers are idempotent) |
| Redis down during order creation / refund | fails (lock is mandatory) | fails (unchanged — deliberate: money paths fail closed) |
| Gateway 4xx on refund | ✔ error returned, nothing changed (gateway was called first) | ✔ booking undone, `502` |
| Gateway timeout / 5xx on refund | ✘ error returned although money may have moved; DB unchanged; a retry could refund twice | ✔ booking kept `PENDING`, reconciliation resolves |
| Process crashes after booking, before calling the gateway | (n/a) | ✔ record stays `PENDING` with no gateway id → reconciliation looks for our `receipt` at the gateway; if none exists after 60 min the booking is undone |
| Process crashes after the gateway refunded, before we stored its id | ✘ books unchanged | ✔ `refund.created` webhook attaches the id via `notes.refundRecordId` |
| Gateway later marks the refund `failed` | ✘ ignored → books say refunded, rider never got money | ✔ compensating ledger transaction, refundable again |
| Refund created in the Razorpay dashboard | ✘ invisible to ledger | ✔ discovered and booked |
| Two admins refund at once | lock + amount check | lock + CAS on `(status, refundedAmountPaise)` |
| Three partial refunds summing to the full amount | ✘ per-account drift (e.g. 1 paise) | ✔ exact |
| Refund after the driver's payout was created | ✘ not considered | ✔ `PENDING` payout cancelled; otherwise clawback flagged |
| Two payouts requested for one payment | ✘ possible | ✔ rejected in code and by the partial unique index |
| Socket server down after commit | ✘ error surfaced after the money was recorded (webhook answered 5xx and was retried) | ✔ logged, ignored |

---

## 8. Operations: reconciliation, logs, alerts

### 8.1 Reconciliation service

| Method | What it does | Repairs automatically? |
|---|---|---|
| `reconcilePayment(paymentId, {checkGateway?})` | if the payment still waits for money → asks Razorpay (`orders.fetchPayments`) and records a capture it missed. If paid → verifies the ledger: exactly **one** capture transaction; balanced; RIDER debit = amount; DRIVER credit = driver earning; PLATFORM credit = commission; refund bookings net to the refund records; optionally compares status, amount and `amount_refunded` with the gateway | missed **captures** yes; everything else is **reported** in `issues[]` |
| `reconcileStalePayments({olderThanMinutes=10, maxAgeDays=7, limit=100})` | sweeps `CREATED/PENDING/AUTHORIZED/FAILED` payments in the window; one bad payment never stops the sweep | missed captures |
| `reconcilePendingRefunds(...)` | for `PENDING` refunds older than 10 min: known gateway id → fetch and apply `processed`/`failed`; unknown id → look through the payment's refunds for our `receipt`; if still nothing and older than 60 min → undo the booking | yes (same code path as the webhooks) |
| `verifyLedgerIntegrity()` | Σ debits = Σ credits over the whole ledger and no unbalanced transaction | report only |

Money discrepancies are **reported, never silently "fixed"** — they need a human.

### 8.2 The periodic job

`jobs/payment-reconciliation.job.ts` → `startPaymentReconciliationJob({intervalMs = 5 min})`. Every tick it takes `lock:payment:reconciliation` (TTL = 0.8 × interval), so with N API instances only one runs a cycle; it runs the three sweeps, logs `reconcile.cycle_done`, and logs `reconcile.ledger_unbalanced` at error level if the ledger is off. The timer is `unref()`'d and the function returns a `stop()` for graceful shutdown.

### 8.3 Structured logs (one JSON object per line)

`utils/payment-logger.ts` prints `{ts, level, scope:"payment", event, ...ids}`. It uses only `console` today; replace its body with pino/winston (or your logger) when you add structured logging — the call sites stay the same. **Never** log signatures, secrets, card data or raw webhook bodies.

Events worth alerting on:

| Event | Level | Meaning / action |
|---|---|---|
| `payment.amount_mismatch` | error | captured amount ≠ order amount — investigate immediately |
| `webhook.non_retryable_error` | error | a webhook that can never succeed (unknown order, malformed…) |
| `refund.gateway_outcome_unknown` | error | refund request timed out — check it resolves within the sweep |
| `refund.event_after_compensation` | error | gateway says a refund we had undone actually happened — **manual** fix |
| `refund.external_refund_booked` | warn | someone refunded from the dashboard (booked automatically) |
| `refund.external_refund_unbookable` / `_exceeds_balance` | error | a dashboard refund we could not book |
| `reconcile.missed_capture_found` | warn | a webhook was lost and reconciliation caught it |
| `reconcile.ledger_unbalanced` | error | ledger integrity broken |
| `payout.processed_in_unexpected_state` | error | payout webhook contradicts our state |
| `webhook.dedupe_unavailable` | warn | Redis problem (failing open) |

---

## 9. Findings in the ORIGINAL code and how they were fixed

**Evidence column:** `T` = reproduced by an automated test against the untouched original (kept as `repro_original.test.ts`); `R` = established by reading the code (file named); `M` = observed at runtime (Mongoose warnings). Line numbers refer to the ORIGINAL zip.

### 9.1 Critical and high — money correctness and security (F-01 – F-07)

Severity: F-01 … F-05 **critical**, F-06 and F-07 **high** (see the table in §1.2).

| ID | Where | Problem | Evidence | Fix |
|---|---|---|---|---|
| **F-01** | `routes/payment.routes.ts`, `controllers/payment.controller.ts` (`refundPayment`), `services/payment.service.ts` (`initiateRefund`) | The refund route has only `authMiddleware`; neither controller nor service checks a role. **Any authenticated user could refund any payment.** | R | `requireAdmin` middleware on the route (role read from the DB); refund result returned to the caller |
| **F-02** | `payment.service.ts` `handlePaymentCaptured` | Inside the transaction the ledger rows are inserted **first**, then the status CAS runs; when the CAS returns `null` the callback simply `return`s — and the transaction **commits** the already-inserted ledger rows. Two racing captures (verify + `payment.captured` + `order.paid`) or one transparently-retried transaction ⇒ duplicate postings. | T (`ledger rows are written BEFORE the status CAS…`) | CAS is the first write; loser writes nothing; unique `(idempotencyKey, legIndex)` on the ledger as a backstop |
| **F-03** | `services/webhook.service.ts` `isDuplicate` | `SET key NX EX 7d` is executed **before** the handler. A handler failure ⇒ non-2xx ⇒ Razorpay retries ⇒ the key exists ⇒ event skipped **forever**. | T (`an event that failed once is silently dropped…`) | claim (`processing`, 5 min) → complete (`done`, 7 d) on success / release on retryable failure; acknowledge non-retryable errors |
| **F-04** | `payment.service.ts` `handlePaymentFailed`, `handlePaymentCaptured`, `createOrder`; `controllers` `deriveIdempotencyKey` | `payment.failed` for **one attempt** set the payment to terminal `FAILED`. (a) A later successful attempt on the same order → `handlePaymentCaptured` threw `409` ⇒ **money captured, never recorded**. (b) `ride.paymentStatus = FAILED` made `createOrder` answer `RIDE_NOT_READY_FOR_PAYMENT` ⇒ no retry. (c) The `activePayment` branch meant to create a replacement payment could never run: the deterministic idempotency key always returned the old (failed) one. | (a) T · (b),(c) R | `FAILED` = "last attempt failed"; capture accepted from `FAILED`; `createOrder` accepts ride `FAILED`; `resumeOrder()` re-opens the same order; `attemptNumber` cap; dead branch removed |
| **F-05** | `payment.service.ts` `initiateRefund`; `webhook.service.ts` | Razorpay was called **before** the DB transaction; a DB failure afterwards ⇒ money refunded, books unchanged. The CAS result inside the refund transaction was ignored (same pattern as F-02). `refund.failed` was a no-op ⇒ ledger stays reversed although no money left. A timeout left the outcome unknown with no way to resolve it, and a retry could refund twice. | R (partly T via F-02 pattern) | book → send → settle with compensation (§4.10); refund records; `refund.*` webhooks; reconciliation |
| **F-06** | `ledger.service.ts` `reverseTransactionPartial` | Legs of the **original** transaction scaled by a floating-point `fraction` and floored, remainder pushed to the largest leg. Across several partial refunds the per-account reversal drifts from the fare split. Counter-example found by the test: payment 101 paise (driver 1, platform 100) refunded 33 + 33 + 35 ⇒ driver reversed **0**, platform reversed **101** (over-reversed by 1 paise). | T | `utils/refund-allocation.ts` — integer/BigInt, cumulative, exact at full refund (property-tested); old method kept as `@deprecated` |
| **F-07** | `ledger.service.ts` `recordTransaction` + `payment.service.ts` | A leg with `0` paise throws `LEDGER_INVALID_AMOUNT`. A fare with `platformCommissionPaise = 0` (promo, zero-commission driver) or `driverEarningPaise = 0` therefore made **every capture attempt fail** while Razorpay had already taken the money. | T | zero legs are skipped by the posting rules; validator unchanged |

### 9.2 High (F-08 – F-14)

| ID | Where | Problem | Evidence | Fix |
|---|---|---|---|---|
| **F-08** | `webhook.service.ts`, `payment.service.ts` | Unknown order / amount mismatch threw 404/409 ⇒ Razorpay retried for ~24 h and may auto-disable the webhook. | R | `NonRetryablePaymentError` ⇒ acknowledged with 200 + error log |
| **F-09** | `controllers` `verifyCheckout`; `payment.service.ts` `verifyCheckoutSignature` | Caller identity never passed to the service (any authenticated user holding a valid triple could call it); the fetched payment's `order_id` was not compared to the order. | R | `requesterId` ownership check; `order_id` comparison |
| **F-10** | `services/payout.service.ts`, `repositories/payout.repository.ts` | Payouts were a stub: no gateway call, **no ledger posting**, `payout.*` webhooks were no-ops; state changes were unconditional writes (a `FAILED` payout could be flipped to `PROCESSED`); `markFailed` wrote `failedAt`, a field **not in the schema** (silently dropped); nothing prevented two payouts for one payment. | R | CAS state machine, ledger postings, webhook handlers, `utr`/`failedAt`/… fields, partial unique index |
| **F-11** | `webhook.service.ts` | `refund.*` events ignored ⇒ dashboard refunds invisible to the ledger; failed refunds never undone. | R | `handleGatewayRefundEvent` |
| **F-12** | `models/ledger.model.ts` | Ledger legs had no owner: `DRIVER` was one account for **all** drivers, so a single driver's balance could not be computed from the ledger. | R | `ownerId`, `{account, ownerId, createdAt}` index, `getOwnerBalance`, `getDriverBalance` |
| **F-13** | `models/ledger.model.ts` | Append-only enforcement covered 6 query paths only; `replaceOne`, `findOneAndReplace`, `doc.save()` on an existing row and `doc.deleteOne()` were open. | R (hooks list) | hooks added; test attempts every path |
| **F-14** | `services/reconciliation.service.ts` | 31-line stub: counted ledger rows of one transaction; no gateway comparison, no balance check, no healing. | R | real reconciliation service + periodic job |

### 9.3 Medium / low (F-15 – F-28)

| ID | Where | Problem | Evidence | Fix |
|---|---|---|---|---|
| F-15 | `validation/payment.validation.ts` | `createOrderSchema` **required** `driverId` and a full `fareBreakdown` from the client although the server never used them (misleading; invites clients to think the client fare matters). | R | only `rideId` (24-hex) is validated; extras dropped |
| F-16 | `payment.service.ts` `createOrder` | State check ran **before** the ownership check ⇒ a stranger could learn whether a ride was ready to pay. | R | ownership first |
| F-17 | `payment.service.ts` `createOrder` | Unique-index violation on the payment insert (lock expired mid-request) surfaced as a raw duplicate-key error. | R | caught; the winner's payment is returned |
| F-18 | `payment.service.ts` | `capturedAt` was set from the gateway payment's `created_at` (start of the attempt). | R | `new Date()` at recording time |
| F-19 | `payment.service.ts` (refund notes) | `notes.reason` = the raw reason (up to 500 chars); Razorpay documents a 256-character limit per notes value. | R | truncated to 250 |
| F-20 | `controllers` `listPayments` | `page` and `limit` were read but **never used** (TypeScript reports them as unused under `noUnusedLocals`); no pagination; `status` accepted any string; drivers list nothing. | R | pagination + `meta`; `status` validated as enum |
| F-21 | validation + repositories | Ids validated only with `min(1)`; `new Types.ObjectId(<invalid>)` throws ⇒ `500`. | R | 24-hex validation on every id |
| F-22 | `controllers/payment.controller.ts` | Unauthenticated ⇒ status **400**, message and code both the typo `"Unaauthenticated"`. | R | `401 UNAUTHENTICATED` |
| F-23 | `models/payout.model.ts` | Conflicting index declarations: `gatewayPayoutId` declared both plain (`index: true`) and unique-sparse **with the same auto-generated name** (MongoDB can build only one — the uniqueness is probably not enforced in your database); `payment` and `ride` declared twice. Mongoose printed three "Duplicate schema index" warnings. | M | one declaration per key; `syncIndexes()` migration (§11.2) |
| F-24 | `payment.service.ts` `validateFareBreakdown` | Sums and range were checked but not that each component is an **integer**; fractional paise would only be rejected later (Razorpay / ledger). | R | integer + non-negative check |
| F-25 | `controllers/webhook.controller.ts` | Banner-style `console.log` debug output on every webhook. | R | one structured line with ids only |
| F-26 | `controllers/payment.controller.ts` (`getPayment`, `getPaymentsByRide`) | `payment.driver.toString() === req.userId` compares a value that the schema documents as a **`Driver`** reference with a **User** id. If `ride.driver` holds the `Driver` document id these checks never match and drivers cannot read their payments. **I cannot see your ride/driver models — not changed, flagged.** | R (needs your confirmation) | see §11.7 |
| F-27 | `payment.service.ts` | Socket emission after commit was not guarded; an exception there answered the webhook with 5xx after the money was safely recorded. | R | wrapped, logged |
| F-28 | `payment.controller.ts` (`createOrder`) | `ride: rideId` passed a **string** into `CreateOrderInput.ride: Types.ObjectId` (type-safe only because `req.body` is `any`). | R | converted to `ObjectId` |

### 9.4 Things I deliberately did **not** change

- `payment_capture: true` on order creation — keep it aligned with the auto-capture setting of your Razorpay account (§13).
- `ride.status` is not advanced by the payment module (e.g. to `COMPLETED`); that belongs to your ride state machine.
- `RidePaymentStatus` values are not extended (I do not have that enum). A refund therefore does not change `ride.paymentStatus`.
- The `Driver` ↔ `User` id question (F-26).
- The unused `reverseTransactionPartial` and `payoutRepository.updateStatus`, `paymentRepository.update/incrementAttempts` — kept for source compatibility (marked `@deprecated` where they are unsafe).

---

## 10. Change log (file by file)

**Legend:** `=` unchanged · `~` modified · `+` new.

| | File | What changed / why |
|---|---|---|
| ~ | `constants/payment.constants.ts` | + webhook events `payout.initiated`/`payout.rejected`; + dedupe "processing" TTL, `MAX_PAYMENT_ATTEMPTS`, reconciliation constants, `reconciliationLock` key; + status groups (`CAPTURABLE_FROM_STATUSES`, `PAID_STATUSES`, `REFUNDABLE_STATUSES`, `UNSETTLED_STATUSES`, `LIVE_PAYOUT_STATUSES`). Nothing removed. |
| ~ | `types/payment.types.ts` | + `LedgerAccount.BANK`, `RefundStatus`, `RefundOrigin`. Nothing removed. |
| ~ | `types/payment.models.ts` | + `IRefundRecord`; `IPayment.refunds`, `lastFailedGatewayPaymentId`; `ILedgerEntry.ownerId/idempotencyKey/legIndex`; `IPayout.utr/ledgerTransactionId/reversalLedgerTransactionId/failedAt/reversedAt`. |
| ~ | `types/payment.dto.ts` | + `InitiateRefundResult`, `VerifyCheckoutInput.requesterId`, `LedgerEntryInput.ownerId`, `RecordLedgerTransactionInput.transactionId/idempotencyKey`. |
| ~ | `types/razorpay.types.ts` | payment/refund/payout entity fields (`notes`, `receipt`, `reference_id`, `utr`, …); `RazorpayNotes` (Razorpay sends `notes: []` — an **array** — when empty). |
| + | `errors/payment.errors.ts` | `NonRetryablePaymentError`, duplicate-key and gateway-error classifiers (the SDK rejects with a plain `{statusCode, error}` object for HTTP errors and a `TypeError` for network failures). |
| + | `utils/redis-lock.ts` | `acquireLock` moved here (re-exported from `payment.service.ts` — old imports keep working). |
| + | `utils/payment-logger.ts` | structured one-line JSON logger. |
| + | `utils/refund-allocation.ts` | exact, cumulative refund split (§4.10). |
| + | `utils/refund-totals.ts` | running refund totals from refund records (+ legacy payments). |
| ~ | `models/payment.model.ts` | + `refunds` sub-schema, `lastFailedGatewayPaymentId`, refund lookup index. |
| ~ | `models/ledger.model.ts` | + `ownerId`, `idempotencyKey`, `legIndex`; owner index; unique partial posting index; + hooks for `replaceOne`, `findOneAndReplace`, `doc.deleteOne`, `doc.save` (existing). |
| ~ | `models/payout.model.ts` | + `utr`, ledger ids, `failedAt`, `reversedAt`; unique partial "one live payout per payment"; duplicate/conflicting indexes removed. |
| ~ | `repositories/payment.repository.ts` | `transitionStatus` accepts several from-states; + `recordFailedAttempt`, `bookRefund`, `updateRefundRecord`, `failRefund`, `findByGatewayRefundId`, `findByRefundRecordId`, `findUnsettled`, `findWithPendingRefunds`, `listPaginated`. `list()` unchanged. |
| ~ | `repositories/ledger.repository.ts` | `sumByAccount` takes `ownerId`; + `sumAll`, `findUnbalancedTransactions`, `findByIdempotencyKey`; entries carry the new fields. |
| ~ | `repositories/payout.repository.ts` | + `transition` (CAS), `findLiveByPayment`, `sumAmountByDriver`; `updateStatus` marked `@deprecated`. |
| ~ | `services/ledger.service.ts` | `recordTransaction` honours `transactionId`/`idempotencyKey`/owners and maps duplicate-key to `409`; + posting rules (`recordPaymentCapture`, `recordRefundBooking`, `recordRefundCompensation`, `recordPayoutDisbursement`, `recordPayoutReversal`), `getOwnerBalance`. `reverseTransactionPartial` kept, `@deprecated`. |
| ~ | `services/payment.service.ts` | order creation (ownership first, resume/re-open, E11000 handling, integer fare validation); verify (ownership, order match, tolerant fetch, retry re-open); capture (claim-first, `FAILED` accepted, non-retryable errors, `capturedAt`, best-effort notifications); failed attempts (atomic, idempotent, conditional ride update); `payment.authorized`; refunds delegated. |
| + | `services/refund.service.ts` | book → send → settle → compensate; refund webhooks; dashboard refunds; abandon unsent. |
| ~ | `services/payout.service.ts` | full state machine + ledger + webhooks + balances. Public method names/arguments unchanged (only optional parameters added). |
| ~ | `services/reconciliation.service.ts` | real reconciliation (§8.1). `reconcilePayment` return value is a superset of the old one. |
| ~ | `services/webhook.service.ts` | 3-step dedupe, `order.paid`, `payment.authorized`, `refund.*`, `payout.*`, non-retryable handling, fail-open Redis. `handleEvent` now returns an outcome string (was `void`). |
| + | `jobs/payment-reconciliation.job.ts` | periodic runner (§8.2). |
| + | `middlewares/require-admin.middleware.ts` | admin gate for refunds. |
| ~ | `validation/payment.validation.ts` | ObjectId validation, Razorpay id shapes, `status` enum, pagination defaults; `createOrderSchema` reduced to `rideId`. `fareBreakdownSchema` still exported (`@deprecated`). |
| ~ | `routes/payment.routes.ts` | `requireAdmin` on the refund route. |
| = | `routes/webhook.routes.ts` | unchanged. |
| ~ | `controllers/payment.controller.ts` | 401 handling, one user lookup per request, ownership pass-through, sanitised views, pagination, refund result. |
| ~ | `controllers/webhook.controller.ts` | structured log, `handleEvent` outcome, otherwise the same pipeline. |
| + | `docs/PAYMENT_LIFECYCLE_REPORT.md` | this file. |

Public API compatibility: **no exported symbol or class method of the ORIGINAL was removed** (checked mechanically). Behavioural changes are intentional and listed in §5 and §9.

---

## 11. What you must change in the rest of the project

### 11.1 `app.ts` — mount order (**critical**)

The webhook route needs the **raw** body. Mount it **before** anything that parses or rewrites bodies (`express.json()`, `express.urlencoded()`, body sanitisers, CSRF, rate-limiters that read the body):

```ts
import webhookRouter from "./payment/routes/webhook.routes.js";
import paymentRouter from "./payment/routes/payment.routes.js";

// 1) FIRST: Razorpay webhooks (this router applies express.raw() itself)
app.use("/api/webhooks", webhookRouter);          // → POST /api/webhooks/razorpay

// 2) then the normal pipeline
app.use(express.json());
// … cookie parser, CORS, CSRF, mongo-sanitize, rate limiting …

// 3) authenticated API
app.use("/api/payments", paymentRouter);
```

- If `express.json()` runs first the controller receives an object instead of a `Buffer` and answers `400 INVALID_WEBHOOK_REQUEST` for every webhook.
- Any **CSRF** middleware applied app-wide must **skip** the webhook path — Razorpay cannot send a CSRF token. Same for cookie-only CORS rules.
- The webhook URL to enter in Razorpay must be publicly reachable (use a tunnel such as ngrok in development).

### 11.2 Database indexes — run once per environment

New unique / partial indexes are declared in the models, but Mongoose only creates *missing* indexes; two old definitions must be **replaced**.

```ts
// one-off migration script (or at start-up in dev)
await Promise.all([
  PaymentModel.syncIndexes(),
  LedgerEntryModel.syncIndexes(),
  PayoutModel.syncIndexes(),
]);
```

`syncIndexes()` drops indexes that are not in the schema (the old plain `payment_1`, the old plain `gatewayPayoutId_1`) and creates the new ones. **Before** running it in an environment with data, check that no payment already has two live payouts (otherwise the new unique index cannot be built):

```js
// mongosh — must return nothing
db.payouts.aggregate([
  { $match: { status: { $in: ["PENDING", "PROCESSING", "PROCESSED"] } } },
  { $group: { _id: "$payment", n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } }
])
```

If you prefer manual control: `db.payouts.dropIndex("payment_1"); db.payouts.dropIndex("gatewayPayoutId_1");` and then let Mongoose build the new ones. (Collection names above are Mongoose's default pluralisation — check yours.)

Requirements: **MongoDB ≥ 6.0** (the `$in` inside a partial-index filter) and a **replica set** (transactions — Atlas is fine; a local `mongod` needs `--replSet rs0` + `rs.initiate()`).

### 11.3 `server.ts` — start the reconciliation job

```ts
import { startPaymentReconciliationJob } from "./payment/jobs/payment-reconciliation.job.js";

// after MongoDB and Redis are connected:
const stopReconciliation = startPaymentReconciliationJob();          // every 5 min, one runner across instances

// in your graceful-shutdown handler:
stopReconciliation();
```

### 11.4 Razorpay dashboard & environment

- **Webhook URL:** `https://<your-host>/api/webhooks/razorpay`, **secret** = `RAZORPAY_WEBHOOK_SECRET`.
- **Events to enable:** `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed`, `refund.failed`.
- **When you integrate RazorpayX payouts:** `payout.initiated`, `payout.processed`, `payout.failed`, `payout.rejected`, `payout.reversed`. RazorpayX webhooks are configured in the RazorpayX settings and may use a different secret — if so, extend `verifySignature` to try both secrets.
- **Environment variables** (no new ones): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. The module now fails with a clear `500` if one is missing instead of comparing against `undefined`.
- **Toolchain:** `tsconfig` `target`/`lib` ≥ ES2020 (`BigInt`), Node ≥ 18, Mongoose 8, zod 4 (you already use `z.treeifyError`), `razorpay` SDK 2.x. **No new npm dependencies.**

### 11.5 Ride module (`models/ride.model.ts` and the ride flow)

- The module uses `RideStatus.ARRIVED_AT_DESTINATION` and `RidePaymentStatus.PENDING | CAPTURED | FAILED` only — confirm they exist with those meanings.
- **Allow `FAILED → PENDING`**: the payment module sets the ride back to `PENDING` when a rider re-opens checkout. If your ride code forbids that transition, adapt it.
- Make sure the **fare breakdown stored on the ride** consists of integer paise for all 7 fields and satisfies `base+distance+time+surge = total = driverEarning + platformCommission`, otherwise `createOrder` answers `422 FARE_BREAKDOWN_INVALID`.
- Nothing in the payment folder **calls `payoutService.createPayout`**. Decide where it belongs (after capture, or a scheduled daily batch per driver) — §13.
- Optional: add `REFUNDED` / `PARTIALLY_REFUNDED` to `RidePaymentStatus` and set them from the refund flow (I did not touch the ride on refunds because I could not see the enum).

### 11.6 Frontend

1. **Create order:** send only `{ rideId }` (drop `driverId`, `fareBreakdown`; they are ignored).
2. **After Razorpay Checkout → `POST /payments/verify`:** handle the returned status:

| `data.status` | UI |
|---|---|
| `CAPTURED` (or `REFUNDED`/`PARTIALLY_REFUNDED`) | success |
| `PENDING` | "confirming payment…" — wait for the `payment captured` socket event, or poll `GET /payments/ride/:rideId` |
| `FAILED` | show **Retry**: call `POST /payments/orders` again (returns the **same** order, re-opened) and reopen Checkout |

3. **Errors:** `409 PAYMENT_ORDER_IN_PROGRESS` → wait a second and retry; `409 PAYMENT_ATTEMPTS_EXHAUSTED` → contact support; `409 PAYMENT_AMOUNT_CHANGED` → reload the ride.
4. **Refunds are admin-only:** only the admin panel may call `POST /payments/:id/refund`; show `data.refundStatus` (`PENDING` = booked, awaiting the bank; `PROCESSED` = done) and the `refunds[]` list.
5. **Lists:** `GET /payments` still returns `data: []`; use the new `meta` for pagination.
6. Treat **401** as "log in again" (previously a `400`).

### 11.7 Driver-side access (please verify)

`getPayment`/`getPaymentsByRide` allow a participant when `payment.driver === req.userId`. `Payment.driver` is copied from `ride.driver` and declared as a **`Driver`** reference. If `ride.driver` stores the **Driver document id** (not the driver's User id) this comparison never matches and drivers cannot open their own payments. Two fixes: store the driver's **User id** in `ride.driver`/`payment.driver`, or look the `Driver` document up by `userId` inside `isParticipant()` in `payment.controller.ts`. `listPayments` has the same limitation (non-admins are matched as **rider** only; if a user can act as both rider and driver in your app, a `?as=driver` mode is a natural addition).

### 11.8 Sockets

`emitPaymentCaptured` is used exactly as before (driver and rider). Optional additions for a better UX: `payment:failed` (so the rider sees the retry button without polling) and `payment:refunded`.

### 11.9 Monitoring, limits, hardening

- Alert on the log events in §8.3 (start with `payment.amount_mismatch`, `webhook.non_retryable_error`, `reconcile.ledger_unbalanced`, `refund.event_after_compensation`).
- Rate-limit `POST /payments/orders`, `POST /payments/verify` and the refund route (with whatever rate limiter you use or add).
- Restrict the application's MongoDB user on the ledger collection to `insert` + `find` (the models block Mongoose paths, a DB role blocks everything).
- Keep the Razorpay **key secret** and **webhook secret** out of logs, client bundles and error responses.

---

## 12. Verification performed

I have **no** MongoDB replica set, Redis server or Razorpay account in my working environment, so verification covers everything that does not need them, and I say plainly where you must take over.

### 12.1 Static checks

- The module type-checks with **zero errors** under `strict` + `noUncheckedIndexedAccess` (NodeNext modules), and also under the stricter `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`.
- The ORIGINAL type-checked cleanly under the same stubs (baseline), so the stubs are faithful to how your code is compiled.
- A mechanical comparison shows **no exported symbol and no class method of the ORIGINAL was removed**.

### 12.2 Automated tests (Vitest)

| Suite | Tests | What it proves |
|---|---|---|
| `refund-allocation` | 10 | split always balances; exact at full refund for any partition (4 000 random cases); still exact when refunds fail and are compensated (3 000 random simulations); the 101-paise counter-example; legacy totals |
| `ledger.service` | 8 | unbalanced/zero/fractional legs rejected; idempotency key + leg index stamped; duplicate ⇒ 409; capture skips zero legs; refund booking/compensation net to zero; payout legs; owner balance |
| `payment.service` | 32 | claim-first order (`claim → ledger → ride`); lost race writes nothing; transaction retry cannot double-post; `FAILED` accepts capture; non-retryable errors; failed-attempt idempotency; order creation (server-side fare, lock, resume/re-open, attempts cap, amount changed, E11000 race, fare validation); verify (bad signature, ownership, retry, gateway hiccup, order mismatch) |
| `refund.service` | 18 | book-before-send ordering; 4xx ⇒ compensation + 502; timeout ⇒ stays PENDING; exact cumulative splits; clawback flag; validation; lock; webhooks (`processed`, `created`, `failed`, dashboard refund, unknown payment); abandon-unsent |
| `webhook.service` | 17 | signature; **failed-once-then-retried event is processed**; duplicate skip; concurrent duplicate; non-retryable acknowledged; Redis-down fail-open; routing of every event; controller pipeline |
| `payout.service` | 19 | creation rules; CAS state changes (ledger only for the winner); reversal; refund side-effects; balances; webhook routing |
| `reconciliation.service` | 13 | ledger checks find wrong legs / duplicate postings / refund mismatches; healing missed captures; sweeps; refund resolution and grace period; integrity report |
| `http-layer` | 12 | validation schemas; admin gate (403/401); controllers (401, key derivation, sanitised views, pagination, 202 refund) |
| `models` | 10 | schema validation; index definitions; **update documents cast to the intended paths** (Mongoose silently drops unknown paths); ledger rows cannot be updated/replaced/deleted on any path |
| **Total (upgraded)** | **139** | |
| `repro_original` (against the ORIGINAL) | 5 | F-02, F-03, F-04(a), F-06, F-07 reproduce |

Every "FIXED:" test in the upgraded suites mirrors a reproduction of the original defect.

### 12.3 What only you can verify (integration plan)

Use Razorpay **test mode**, a Mongo replica set and Redis:

1. **Happy path:** pay with a test card → payment `CAPTURED`; exactly 3 ledger rows (`db.ledger…find({idempotencyKey: "payment:<id>:capture"})`); ride `paymentStatus=CAPTURED`; both sockets notified; the webhooks arriving later are no-ops.
2. **Fail then succeed** in the same Checkout modal → ends `CAPTURED`, `attemptNumber` = 2.
3. **Duplicate webhook** (Appendix C) → outcome `duplicate`; ledger row count unchanged.
4. **Webhook while MongoDB is stopped** → non-2xx; start MongoDB; Razorpay's retry (or you re-send) is processed.
5. **Race:** fire `/verify` and two identical webhooks with `Promise.all` → still 3 ledger rows.
6. **Refund:** admin partial then rest → ledger nets to zero (`verifyLedgerIntegrity()` balanced; refunded total = amount); non-admin ⇒ 403; refund > remaining ⇒ 422.
7. **Refund from the Razorpay dashboard** → `origin: "GATEWAY"` record + ledger reversal.
8. **Missed webhook:** pay, block the webhook, call `reconciliationService.reconcileStalePayments({olderThanMinutes: 0})` → healed.
9. **Payout:** create a payout, simulate `payout.processed` / `payout.reversed` webhooks → ledger `DRIVER`/`BANK` legs and balances.
10. **Indexes:** after `syncIndexes()`, `db.payouts.getIndexes()` shows `payment_1_live_unique` and a single unique-sparse `gatewayPayoutId_1`.

---

## 13. Known limitations & suggested next steps

1. **Payout execution.** The RazorpayX call is not implemented (needs RazorpayX account, driver contact/fund-account data and KYC fields on `Driver`). The state machine, ledger and webhooks are ready for it (§4.11).
2. **Nobody creates payouts.** Decide: per captured payment, or a scheduled batch per driver using `getDriverBalance().availablePaise`. (A per-driver batch would want one payout per driver/day rather than per payment — the "one live payout per payment" index would then be replaced.)
3. **No admin HTTP endpoints** for reconciliation results, driver balances or payout lists; the services exist — expose them behind `requireAdmin` when you build the Finance Center screens.
4. **`CANCELLED` is never set.** If a ride is cancelled after an order was created, mark the payment `CANCELLED` (a late capture would still be accepted and would need an automatic refund).
5. **Auto-capture.** The order is created with `payment_capture: true`. Verify that this matches your Razorpay account's capture setting; with manual capture you would need an explicit capture call (not implemented).
6. **Ride payment status on refunds** (see §11.5) and **notifications** for failures/refunds (§11.8).
7. **Outbox for socket events:** today notifications are best-effort after commit; if you introduce a transactional outbox, publish the capture/refund events from it.
8. **Rate limiting & anomaly detection** for checkout attempts (§11.9).
9. **Multi-currency / multi-gateway:** currency is `INR` only and `gateway` has one value.
10. **Legacy data:** payments refunded before this upgrade have no refund records (handled proportionally); ledger rows written before it have no idempotency key (outside the unique index).

---

## Appendix A — Error-code catalogue

`AppError(message, statusCode, code)`. **Retry?** = how a *webhook* caller is answered: "ack" = `200` (non-retryable), "retry" = non-2xx so Razorpay retries.

| HTTP | Code | Raised by | Meaning | Webhook |
|---|---|---|---|---|
| 400 | `RIDE_NOT_READY_FOR_PAYMENT` | createOrder | ride not `ARRIVED_AT_DESTINATION` or not payable | – |
| 400 | `DRIVER_NOT_ASSIGNED` | createOrder | ride has no driver | – |
| 400 | `PAYMENT_SIGNATURE_INVALID` | verify | HMAC mismatch | – |
| 400 | `INVALID_CAPTURE_PAYLOAD` | capture | missing order/payment id | ack |
| 400 | `INVALID_WEBHOOK_REQUEST` / `INVALID_WEBHOOK_SIGNATURE` / `INVALID_WEBHOOK_PAYLOAD` | webhook controller/service | bad request, signature, JSON, or missing entity | 400 / 400 / ack |
| 400 | `PAYMENT_ID_REQUIRED`, `RIDE_ID_REQUIRED` | controller | missing path param | – |
| 401 | `UNAUTHENTICATED` | controller, `requireAdmin` | no/unknown user | – |
| 403 | `FORBIDDEN` | service, controller, `requireAdmin` | not owner / not participant / not admin | – |
| 404 | `RIDE_NOT_FOUND`, `USER_NOT_FOUND` | createOrder, capture, controller | – | retry (ride) |
| 404 | `PAYMENT_NOT_FOUND` | verify, capture, refund, payout, reconcile | unknown payment | **ack** (capture) |
| 404 | `PAYOUT_NOT_FOUND` | payout service | unknown payout | **ack** |
| 404/500 | `LEDGER_TRANSACTION_NOT_FOUND` | refund/ledger | capture ledger id missing | retry |
| 409 | `PAYMENT_ORDER_IN_PROGRESS` | createOrder | lock held by another request | – |
| 409 | `PAYMENT_ALREADY_COMPLETED` | createOrder | ride no longer payable | – |
| 409 | `PAYMENT_AMOUNT_CHANGED` | createOrder | fare changed since the order | – |
| 409 | `PAYMENT_ATTEMPTS_EXHAUSTED` | createOrder | > 8 failed attempts | – |
| 409 | `PAYMENT_ORDER_MISMATCH` | verify | payment belongs to another order | – |
| 409 | `PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_CURRENCY_MISMATCH` | capture | captured ≠ ordered | **ack** |
| 409 | `PAYMENT_NOT_REFUNDABLE`, `PAYMENT_NOT_CAPTURED` | refund | wrong status / no gateway payment id | – |
| 409 | `REFUND_IN_PROGRESS` | refund | lock held | retry |
| 409 | `REFUND_CONFLICT` | refund | payment changed while booking | retry |
| 409 | `PAYMENT_NOT_PAYABLE`, `PAYOUT_PAYMENT_MISMATCH`, `PAYOUT_ALREADY_EXISTS` | payout | payout rules | – |
| 409 | `LEDGER_DUPLICATE_POSTING` | ledger | the same posting key already exists | retry (should never happen) |
| 422 | `FARE_BREAKDOWN_INVALID`, `PAYMENT_AMOUNT_OUT_OF_RANGE` | createOrder | fare rules (§4.3) | – |
| 422 | `REFUND_AMOUNT_INVALID` | refund | not an integer, ≤ 0 or > remaining | – |
| 422 | `PAYOUT_AMOUNT_INVALID`, `PAYOUT_EXCEEDS_DRIVER_SHARE` | payout | payout rules | – |
| 422 | *(validation)* | zod middleware | body/params/query invalid; body `{message, errors}` | – |
| 500 | `FARE_BREAKDOWN_MISSING` | createOrder | ride has no fare | – |
| 500 | `PAYMENT_CONFIG_MISSING`, `WEBHOOK_SECRET_MISSING` | verify, webhook | env secret missing | retry |
| 500 | `LEDGER_UNBALANCED`, `LEDGER_INVALID_AMOUNT`, `LEDGER_INVALID_FRACTION` | ledger | programming/data error | retry |
| 500 | `REFUND_TOTALS_INCONSISTENT`, `REFUND_BOOKING_FAILED` | refund | data inconsistency | retry |
| 500 | `PAYMENT_CREATE_FAILED`, `PAYOUT_CREATE_FAILED` | repositories | insert returned nothing | – |
| 502 | `REFUND_GATEWAY_REJECTED` | refund | Razorpay refused (4xx) or created a failed refund; booking undone | – |

## Appendix B — Configuration reference

| Name | Where | Required | Notes |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | env | yes | public key, returned to clients as `razorpayKeyId` |
| `RAZORPAY_KEY_SECRET` | env | yes | signs `/verify` HMAC and authenticates API calls |
| `RAZORPAY_WEBHOOK_SECRET` | env | yes | signs webhooks |
| MongoDB | infra | replica set, ≥ 6.0 | transactions + partial-index `$in` |
| Redis | infra | yes | locks, webhook dedupe |
| `startPaymentReconciliationJob({intervalMs})` | code | recommended | default 5 min |
| Constants | `constants/payment.constants.ts` | – | limits, TTLs, sweep window (§3.6) |

## Appendix C — Testing webhooks by hand

```bash
export BASE=http://localhost:5000            # your API
export WEBHOOK_SECRET=<your RAZORPAY_WEBHOOK_SECRET>

BODY='{"entity":"event","account_id":"acc_test","event":"payment.captured","contains":["payment"],"created_at":1700000000,"payload":{"payment":{"entity":{"id":"pay_TEST","entity":"payment","order_id":"order_REAL","status":"captured","amount":25000,"currency":"INR","method":"upi","captured":true,"created_at":1700000000}}}}'

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')

curl -i -X POST "$BASE/api/webhooks/razorpay" \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: $SIG" \
  -H "X-Razorpay-Event-Id: evt_manual_1" \
  --data-binary "$BODY"
```

Use `--data-binary` (not `-d`) so the bytes are not altered. Sending the same command twice must produce one processed event and one `webhook.duplicate` log. Replace `order_REAL` with the `gatewayOrderId` of a real payment and `amount` with its `amountPaise`.

## Appendix D — Glossary

- **Paise** — 1/100 rupee; all amounts are integer paise.
- **Idempotent** — doing it twice has the same effect as once.
- **Compare-and-swap (CAS)** — an update that succeeds only if the document is still in the expected state; the database picks the winner of a race.
- **Transaction (Mongo)** — several writes that commit or roll back together (needs a replica set).
- **Double-entry ledger** — every event is recorded as legs whose debits equal credits.
- **Order / Payment / Refund / Payout (Razorpay)** — the order is the request to collect an amount; a payment is one attempt on it; a refund returns money; a payout sends money out (RazorpayX).
- **Webhook** — an HTTP call from Razorpay to us; delivered at least once, not in order.
- **Reconciliation** — comparing gateway, payment records and ledger, and repairing safe differences.
- **Clawback** — the driver was already paid but the rider was refunded; the driver's balance goes lower.
