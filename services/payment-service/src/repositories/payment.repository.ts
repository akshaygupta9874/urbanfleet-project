import { ClientSession } from "../types/database.types.js";
import { prisma, Payment, UserRole, type Prisma } from '../db/client.js';
import { IPayment } from "../types/payment.models.js";
import {
    PaymentGateway,
    PaymentStatus,
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
    ride: string;
    rider: string;
    driver: string;
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
    ledgerTransactionId?: string | null;
    metadata?: Record<string, unknown>;
}

function formatPayment(row: Payment | Record<string, unknown>): IPayment {
    const raw = row as Record<string, unknown>;

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
        ledgerTransactionId: (raw.ledgerTransactionId as string | undefined) ?? undefined,
        metadata: (raw.metadata as Record<string, unknown>) ?? {},
        capturedAt: (raw.capturedAt as Date | undefined) ?? undefined,
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
        const rideId = data.ride;
        const riderId = data.rider;
        const driverId = data.driver;

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
        const client = (tx || prisma) as unknown as { ride?: { findUnique?: (args: { where: { id: string } }) => Promise<RideDto | null> } };
        if (typeof client.ride?.findUnique === 'function') {
            return client.ride.findUnique({ where: { id: rideId } });
        }
        return rideClient.getRideById(rideId);
    }

    async updateRide(rideId: string, data: { paymentStatus: string }, tx?: Prisma.TransactionClient): Promise<RideDto | null> {
        const client = (tx || prisma) as unknown as { ride?: { update?: (args: { where: { id: string }; data: { paymentStatus: string } }) => Promise<RideDto | null> } };
        if (typeof client.ride?.update === 'function') {
            return client.ride.update({ where: { id: rideId }, data });
        }
        return rideClient.updatePaymentStatus(rideId, data.paymentStatus, null);
    }

    async updateRideMany(args: { where?: { id?: string; paymentStatus?: string }; data?: { paymentStatus?: string } }, tx?: Prisma.TransactionClient): Promise<{ count: number }> {
        const client = (tx || prisma) as unknown as { ride?: { updateMany?: (args: unknown) => Promise<{ count: number }> } };
        if (typeof client.ride?.updateMany === 'function') {
            return client.ride.updateMany({
                where: {
                    id: args.where?.id,
                    ...(args.where?.paymentStatus ? { paymentStatus: args.where.paymentStatus } : {}),
                },
                data: { paymentStatus: args.data?.paymentStatus },
            });
        }
        const rideId = args?.where?.id;
        if (rideId && args?.data?.paymentStatus) {
            try {
                await rideClient.updatePaymentStatus(rideId, args.data.paymentStatus, null);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.warn(`[payment.repository] Failed to sync paymentStatus to ride-service in updateRideMany: ${message}`);
            }
        }
        return { count: 1 };
    }

    async findUserById(userId: string): Promise<{ id: string; roles: string[] } | null> {
        const client = prisma as unknown as { user?: { findUnique?: (args: { where: { id: string }; select?: unknown }) => Promise<{ id?: string; roles?: string[] } | null> } };
        if (typeof client.user?.findUnique === 'function') {
            const res = await client.user.findUnique({
                where: { id: userId },
                select: { roles: true },
            });
            return res ? { id: userId, roles: res.roles || [UserRole.RIDER] } : null;
        }

        // First check Redis session cache
        try {
            if (redisClient?.isOpen) {
                const cached = await redisClient.get(`auth:user:${userId}`);
                if (cached) {
                    const u = JSON.parse(cached) as { id?: string; roles?: string[] };
                    return {
                        id: u.id || userId,
                        roles: Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [UserRole.RIDER],
                    };
                }
            }
        } catch (err: unknown) {
            console.warn('[payment.repository] Failed to fetch cached user from Redis', err instanceof Error ? err.message : String(err));
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
