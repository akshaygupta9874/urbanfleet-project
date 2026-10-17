import { Request, Response } from "express";

import {
    AppError,
} from "../../utils/AppError.js";

import { webhookService } from "../services/webhook.service.js";

import asyncHandler from "../../middlewares/asyncHandler.js";

import { RazorpayWebhookPayload } from "../types/razorpay.types.js";

import { paymentLog } from "../utils/payment-logger.js";

import {
    RAZORPAY_EVENT_ID_HEADER,
    RAZORPAY_SIGNATURE_HEADER,
} from "../constants/payment.constants.js";

export const handleRazorpayWebhook =
    asyncHandler(async (
        req: Request,
        res: Response
    ) => {

        // Needs express.raw() on this route AND the route mounted before express.json().
        const rawBody = req.body as Buffer;

        const signature =
            req.headers[
                RAZORPAY_SIGNATURE_HEADER
            ] as string | undefined;

        const eventId =
            req.headers[
                RAZORPAY_EVENT_ID_HEADER
            ] as string | undefined;

        const secret =
            process.env.RAZORPAY_WEBHOOK_SECRET;

        if (!secret) {
            throw new AppError(
                "RAZORPAY_WEBHOOK_SECRET is not configured.",
                500,
                "WEBHOOK_SECRET_MISSING"
            );
        }

        if (
            !signature ||
            !Buffer.isBuffer(rawBody)
        ) {
            throw new AppError(
                "Missing signature or raw body.",
                400,
                "INVALID_WEBHOOK_REQUEST"
            );
        }

        const isValid =
            webhookService.verifySignature(
                rawBody,
                signature,
                secret
            );

        if (!isValid) {
            throw new AppError(
                "Invalid webhook signature.",
                400,
                "INVALID_WEBHOOK_SIGNATURE"
            );
        }

        let payload: RazorpayWebhookPayload;

        try {
            payload = JSON.parse(
                rawBody.toString("utf8")
            ) as RazorpayWebhookPayload;
        } catch {
            throw new AppError(
                "Invalid webhook payload JSON.",
                400,
                "INVALID_WEBHOOK_PAYLOAD"
            );
        }

        const outcome =
            await webhookService.handleEvent(
                payload,
                eventId
            );

        // ids only - never log the body (it contains customer data)
        paymentLog.info("webhook.handled", {
            event: payload.event,
            eventId,
            outcome,
        });

        res.status(200).json({
            status: "ok",
        });

    });
