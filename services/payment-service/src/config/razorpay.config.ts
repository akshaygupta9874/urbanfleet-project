import Razorpay from "razorpay";

const key_id = process.env.RAZORPAY_KEY_ID || "rzp_test_key";
const key_secret = process.env.RAZORPAY_KEY_SECRET || "sample";

export const razorpayClient = new Razorpay({
  key_id,
  key_secret,
});
