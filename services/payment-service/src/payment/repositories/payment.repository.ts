import { prisma } from "../../db/client.js";
import { ClientSession } from "../types/objectid.js";
import { IPayment, IRefundRecord } from "../types/payment.models.js";
import {
    Paise,
    PaymentGateway,
    PaymentStatus,
    RefundStatus,
    IFareBreakdown,
} from "../types/payment.types.js";
import { AppError } from "../../utils/AppError.js";

export interface ListPaymentsFilter {
    rider?: string;
    driver?: string;
    ride?: string;
    status?: PaymentStatus;
}

export interface FailureInfo {
    failureReason?: string | undefined;
    failureCode?: string | undefined;
}

function formatPayment(row: any): IPayment {
    if (!row) return null as any;
    let refunds: IRefundRecord[] = [];
    if (Array.isArray(row.refunds)) {
        refunds = row.refunds;
    } else if (typeof row.refunds === "string") {
        try {
            refunds = JSON.parse(row.refunds);
        } catch {
            refunds = [];
        }
    }

    return {
        _id: row.id,
        id: row.id,
        ride: row.rideId,
        rideId: row.rideId,
        rider: row.riderId,
        riderId: row.riderId,
        driver: row.driverId,
        driverId: row.driverId,
        gateway: (row.gateway as PaymentGateway) || PaymentGateway.RAZORPAY,
        gatewayOrderId: row.gatewayOrderId,
        gatewayPaymentId: row.gatewayPaymentId ?? undefined,
        amountPaise: row.amountPaise,
        currency: row.currency,
        status: row.status as PaymentStatus,
        method: row.method ?? undefined,
        fareBreakdown: row.fareBreakdown as IFareBreakdown,
        idempotencyKey: row.idempotencyKey,
        attemptNumber: row.attemptNumber ?? 1,
        failureReason: row.failureReason ?? undefined,
        failureCode: row.failureCode ?? undefined,
        lastFailedGatewayPaymentId: row.lastFailedGatewayPaymentId ?? undefined,
        refundedAmountPaise: row.refundedAmountPaise ?? 0,
        refunds,
        ledgerTransactionId: row.ledgerTransactionId ?? undefined,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        capturedAt: row.capturedAt ?? undefined,
        refundedAt: row.refundedAt ?? undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    } as unknown as IPayment;
}

function getClient(session?: ClientSession) {
    return (session as any)?.tx ?? session ?? prisma;
}

class PaymentRepository {
    async create(
        data: Partial<IPayment>,
        session?: ClientSession
    ): Promise<IPayment> {
        const client = getClient(session);
        const rideId = data.ride ? data.ride.toString() : "";
        const riderId = data.rider ? data.rider.toString() : "";
        const driverId = data.driver ? data.driver.toString() : null;

        const created = await client.payment.create({
            data: {
                rideId,
                riderId,
                driverId,
                gateway: data.gateway ?? "RAZORPAY",
                gatewayOrderId: data.gatewayOrderId ?? null,
                gatewayPaymentId: data.gatewayPaymentId ?? null,
                amountPaise: data.amountPaise ?? 0,
                currency: data.currency ?? "INR",
                status: (data.status as any) ?? "CREATED",
                method: data.method ?? null,
                fareBreakdown: (data.fareBreakdown as any) ?? undefined,
                idempotencyKey: data.idempotencyKey ?? null,
                attemptNumber: data.attemptNumber ?? 1,
                failureReason: data.failureReason ?? null,
                failureCode: data.failureCode ?? null,
                lastFailedGatewayPaymentId: data.lastFailedGatewayPaymentId ?? null,
                refundedAmountPaise: data.refundedAmountPaise ?? 0,
                refunds: (data.refunds as any) ?? [],
                ledgerTransactionId: data.ledgerTransactionId ?? null,
                metadata: (data.metadata as any) ?? undefined,
            },
        });

        if (!created) {
            throw new AppError(
                "Failed to create payment.",
                500,
                "PAYMENT_CREATE_FAILED"
            );
        }

        return formatPayment(created);
    }

    async findById(
        id: string,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const row = await client.payment.findUnique({
            where: { id },
        });
        return row ? formatPayment(row) : null;
    }

    async findByGatewayOrderId(
        gatewayOrderId: string,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const row = await client.payment.findFirst({
            where: { gatewayOrderId },
        });
        return row ? formatPayment(row) : null;
    }

    async findByGatewayPaymentId(
        gatewayPaymentId: string,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const row = await client.payment.findFirst({
            where: { gatewayPaymentId },
        });
        return row ? formatPayment(row) : null;
    }

