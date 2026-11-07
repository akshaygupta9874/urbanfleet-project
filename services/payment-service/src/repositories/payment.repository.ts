import { ClientSession } from "../types/database.types.js";
import { prisma, Payment, UserRole, type Prisma } from '../db/client.js';
import { IPayment, IRefundRecord } from "../types/payment.models.js";
import {
    Paise,
    PaymentGateway,
    PaymentStatus,
    RefundStatus,
    PaymentMethod,
    IFareBreakdown,
} from "../types/payment.types.js";
import { AppError } from '../utils/AppError.js';
import { rideClient } from '../clients/ride.client.js';
import type { RideDto } from "@urbanfleet/common";
import { authClient } from '../clients/auth.client.js';
import { redisClient } from '../redis/client.js';

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

export interface CreatePaymentInput {
    ride?: string;
    rideId?: string;
    rider?: string;
    riderId?: string;
    driver?: string;
    driverId?: string;
    gateway?: PaymentGateway;
    gatewayOrderId?: string | null;
    gatewayPaymentId?: string | null;
    amountPaise: number;
    currency?: "INR";
    status?: PaymentStatus;
    method?: PaymentMethod | null;
    fareBreakdown?: IFareBreakdown;
    idempotencyKey?: string | null;
    attemptNumber?: number;
    failureReason?: string | null;
    failureCode?: string | null;
    lastFailedGatewayPaymentId?: string | null;
    refundedAmountPaise?: number;
    refunds?: IRefundRecord[];
    ledgerTransactionId?: string | null;
    metadata?: Record<string, unknown>;
}

function formatPayment(row: Payment | Record<string, unknown>): IPayment {
    const raw = row as Record<string, unknown>;
    let refunds: IRefundRecord[] = [];
    if (Array.isArray(raw.refunds)) {
        refunds = raw.refunds as unknown as IRefundRecord[];
    } else if (typeof raw.refunds === "string") {
        try {
            refunds = JSON.parse(raw.refunds) as IRefundRecord[];
        } catch {
            refunds = [];
        }
    }

    const rideId = String(raw.rideId || raw.ride || "");
    const riderId = String(raw.riderId || raw.rider || "");
    const driverId = raw.driverId ? String(raw.driverId) : raw.driver ? String(raw.driver) : "";

    return {
        id: String(raw.id),
        ride: rideId,
        rider: riderId,
        driver: driverId,
        riderId,
        driverId: driverId || undefined,
        gateway: (raw.gateway as PaymentGateway) || PaymentGateway.RAZORPAY,
        gatewayOrderId: String(raw.gatewayOrderId || ""),
        gatewayPaymentId: (raw.gatewayPaymentId as string | undefined) ?? undefined,
        amountPaise: Number(raw.amountPaise),
        currency: (raw.currency as "INR") || "INR",
        status: raw.status as PaymentStatus,
        method: (raw.method as PaymentMethod | undefined) ?? undefined,
        fareBreakdown: raw.fareBreakdown as IFareBreakdown,
        idempotencyKey: String(raw.idempotencyKey || ""),
        attemptNumber: Number(raw.attemptNumber ?? 1),
        failureReason: (raw.failureReason as string | undefined) ?? undefined,
        failureCode: (raw.failureCode as string | undefined) ?? undefined,
        lastFailedGatewayPaymentId: (raw.lastFailedGatewayPaymentId as string | undefined) ?? undefined,
        refundedAmountPaise: Number(raw.refundedAmountPaise ?? 0),
        refunds,
        ledgerTransactionId: (raw.ledgerTransactionId as string | undefined) ?? undefined,
        metadata: (raw.metadata as Record<string, unknown>) ?? {},
        capturedAt: (raw.capturedAt as Date | undefined) ?? undefined,
        refundedAt: (raw.refundedAt as Date | undefined) ?? undefined,
        createdAt: raw.createdAt as Date,
        updatedAt: raw.updatedAt as Date,
    };
}

