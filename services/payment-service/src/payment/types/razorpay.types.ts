import { Paise } from "./payment.types.js";

/** Razorpay sends `notes: []` (an empty ARRAY) when there are no notes. */
export type RazorpayNotes = Record<string, string | number> | unknown[];

export interface RazorpayOrderEntity {
    id: string;
    entity: "order";
    amount: Paise;
    amount_paid: Paise;
    currency: string;
    receipt: string | null;
    status: string;
    created_at: number;
}

export interface RazorpayPaymentEntity {
    id: string;
    entity: "payment";
    order_id: string;
    status: string;
    amount: Paise;
    currency: string;
    method: string;
    captured: boolean;
    amount_refunded?: Paise;
    notes?: RazorpayNotes;
    error_code?: string | null;
    error_description?: string | null;
    created_at: number;
}

export interface RazorpayRefundEntity {
    id: string;
    entity: "refund";
    payment_id: string;
    amount: Paise;
    currency?: string;
    status: string;
    receipt?: string | null;
    notes?: RazorpayNotes;
    speed_processed?: string;
    created_at: number;
}

export interface RazorpayPayoutEntity {
    id: string;
    entity: "payout";
    fund_account_id: string;
    amount: Paise;
    currency: string;
    status: string;
    mode: string;
    /** The reference we supplied when creating the payout (our Payout._id). */
    reference_id?: string | null;
    notes?: RazorpayNotes;
    utr?: string | null;
    failure_reason?: string | null;
    created_at: number;
}

export interface RazorpayWebhookPayload {
    entity: "event";
    account_id: string;
    event: string;
    contains: string[];

    payload: {
        payment?: {
            entity: RazorpayPaymentEntity;
        };

        order?: {
            entity: RazorpayOrderEntity;
        };

        refund?: {
            entity: RazorpayRefundEntity;
        };

        payout?: {
            entity: RazorpayPayoutEntity;
        };
    };

    created_at: number;
}