    async findByIdempotencyKey(
        idempotencyKey: string,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const row = await client.payment.findFirst({
            where: { idempotencyKey },
        });
        return row ? formatPayment(row) : null;
    }

    async setGatewayOrderId(
        paymentId: string,
        gatewayOrderId: string
    ): Promise<IPayment | null> {
        const updated = await prisma.payment.updateMany({
            where: {
                id: paymentId,
                gatewayOrderId: null,
            },
            data: { gatewayOrderId },
        });
        return updated.count > 0 ? this.findById(paymentId) : null;
    }

    async findByGatewayRefundId(
        gatewayRefundId: string,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const rows = (await client.$queryRawUnsafe(
            `SELECT * FROM payments WHERE refunds::jsonb @> $1::jsonb LIMIT 1`,
            JSON.stringify([{ gatewayRefundId }])
        )) as any[];
        return rows && rows.length > 0 ? formatPayment(rows[0]) : null;
    }

    async findByRefundRecordId(
        refundId: string,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const rows = (await client.$queryRawUnsafe(
            `SELECT * FROM payments WHERE refunds::jsonb @> $1::jsonb LIMIT 1`,
            JSON.stringify([{ _id: refundId }])
        )) as any[];
        return rows && rows.length > 0 ? formatPayment(rows[0]) : null;
    }

    async findByRide(
        ride: string,
        session?: ClientSession
    ): Promise<IPayment[]> {
        const client = getClient(session);
        const rows = await client.payment.findMany({
            where: { rideId: ride.toString() },
            orderBy: { createdAt: "desc" },
        });
        return rows.map(formatPayment);
    }

    async transitionStatus(
        paymentId: string,
        fromStatus: PaymentStatus | readonly PaymentStatus[],
        update: Partial<IPayment>,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const statuses = Array.isArray(fromStatus) ? [...fromStatus] : [fromStatus];

        const updated = await client.payment.updateMany({
            where: {
                id: paymentId,
                status: { in: statuses as any },
            },
            data: {
                ...(update.status ? { status: update.status as any } : {}),
                ...(update.gatewayPaymentId ? { gatewayPaymentId: update.gatewayPaymentId } : {}),
                ...(update.method ? { method: update.method } : {}),
                ...(update.ledgerTransactionId ? { ledgerTransactionId: update.ledgerTransactionId } : {}),
                ...(update.capturedAt ? { capturedAt: update.capturedAt } : {}),
            },
        });

        if (updated.count === 0) {
            return null;
        }

        return this.findById(paymentId, session);
    }

    async recordFailedAttempt(
        paymentId: string,
        gatewayPaymentId: string,
        fromStatuses: readonly PaymentStatus[],
        failure: FailureInfo,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);

        const updated = await client.payment.updateMany({
            where: {
                id: paymentId,
                status: { in: [...fromStatuses] as any },
                OR: [
                    { lastFailedGatewayPaymentId: null },
                    { lastFailedGatewayPaymentId: { not: gatewayPaymentId } },
                ],
            },
            data: {
                status: PaymentStatus.FAILED as any,
                lastFailedGatewayPaymentId: gatewayPaymentId,
                failureReason: failure.failureReason ?? null,
                failureCode: failure.failureCode ?? null,
                attemptNumber: { increment: 1 },
            },
        });

        if (updated.count === 0) {
            return null;
        }