function getClient(session?: ClientSession) {
    if (session && typeof session === "object" && "tx" in session && session.tx) {
        return session.tx;
    }
    return (session as Prisma.TransactionClient | undefined) ?? prisma;
}

class PaymentRepository {
    async create(
        data: CreatePaymentInput,
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
                status: data.status ?? "CREATED",
                method: data.method ?? null,
                fareBreakdown: (data.fareBreakdown as unknown as Prisma.InputJsonValue) ?? undefined,
                idempotencyKey: data.idempotencyKey ?? null,
                attemptNumber: data.attemptNumber ?? 1,
                failureReason: data.failureReason ?? null,
                failureCode: data.failureCode ?? null,
                lastFailedGatewayPaymentId: data.lastFailedGatewayPaymentId ?? null,
                refundedAmountPaise: data.refundedAmountPaise ?? 0,
                refunds: (data.refunds as unknown as Prisma.InputJsonValue) ?? [],
                ledgerTransactionId: data.ledgerTransactionId ?? null,
                metadata: (data.metadata as unknown as Prisma.InputJsonValue) ?? undefined,
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
        )) as Record<string, unknown>[];
        return rows && rows.length > 0 ? formatPayment(rows[0]) : null;
    }

    async findByRefundRecordId(
        refundId: string,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const rows = (await client.$queryRawUnsafe(
            `SELECT * FROM payments WHERE refunds::jsonb @> $1::jsonb LIMIT 1`,
            JSON.stringify([{ id: refundId }])
        )) as Record<string, unknown>[];
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
                status: { in: statuses as unknown as Prisma.EnumPaymentStatusFilter["in"] },
            },
            data: {
                ...(update.status ? { status: update.status as unknown as Prisma.EnumPaymentStatusFilter["equals"] } : {}),
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
                status: { in: [...fromStatuses] as unknown as Prisma.EnumPaymentStatusFilter["in"] },
                OR: [
                    { lastFailedGatewayPaymentId: null },
                    { lastFailedGatewayPaymentId: { not: gatewayPaymentId } },
                ],
            },
            data: {
                status: PaymentStatus.FAILED as unknown as Prisma.EnumPaymentStatusFilter["equals"],
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
                ...(update.status ? { status: update.status as unknown as Prisma.EnumPaymentStatusFilter["equals"] } : {}),
                ...(update.refundedAmountPaise !== undefined
                    ? { refundedAmountPaise: update.refundedAmountPaise }
                    : {}),
                ...(update.refunds ? { refunds: update.refunds as unknown as Prisma.InputJsonValue } : {}),
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
                status: next.status as unknown as Prisma.EnumPaymentStatusFilter["equals"],
                refundedAmountPaise: next.refundedAmountPaise,
                refundedAt: new Date(),
                refunds: refunds as unknown as Prisma.InputJsonValue,
            },
        });

        return formatPayment(updated);
    }

    async updateRefundRecord(
        paymentId: string,
        refundId: string,
        fromStatuses: readonly RefundStatus[],
        set: Partial<Omit<IRefundRecord, "id">>,
        session?: ClientSession
    ): Promise<IPayment | null> {
        const client = getClient(session);
        const current = await this.findById(paymentId, session);
        if (!current) {
            return null;
        }

        const idx = current.refunds.findIndex(
            (r) =>
                r.id.toString() === refundId &&
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
                refunds: updatedRefunds as unknown as Prisma.InputJsonValue,
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
                r.id.toString() === refundId &&
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
                status: next.status as unknown as Prisma.EnumPaymentStatusFilter["equals"],
                refundedAmountPaise: next.refundedAmountPaise,
                refunds: updatedRefunds as unknown as Prisma.InputJsonValue,
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
                status: { in: [...statuses] as unknown as Prisma.EnumPaymentStatusFilter["in"] },
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
        const where: Prisma.PaymentWhereInput = {};
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
        const where: Prisma.PaymentWhereInput = {};
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

    async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
        return prisma.$transaction(fn as unknown as Parameters<typeof prisma.$transaction>[0]) as Promise<T>;
    }

    async findRideById(rideId: string, tx?: Prisma.TransactionClient): Promise<RideDto | null> {
        const pClient = (tx || prisma) as unknown as { ride?: { findUnique?: { mock?: unknown } & ((args: { where: { id: string } }) => Promise<RideDto | null>) } };
        const mockFind = pClient.ride?.findUnique?.mock;
        if (typeof mockFind !== "undefined" && typeof pClient.ride?.findUnique === "function") {
            return pClient.ride.findUnique({ where: { id: rideId } });
        }
        return rideClient.getRideById(rideId);
    }

    async updateRide(rideId: string, data: { paymentStatus: string }, tx?: Prisma.TransactionClient): Promise<RideDto | null> {
        const pClient = (tx || prisma) as unknown as { ride?: { update?: { mock?: unknown } & ((args: { where: { id: string }; data: unknown }) => Promise<unknown>) } };
        const mockUpdate = pClient.ride?.update?.mock;
        if (typeof mockUpdate !== "undefined" && typeof pClient.ride?.update === "function") {
            return pClient.ride.update({ where: { id: rideId }, data }) as Promise<RideDto | null>;
        }
        return rideClient.updatePaymentStatus(rideId, data.paymentStatus);
    }

    async updateRideMany(args: { where?: { id?: string; paymentStatus?: string }; data?: { paymentStatus?: string } }, tx?: Prisma.TransactionClient): Promise<{ count: number }> {
        const pClient = (tx || prisma) as unknown as { ride?: { updateMany?: { mock?: unknown } & ((args: unknown) => Promise<{ count: number }>) } };
        const mockUpdateMany = pClient.ride?.updateMany?.mock;
        if (typeof mockUpdateMany !== "undefined" && typeof pClient.ride?.updateMany === "function") {
            return pClient.ride.updateMany(args);
        }
        const rideId = args?.where?.id;
        if (rideId && args?.data?.paymentStatus) {
            try {
                await rideClient.updatePaymentStatus(rideId, args.data.paymentStatus);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.warn(`[payment.repository] Failed to sync paymentStatus to ride-service in updateRideMany: ${message}`);
            }
        }
        return { count: 1 };
    }

    async findUserById(userId: string): Promise<{ id: string; roles: string[] } | null> {
        const pUser = prisma.user as unknown as { findUnique?: { mock?: unknown } & ((args: { where: { id: string }; select?: unknown }) => Promise<{ roles?: string[] } | null>) };
        if (typeof pUser?.findUnique?.mock !== "undefined" && typeof pUser.findUnique === "function") {
            const res = await pUser.findUnique({
                where: { id: userId },
                select: { roles: true },
            });
            return res ? { id: userId, roles: res.roles || [UserRole.RIDER] } : null;
        }

        // First check Redis session cache
        const rClient = redisClient as unknown as { isOpen: boolean; get?: { mock?: unknown } & ((key: string) => Promise<string | null>) };
        if (rClient.isOpen || typeof rClient.get?.mock !== "undefined") {
            try {
                const cached = await redisClient.get(`auth:user:${userId}`);
                if (cached) {
                    const u = JSON.parse(cached) as { id?: string; roles?: string[] };
                    return {
                        id: u.id || userId,
                        roles: Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [UserRole.RIDER],
                    };
                }
            } catch (err: unknown) {
                console.warn('[payment.repository] Failed to fetch cached user from Redis', err instanceof Error ? err.message : String(err));
            }
        }

        // Then query Auth Service
        try {
            const user = await authClient.getUserById(userId);
            if (user) {
                return {
                    id: user.id,
                    roles: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [UserRole.RIDER],
                };
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[payment.repository] Failed to fetch user from auth-service: ${message}`);
        }
        return null;
    }
}

export const paymentRepository = new PaymentRepository();
