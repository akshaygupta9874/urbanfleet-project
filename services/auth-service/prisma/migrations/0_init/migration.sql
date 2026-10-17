-- CreateEnum
CREATE TYPE "Role" AS ENUM ('RIDER', 'DRIVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20),
    "role" "Role" NOT NULL DEFAULT 'RIDER',
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret" VARCHAR(255),
    "two_factor_pending_secret" VARCHAR(255),
    "two_factor_setup_requested_at" TIMESTAMP(3),
    "two_factor_recovery_codes" TEXT,
    "avatar_url" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token" VARCHAR(500) NOT NULL,
    "user_agent" VARCHAR(255),
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "ip_address" VARCHAR(45),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_key" ON "sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_lease_expires_at_created_at_idx" ON "outbox_events"("status", "lease_expires_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_partition_key_aggregate_sequence_idx" ON "outbox_events"("partition_key", "aggregate_sequence");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
