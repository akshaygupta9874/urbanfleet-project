import { appApi } from "./api";

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: VerifyPaymentSignaturePayload) => void | Promise<void>;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  theme?: {
    color?: string;
  };
  modal?: {
    ondismiss?: () => void;
  };
}

export interface RazorpayInstance {
  open: () => void;
}

export interface RazorpayConstructor {
  new (options: RazorpayOptions): RazorpayInstance;
}

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "FAILED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "CANCELLED";

export interface FareBreakdownPayload {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  surgePaise: number;
  platformCommissionPaise: number;
  driverEarningPaise: number;
  totalPaise: number;
}

export interface CreatePaymentOrderInput {
  rideId: string;
  driverId: string;
  fareBreakdown: FareBreakdownPayload;
  idempotencyKey: string;
}

export interface CreatePaymentOrderResult {
  paymentId: string;
  gatewayOrderId: string;
  amountPaise: number;
  currency: string;
  razorpayKeyId: string;
  status: PaymentStatus;
}

export interface VerifyPaymentSignaturePayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface VerifyPaymentSignatureResult {
  status: PaymentStatus;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

export async function createPaymentOrder(
  input: CreatePaymentOrderInput
): Promise<CreatePaymentOrderResult> {
  const response = await appApi.post<{ data: CreatePaymentOrderResult }>(
    "/payments/orders",
    input
  );

  return response.data.data;
}

export async function verifyPaymentSignature(
  input: VerifyPaymentSignaturePayload
): Promise<VerifyPaymentSignatureResult> {
  const response = await appApi.post<{ data: VerifyPaymentSignatureResult }>(
    "/payments/verify",
    input
  );

  return response.data.data;
}

export async function loadRazorpayCheckout(): Promise<RazorpayConstructor> {
  if (window.Razorpay) {
    return window.Razorpay;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => {
      if (window.Razorpay) {
        resolve(window.Razorpay);
        return;
      }

      reject(new Error("Razorpay checkout failed to load."));
    };
    script.onerror = () => reject(new Error("Unable to load Razorpay Checkout."));
    document.body.appendChild(script);
  });
}
