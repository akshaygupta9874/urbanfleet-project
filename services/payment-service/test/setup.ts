process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://urbanfleet_payment:payment_secure_pass@127.0.0.1:5432/urbanfleet_payment?schema=public";
process.env.REDIS_URL =
  process.env.TEST_REDIS_URL ||
  process.env.REDIS_URL ||
  "redis://127.0.0.1:6379/15";

process.env.JWT_ACCESS_SECRET = "test-access-secret-only";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-only";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.SENDGRID_API_KEY = "sample";
process.env.SENDGRID_FROM_EMAIL = "sendsampleom";
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "sample";
process.env.RAZORPAY_WEBHOOK_SECRET = "your-razorpay-webhook-secret";
