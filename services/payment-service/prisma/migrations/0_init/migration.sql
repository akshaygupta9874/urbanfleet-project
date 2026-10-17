-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('RIDER', 'DRIVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SUBMITTED', 'PROCESSED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('RIDER', 'PLATFORM', 'DRIVER', 'BANK', 'RIDER_WALLET', 'DRIVER_WALLET', 'PLATFORM_COMMISSION', 'GATEWAY_CLEARING', 'TAX_COLLECTED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "ride_id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "driver_id" UUID,
    "payment_sequence" INTEGER NOT NULL DEFAULT 1,
    "gateway" VARCHAR(50) NOT NULL DEFAULT 'RAZORPAY',
    "gateway_order_id" VARCHAR(255),
    "gateway_payment_id" VARCHAR(255),
    "amount_paise" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" VARCHAR(50),
    "fare_breakdown" JSONB,
    "idempotency_key" VARCHAR(255),
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "failure_reason" TEXT,
    "failure_code" TEXT,
    "last_failed_gateway_payment_id" VARCHAR(255),
    "refunded_amount_paise" INTEGER NOT NULL DEFAULT 0,
    "ledger_transaction_id" VARCHAR(255),
    "metadata" JSONB,
    "captured_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "refunds" JSONB DEFAULT '[]',

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "reason" TEXT,
    "gateway_refund_id" VARCHAR(255),
    "ledger_transaction_id" UUID NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "payment_id" UUID,
    "ride_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "mode" VARCHAR(20) NOT NULL DEFAULT 'IMPS',
    "gateway_payout_id" VARCHAR(255),
    "utr" VARCHAR(255),
    "ledger_transaction_id" VARCHAR(255),
    "reversal_ledger_transaction_id" VARCHAR(255),
    "failure_reason" TEXT,
    "metadata" JSONB,
    "processed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "owner_id" VARCHAR(255),
    "reference_type" VARCHAR(50) NOT NULL,
    "reference_id" VARCHAR(255),
    "idempotency_key" VARCHAR(255),
    "leg_index" INTEGER,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(100) NOT NULL,
    "partition_key" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_type" VARCHAR(50) NOT NULL,
    "aggregate_id" VARCHAR(100) NOT NULL,
    "aggregate_sequence" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "locked_at" TIMESTAMP(3),
    "locked_by" VARCHAR(100),
    "lease_expires_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "event_id" UUID NOT NULL,
    "consumer_group" VARCHAR(100) NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id","consumer_group")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_ride_id_key" ON "payments"("ride_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_payment_id_key" ON "payments"("gateway_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_gateway_refund_id_key" ON "refunds"("gateway_refund_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_gateway_payout_id_key" ON "payouts"("gateway_payout_id");

-- CreateIndex
CREATE INDEX "payouts_driver_id_idx" ON "payouts"("driver_id");

-- CreateIndex
CREATE INDEX "payouts_ride_id_idx" ON "payouts"("ride_id");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_owner_id_idx" ON "ledger_entries"("account", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_leg_index_key" ON "ledger_entries"("idempotency_key", "leg_index");

-- CreateIndex
CREATE INDEX "outbox_events_status_lease_expires_at_created_at_idx" ON "outbox_events"("status", "lease_expires_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_partition_key_aggregate_sequence_idx" ON "outbox_events"("partition_key", "aggregate_sequence");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
