-- AlterTable: Add roles column with default array ['RIDER']
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles" "Role"[] NOT NULL DEFAULT ARRAY['RIDER']::"Role"[];

-- Migrate existing data from role to roles if role column exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN
    UPDATE "users" 
    SET "roles" = CASE 
      WHEN "role" = 'DRIVER' THEN ARRAY['DRIVER'::"Role", 'RIDER'::"Role"]
      WHEN "role" = 'ADMIN' THEN ARRAY['ADMIN'::"Role"]
      ELSE ARRAY['RIDER'::"Role"]
    END;
    ALTER TABLE "users" DROP COLUMN "role";
  END IF;
END $$;
