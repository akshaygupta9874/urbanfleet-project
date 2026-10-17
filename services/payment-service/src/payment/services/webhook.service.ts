import { createHmac, timingSafeEqual } from "crypto";
import { redisClient } from "../../redis/client.js";
import { NonRetryablePaymentError } from "../errors/payment.errors.js";
import { paymentLog } from "../utils/payment-logger.js";
import { paymentService } from "./payment.service.js";
import { refundService } from "./refund.service.js";
import { payoutService } from "./payout.service.js";

import {
    RAZORPAY_WEBHOOK_EVENTS,
    REDIS_KEYS,
    WEBHOOK_DEDUPE_TTL_SECONDS,
    WEBHOOK_PROCESSING_TTL_SECONDS,
} from "../constants/payment.constants.js";

import { RazorpayWebhookPayload } from "../types/razorpay.types.js";

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "acknowledged_with_error";

class WebhookService {

    verifySignature(
        rawBody: Buffer,
        signature: string,
        secret: string
    ): boolean {

        const expected =
            createHmac(
                "sha256",
                secret
            )
                .update(rawBody)
                .digest("hex");

        const expectedBuf =
            Buffer.from(
                expected,
                "hex"
            );

        const actualBuf =
            Buffer.from(
                signature,
                "hex"
            );

        return (
            expectedBuf.length ===
            actualBuf.length &&
            timingSafeEqual(
                expectedBuf,
                actualBuf
            )
        );

    }

    private buildDedupeKey(
        eventId: string | undefined,
        payload: RazorpayWebhookPayload
    ): string {

        if (eventId) {
            return eventId;
        }

        const entityId =
            payload.payload.payment?.entity.id ??
            payload.payload.order?.entity.id ??
            payload.payload.refund?.entity.id ??
            payload.payload.payout?.entity.id ??
            "unknown";

        return `${payload.event}:${entityId}:${payload.created_at}`;

    }

    /**
     * Step 1 of the dedupe protocol: put a SHORT-LIVED "processing" marker.
     * Returns false if the event is already done or currently being handled.
     * If Redis is down we fail OPEN: every handler is idempotent (compare-and-swap +
     * unique indexes), the marker is only an optimisation.
     */
    private async claim(
        dedupeKey: string
    ): Promise<boolean> {

        try {
            const result =
                await redisClient.set(
                    REDIS_KEYS.webhookProcessed(
                        dedupeKey
                    ),
                    "processing",
                    {
                        NX: true,
                        EX: WEBHOOK_PROCESSING_TTL_SECONDS,
                    }
                );

            return result === "OK";
        } catch (err) {
            paymentLog.warn("webhook.dedupe_unavailable", { dedupeKey });
            return true;
        }

    }

    /** Step 2 (success only): promote the marker to a 7-day "done" record. */
    private async complete(
        dedupeKey: string
    ): Promise<void> {

        try {
            await redisClient.set(
                REDIS_KEYS.webhookProcessed(
                    dedupeKey
                ),
                "done",
                {
                    EX: WEBHOOK_DEDUPE_TTL_SECONDS,
                }
            );
        } catch (err) {
            paymentLog.warn("webhook.dedupe_complete_failed", { dedupeKey });
        }

    }

    /** Failure path: drop the marker so Razorpay's retry of the SAME event is processed. */
    private async release(
        dedupeKey: string
    ): Promise<void> {

        try {
            await redisClient.del(
                REDIS_KEYS.webhookProcessed(
                    dedupeKey
                )
            );
        } catch (err) {
            paymentLog.warn("webhook.dedupe_release_failed", { dedupeKey });
        }

    }

    async handleEvent(
        payload: RazorpayWebhookPayload,
        eventId?: string
    ): Promise<WebhookOutcome> {

        const dedupeKey =
            this.buildDedupeKey(
                eventId,
                payload
            );

        const claimed = await this.claim(dedupeKey);

        if (!claimed) {
            paymentLog.info("webhook.duplicate", {
                event: payload.event,
                eventId: dedupeKey,
            });
            return "duplicate";
        }

        try {

            const handled = await this.dispatch(payload);

            await this.complete(dedupeKey);

            return handled ? "processed" : "ignored";

        } catch (err) {

            if (err instanceof NonRetryablePaymentError) {
                // Retrying can never fix it (unknown order, amount mismatch ...). Answer 200
                // so Razorpay stops retrying (and does not disable the webhook), but make noise.
                paymentLog.error("webhook.non_retryable_error", {
                    event: payload.event,
                    eventId: dedupeKey,
                    message: err.message,
                });

                await this.complete(dedupeKey);

                return "acknowledged_with_error";
            }

            // Retryable (database down, lock busy ...): forget the marker, let the error
            // bubble up -> non-2xx -> Razorpay redelivers -> the event is processed again.
            await this.release(dedupeKey);

            throw err;

        }

    }

    /** Routes one event to its handler. Returns false for events we deliberately ignore. */
    private async dispatch(
        payload: RazorpayWebhookPayload
    ): Promise<boolean> {

        const events = RAZORPAY_WEBHOOK_EVENTS;

        switch (payload.event) {

            case events.PAYMENT_AUTHORIZED: {

                const entity = this.requirePayment(payload);

                await paymentService.handlePaymentAuthorized(entity);

                return true;

            }

            // order.paid carries the captured payment too: a second, independent signal
            // for the same capture. handlePaymentCaptured is idempotent, so both are safe.
            case events.PAYMENT_CAPTURED:
            case events.ORDER_PAID: {

                const entity = this.requirePayment(payload);

                await paymentService.handlePaymentCaptured(entity);

                return true;

            }

            case events.PAYMENT_FAILED: {

                const entity = this.requirePayment(payload);

                await paymentService.handlePaymentFailed(entity);

                return true;

            }

            case events.REFUND_CREATED:
            case events.REFUND_PROCESSED:
            case events.REFUND_FAILED: {

                const entity = payload.payload.refund?.entity;

                if (!entity) {
                    throw new NonRetryablePaymentError(
                        `${payload.event} webhook missing refund entity`,
                        400,
                        "INVALID_WEBHOOK_PAYLOAD"
                    );
                }

                const kind =
                    payload.event === events.REFUND_CREATED
                        ? "created"
                        : payload.event === events.REFUND_PROCESSED
                            ? "processed"
                            : "failed";

                await refundService.handleGatewayRefundEvent(kind, entity);

                return true;

            }

            case events.PAYOUT_INITIATED:
            case events.PAYOUT_PROCESSED:
            case events.PAYOUT_FAILED:
            case events.PAYOUT_REJECTED:
            case events.PAYOUT_REVERSED: {

                const entity = payload.payload.payout?.entity;

                if (!entity) {
                    throw new NonRetryablePaymentError(
                        `${payload.event} webhook missing payout entity`,
                        400,
                        "INVALID_WEBHOOK_PAYLOAD"
                    );
                }

                await payoutService.handleGatewayPayoutEvent(payload.event, entity);

                return true;

            }

            default:

                return false;

        }

    }

    private requirePayment(
        payload: RazorpayWebhookPayload
    ) {

        const entity = payload.payload.payment?.entity;

        if (!entity) {

            throw new NonRetryablePaymentError(
                `${payload.event} webhook missing payment entity`,
                400,
                "INVALID_WEBHOOK_PAYLOAD"
            );

        }

        return entity;

    }

}

export const webhookService =
    new WebhookService();
