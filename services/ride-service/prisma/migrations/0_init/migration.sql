-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('RIDER', 'DRIVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('REQUESTED', 'SEARCHING', 'OFFERED', 'ACCEPTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_PROGRESS', 'STARTED', 'ARRIVED_AT_DESTINATION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RidePaymentStatus" AS ENUM ('PENDING', 'PAID', 'CAPTURED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "rides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rider_id" UUID NOT NULL,
    "driver_id" UUID,
    "vehicle_category" VARCHAR(20) NOT NULL DEFAULT 'SEDAN',
    "status" "RideStatus" NOT NULL DEFAULT 'SEARCHING',
    "payment_status" "RidePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "ride_sequence" INTEGER NOT NULL DEFAULT 1,
    "pickup_lat" DECIMAL(10,7) NOT NULL,
    "pickup_lng" DECIMAL(10,7) NOT NULL,
    "pickup_address" VARCHAR(255) NOT NULL,
    "destination_lat" DECIMAL(10,7) NOT NULL,
    "destination_lng" DECIMAL(10,7) NOT NULL,
    "destination_address" VARCHAR(255) NOT NULL,
    "distance_km" DECIMAL(6,2) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "base_fare_paise" INTEGER NOT NULL,
    "surge_multiplier" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "total_fare_paise" INTEGER NOT NULL,
    "otp" VARCHAR(6),
    "cancelled_by" VARCHAR(20),
    "cancellation_reason" TEXT,
    "accepted_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ride_id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "feedback" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ratings_ride_id_from_id_key" UNIQUE ("ride_id", "from_id"),
    CONSTRAINT "ratings_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "topic" VARCHAR(100) NOT NULL,
    "partition_key" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_type" VARCHAR(50) NOT NULL,
    "aggregate_id" VARCHAR(100) NOT NULL,
    "aggregate_sequence" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "roles" "UserRole"[] DEFAULT ARRAY['RIDER']::"UserRole"[],

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX "rides_rider_id_idx" ON "rides"("rider_id");
CREATE INDEX "rides_driver_id_idx" ON "rides"("driver_id");
CREATE INDEX "rides_status_idx" ON "rides"("status");
CREATE INDEX "ratings_ride_id_idx" ON "ratings"("ride_id");
CREATE UNIQUE INDEX "outbox_events_aggregate_type_aggregate_id_aggregate_sequence_key" ON "outbox_events"("aggregate_type", "aggregate_id", "aggregate_sequence");
CREATE INDEX "outbox_events_status_lease_expires_at_created_at_idx" ON "outbox_events"("status", "lease_expires_at", "created_at");
CREATE INDEX "outbox_events_partition_key_aggregate_sequence_idx" ON "outbox_events"("partition_key", "aggregate_sequence");