        return this.findById(paymentId, session);
    }

    async incrementAttempts(
        paymentId: string,
        session?: ClientSession
    ): Promise<void> {
        const client = getClient(session);
        await client.payment.update({
            where: { id: paymentId },
            data: {
                attemptNumber: { increment: 1 },
            },
        });
    }

    async update(
        paymentId: string,
        update: Partial<IPayment>,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const updated = await client.payment.update({
            where: { id: paymentId },
            data: {
                ...(update.status ? { status: update.status as any } : {}),
                ...(update.refundedAmountPaise !== undefined
                    ? { refundedAmountPaise: update.refundedAmountPaise }
                    : {}),
                ...(update.refunds ? { refunds: update.refunds as any } : {}),
            },
        });
        return formatPayment(updated);
    }

    async bookRefund(
        paymentId: string,
        expected: { status: PaymentStatus; refundedAmountPaise: Paise },
        next: { status: PaymentStatus; refundedAmountPaise: Paise },
        record: IRefundRecord,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const current = await this.findById(paymentId, session);
        if (
            !current ||
            current.status !== expected.status ||
            current.refundedAmountPaise !== expected.refundedAmountPaise
        ) {
            return null;
        }

        const refunds = [...current.refunds, record];

        const updated = await client.payment.update({
            where: { id: paymentId },
            data: {
                status: next.status as any,
                refundedAmountPaise: next.refundedAmountPaise,
                refundedAt: new Date(),
                refunds: refunds as any,
            },
        });

        return formatPayment(updated);
    }

    async updateRefundRecord(
        paymentId: string,
        refundId: string,
        fromStatuses: readonly RefundStatus[],
        set: Partial<Omit<IRefundRecord, "_id">>,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const current = await this.findById(paymentId, session);
        if (!current) {
            return null;
        }

        const idx = current.refunds.findIndex(
            (r) =>
                r._id.toString() === refundId &&
                fromStatuses.includes(r.status)
        );

        if (idx === -1) {
            return null;
        }

        const updatedRefunds = [...current.refunds];
        updatedRefunds[idx] = {
            ...updatedRefunds[idx],
            ...set,
        } as IRefundRecord;

        const updated = await client.payment.update({
            where: { id: paymentId },
            data: {
                refunds: updatedRefunds as any,
            },
        });

        return formatPayment(updated);
    }

    async failRefund(
        paymentId: string,
        refundId: string,
        expectedRefundedAmountPaise: Paise,
        next: { status: PaymentStatus; refundedAmountPaise: Paise },
        failure: { failureReason: string; compensationLedgerTransactionId: string },
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const current = await this.findById(paymentId, session);
        if (!current || current.refundedAmountPaise !== expectedRefundedAmountPaise) {
            return null;
        }

        const idx = current.refunds.findIndex(
            (r) =>
                r._id.toString() === refundId &&
                (r.status === RefundStatus.PENDING ||
                    r.status === RefundStatus.PROCESSED)
        );

        if (idx === -1) {
            return null;
        }

        const updatedRefunds = [...current.refunds];
        updatedRefunds[idx] = {
            ...updatedRefunds[idx],
            status: RefundStatus.FAILED,
            failureReason: failure.failureReason,
            compensationLedgerTransactionId: failure.compensationLedgerTransactionId,
        } as IRefundRecord;

        const updated = await client.payment.update({
            where: { id: paymentId },
            data: {
                status: next.status as any,
                refundedAmountPaise: next.refundedAmountPaise,
                refunds: updatedRefunds as any,
            },
        });

        return formatPayment(updated);
    }

    async findUnsettled(
        statuses: readonly PaymentStatus[],
        olderThan: Date,
        newerThan: Date,
        limit: number
    ): Promise<IPayment[]> {
        const rows = await prisma.payment.findMany({
            where: {
                status: { in: [...statuses] as any },
                createdAt: { lt: olderThan, gt: newerThan },
            },
            orderBy: { createdAt: "asc" },
            take: limit,
        });
        return rows.map(formatPayment);
    }

    async findWithPendingRefunds(
        olderThan: Date,
        limit: number
    ): Promise<IPayment[]> {
        const rows = await prisma.payment.findMany({
            where: {
                updatedAt: { lt: olderThan },
            },
            take: limit,
        });

        const withPending = rows
            .map(formatPayment)
            .filter((p) =>
                p.refunds.some(
                    (r) =>
                        r.status === RefundStatus.PENDING &&
                        new Date(r.createdAt) < olderThan
                )
            );

        return withPending;
    }

    async list(filter: ListPaymentsFilter): Promise<IPayment[]> {
        const where: any = {};
        if (filter.rider) where.riderId = filter.rider.toString();
        if (filter.driver) where.driverId = filter.driver.toString();
        if (filter.ride) where.rideId = filter.ride.toString();
        if (filter.status) where.status = filter.status;

        const rows = await prisma.payment.findMany({
            where,
            orderBy: { createdAt: "desc" },
        });
        return rows.map(formatPayment);
    }

    async listPaginated(
        filter: ListPaymentsFilter,
        page = 1,
        limit = 20
    ): Promise<{ items: IPayment[]; total: number }> {
        const where: any = {};
        if (filter.rider) where.riderId = filter.rider.toString();
        if (filter.driver) where.driverId = filter.driver.toString();
        if (filter.ride) where.rideId = filter.ride.toString();
        if (filter.status) where.status = filter.status;

        const [rows, total] = await Promise.all([
            prisma.payment.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.payment.count({ where }),
        ]);

        return { items: rows.map(formatPayment), total };
    }
}

export const paymentRepository = new PaymentRepository();
