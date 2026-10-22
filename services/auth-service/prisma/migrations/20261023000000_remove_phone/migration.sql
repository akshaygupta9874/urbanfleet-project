-- Drop phone column and unique index from users table
DROP INDEX IF EXISTS "users_phone_key";
ALTER TABLE "users" DROP COLUMN IF EXISTS "phone";
