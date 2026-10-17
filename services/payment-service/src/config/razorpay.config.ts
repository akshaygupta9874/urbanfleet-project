import Razorpay from "razorpay";

const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  throw new Error(
    "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be defined in environment variables."
  );
}

export const razorpayClient = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

