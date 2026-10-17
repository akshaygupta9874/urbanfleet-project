import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [path.resolve(__dirname, "./test/setup.ts")],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ||
        process.env.DATABASE_URL ||
        "postgresql://urbanfleet:password@127.0.0.1:5432/urbanfleet?schema=public",
      REDIS_URL:
        process.env.TEST_REDIS_URL ||
        process.env.REDIS_URL ||
        "redis://127.0.0.1:6379/15",
      JWT_ACCESS_SECRET: "test-access-secret-only",
      JWT_REFRESH_SECRET: "test-refresh-secret-only",
      FRONTEND_URL: "http://localhost:5173",
      RAZORPAY_KEY_ID: "rzp_test_key",
      RAZORPAY_KEY_SECRET: "sample",
      RAZORPAY_WEBHOOK_SECRET: "your-razorpay-webhook-secret",
      SENDGRID_API_KEY: "test-sendgrid-key",
      SENDGRID_FROM_EMAIL: "test@example.com",
    },
  },
});
