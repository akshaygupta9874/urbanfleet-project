ALTER TABLE "users"
  ADD COLUMN "is_suspended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "suspension_reason" VARCHAR(500);

CREATE TABLE "admin_audit_logs" (
  "id" UUID NOT NULL,
  "admin_user_id" UUID NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "resource" VARCHAR(50) NOT NULL,
  "resource_id" VARCHAR(100),
  "reason" VARCHAR(500),
  "metadata" JSONB,
  "ip_address" VARCHAR(45),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_admin_user_id_created_at_idx" ON "admin_audit_logs"("admin_user_id", "created_at");
CREATE INDEX "admin_audit_logs_resource_resource_id_idx" ON "admin_audit_logs"("resource", "resource_id");
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_user_id_fkey"
  FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
