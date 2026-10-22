-- Drop 2FA and TOTP authenticator columns from users table
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_factor_enabled";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_factor_secret";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_factor_pending_secret";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_factor_setup_requested_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_factor_recovery_codes";
