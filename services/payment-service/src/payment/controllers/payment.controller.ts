import { Response } from "express";
import { createHash } from "crypto";
import { Types } from "../types/objectid.js";
import {
  AppError,
} from "../../utils/AppError.js";
import asyncHandler from "../../middlewares/asyncHandler.js";
import { paymentService } from "../services/payment.service.js";
import { paymentRepository } from "../repositories/payment.repository.js";
import { PaymentStatus } from "../types/payment.types.js";
import { IPayment } from "../types/payment.models.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { prisma } from "../../db/client.js";
import { UserRole } from "@prisma/client";

/**
 * One payment per (ride, rider): the key is derived, never taken from the client.
 * Calling "create order" again therefore returns the SAME order (retry / double click).
 */
function deriveIdempotencyKey(
  ride: string,
  rider: string
): string {

  return createHash("sha256")
    .update(`${ride}:${rider}`)
    .digest("hex");

}

function unauthenticated(): AppError {
  return new AppError(
    "Unauthenticated",
    401,
    "UNAUTHENTICATED"
  );
}

/** One user lookup per request (the old code repeated it in every handler). */
async function loadRequester(
  userId: string
): Promise<{ isAdmin: boolean }> {

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: true },
  });

  if (!user) {

    throw new AppError(
      "User not found",
      404,
      "USER_NOT_FOUND"
    );

  }

  return {
    isAdmin: user.roles.includes(UserRole.ADMIN),
  };

}

function isParticipant(
  payment: IPayment,
  userId: string
): boolean {
  return (
    payment.rider.toString() === userId ||
    payment.driver.toString() === userId
  );
}

/**
 * What an API client may see. Internal bookkeeping (idempotency key, ledger ids, raw
 * metadata, refund ledger splits, who issued a refund) is admin-only.
 */
function toPaymentView(
  payment: IPayment,
  isAdmin: boolean
): Record<string, unknown> {
  const base = typeof (payment as any).toObject === "function"
    ? (payment as any).toObject()
    : { ...payment };
  const view: Record<string, unknown> = { ...base };

  if (isAdmin) {
    return view;
  }

  delete view.idempotencyKey;
  delete view.metadata;
  delete view.ledgerTransactionId;
  delete view.lastFailedGatewayPaymentId;
  delete view.__v;

  if (Array.isArray(payment.refunds)) {
    view.refunds = payment.refunds.map((refund) => ({
      _id: refund._id,
      amountPaise: refund.amountPaise,
      status: refund.status,
      createdAt: refund.createdAt,
      processedAt: refund.processedAt,
    }));
  }

  return view;
}

export const createOrder =
  asyncHandler(async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    if (!req.userId) {
      throw unauthenticated();
    }

    const { rideId } = req.body as { rideId: string };

    const result =
      await paymentService.createOrder({
        ride: new Types.ObjectId(rideId),
        rider: new Types.ObjectId(req.userId),
        idempotencyKey:
          deriveIdempotencyKey(rideId, req.userId),
      });

    res.status(201).json({
      data: result,
    });

  });

export const verifyCheckout =
  asyncHandler(async (
    req: AuthenticatedRequest,
    res: Response
  ) => {

    if (!req.userId) {
      throw unauthenticated();
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    const status =
      await paymentService.verifyCheckoutSignature({

        gatewayOrderId:
          razorpay_order_id,

        gatewayPaymentId:
          razorpay_payment_id,

        signature:
          razorpay_signature,

        requesterId:
          new Types.ObjectId(req.userId),

      });

    res.status(200).json({
      data: {
        status,
      },
    });

  });

export const getPayment =
  asyncHandler(async (
    req: AuthenticatedRequest,
    res: Response
  ) => {

    if (!req.userId) {
      throw unauthenticated();
    }

    if (!req.params.paymentId) {
      throw new AppError(
        "Payment id is required.",
        400,
        "PAYMENT_ID_REQUIRED"
      );
    }

    const payment =
      await paymentRepository.findById(
        req.params.paymentId
      );

    if (!payment) {

      throw new AppError(
        "Payment not found",
        404,
        "PAYMENT_NOT_FOUND"
      );

    }

    const { isAdmin } = await loadRequester(req.userId);

    if (
      !isParticipant(payment, req.userId) &&
      !isAdmin
    ) {

      throw new AppError(
        "Not authorized to view this payment",
        403,
        "FORBIDDEN"
      );

    }

    res.status(200).json({
      data: toPaymentView(payment, isAdmin),
    });

  });

export const getPaymentsByRide =
  asyncHandler(async (
    req: AuthenticatedRequest,
    res: Response
  ) => {

    if (!req.userId) {
      throw unauthenticated();
    }

    if (!req.params.rideId) {
      throw new AppError(
        "Ride id is required.",
        400,
        "RIDE_ID_REQUIRED"
      );
    }

    const payments =
      await paymentRepository.findByRide(
        req.params.rideId
      );

    const { isAdmin } = await loadRequester(req.userId);

    const owns =
      payments.some(
        (payment) =>
          isParticipant(payment, req.userId as string)
      );

    if (
      payments.length > 0 &&
      !owns &&
      !isAdmin
    ) {

      throw new AppError(
        "Not authorized to view these payments",
        403,
        "FORBIDDEN"
      );

    }

    res.status(200).json({
      data: payments.map((payment) => toPaymentView(payment, isAdmin)),
    });

  });

export const listPayments =
  asyncHandler(async (
    req: AuthenticatedRequest,
    res: Response
  ) => {

    if (!req.userId) {
      throw unauthenticated();
    }

    // already validated + defaulted by listPaymentsQuerySchema
    const {
      page,
      limit,
      status,
    } = req.query as unknown as {
      page: number;
      limit: number;
      status?: PaymentStatus;
    };

    const { isAdmin } = await loadRequester(req.userId);

    const filter =
      isAdmin
        ? {
          status,
        }
        : {
          rider:
            req.userId,

          status,
        };

    const { items, total } =
      await paymentRepository.listPaginated(
        filter,
        page,
        limit
      );

    // `data` stays a plain array (as before); pagination info is new and additive.
    res.status(200).json({
      data: items.map((payment) => toPaymentView(payment, isAdmin)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });

  });

/** Admin only (enforced by requireAdmin on the route). */
export const refundPayment =
  asyncHandler(async (
    req: AuthenticatedRequest,
    res: Response
  ) => {

    if (!req.userId) {
      throw unauthenticated();
    }

    const {
      amountPaise,
      reason,
    } = req.body;

    const result = await paymentService.initiateRefund({

      paymentId:
        new Types.ObjectId(
          req.params.paymentId
        ),

      amountPaise,

      reason,

      initiatedBy:
        new Types.ObjectId(
          req.userId
        ),

    });

    res.status(202).json({

      message:
        "Refund initiated",

      data: result,

    });

  });
