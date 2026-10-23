import { ClientSession } from "../types/database.types.js";
import { prisma, type Prisma } from '../db/client.js';
import { IPayout } from "../types/payment.models.js";
import { PayoutMode, PayoutStatus } from "../types/payment.types.js";
import { LIVE_PAYOUT_STATUSES } from "../constants/payment.constants.js";
import { AppError } from '../utils/AppError.js';

function formatPayout(row: Record<string, unknown> | null | undefined): IPayout {
    if (!row) return null as unknown as IPayout;
    return {
        id: String(row.id),
        payment: row.paymentId ? String(row.paymentId) : undefined,
        paymentId: row.paymentId ? String(row.paymentId) : undefined,
        ride: row.rideId ? String(row.rideId) : undefined,
        rideId: row.rideId ? String(row.rideId) : undefined,
        driver: row.driverId ? String(row.driverId) : undefined,
        driverId: row.driverId ? String(row.driverId) : undefined,
        amountPaise: row.amountPaise !== undefined && row.amountPaise !== null ? Number(row.amountPaise) : 0,
        currency: (row.currency as "INR") || "INR",
        status: row.status as PayoutStatus,
        mode: row.mode as PayoutMode,
        gatewayPayoutId: (row.gatewayPayoutId as string | undefined) ?? undefined,
        utr: (row.utr as string | undefined) ?? undefined,
        ledgerTransactionId: (row.ledgerTransactionId as string | undefined) ?? undefined,
        reversalLedgerTransactionId: (row.reversalLedgerTransactionId as string | undefined) ?? undefined,
        processedAt: (row.processedAt as Date | undefined) ?? undefined,
        failedAt: (row.failedAt as Date | undefined) ?? undefined,
        reversedAt: (row.reversedAt as Date | undefined) ?? undefined,
        failureReason: (row.failureReason as string | undefined) ?? undefined,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
    } as unknown as IPayout;
}

function getClient(session?: ClientSession) {
    if (session && typeof session === "object" && "tx" in session && session.tx) {
        return session.tx;
    }
    return (session as Prisma.TransactionClient | undefined) ?? prisma;
}

class PayoutRepository {
    async create(
        data: Partial<IPayout>,
        session?: ClientSession
    ): Promise<IPayout> {
        const client = getClient(session);
        const created = await client.payout.create({
            data: {
                driverId: data.driver ? data.driver.toString() : "",
                paymentId: data.payment ? data.payment.toString() : null,
                rideId: data.ride ? data.ride.toString() : "",
                amountPaise: data.amountPaise ?? 0,
                currency: data.currency ?? "INR",
                status: (data.status ?? "PENDING") as unknown as Prisma.EnumPayoutStatusFilter["equals"],
                mode: data.mode ?? "IMPS",
                gatewayPayoutId: data.gatewayPayoutId ?? null,
                utr: data.utr ?? null,
                ledgerTransactionId: data.ledgerTransactionId ?? null,
                reversalLedgerTransactionId: data.reversalLedgerTransactionId ?? null,
                failureReason: data.failureReason ?? null,
                metadata: (data.metadata as Prisma.InputJsonValue) ?? undefined,
            },
        });

        if (!created) {
            throw new AppError(
                "Failed to create payout.",
                500,
                "PAYOUT_CREATE_FAILED"
            );
        }

        return formatPayout(created);
    }

    async findById(
        id: string,
        session?: ClientSession
    ): Promise<IPayout | null> {
        const client = getClient(session);
        const row = await client.payout.findUnique({
            where: { id },
        });
        return row ? formatPayout(row) : null;
    }

    async findByGatewayPayoutId(
        gatewayPayoutId: string,
        session?: ClientSession
    ): Promise<IPayout | null> {
        const client = getClient(session);
        const row = await client.payout.findFirst({
            where: { gatewayPayoutId },
        });
        return row ? formatPayout(row) : null;
    }

    async transition(
        payoutId: string,
        fromStatuses: readonly PayoutStatus[],
        update: Partial<IPayout>,
        session?: ClientSession
    ): Promise<IPayout | null> {
        const client = getClient(session);
        const updated = await client.payout.updateMany({
            where: {
                id: payoutId,
                status: { in: [...fromStatuses] as unknown as Prisma.EnumPayoutStatusFilter["in"] },
            },
            data: {
                ...(update.status ? { status: update.status as unknown as Prisma.EnumPayoutStatusFilter["equals"] } : {}),
                ...(update.gatewayPayoutId ? { gatewayPayoutId: update.gatewayPayoutId } : {}),
                ...(update.utr ? { utr: update.utr } : {}),
                ...(update.ledgerTransactionId ? { ledgerTransactionId: update.ledgerTransactionId } : {}),
                ...(update.reversalLedgerTransactionId ? { reversalLedgerTransactionId: update.reversalLedgerTransactionId } : {}),
                ...(update.processedAt ? { processedAt: update.processedAt } : {}),
                ...(update.failedAt ? { failedAt: update.failedAt } : {}),
                ...(update.reversedAt ? { reversedAt: update.reversedAt } : {}),
                ...(update.failureReason ? { failureReason: update.failureReason } : {}),
            },
        });

        if (updated.count === 0) {
            return null;
        }

        return this.findById(payoutId, session);
    }

    async findLiveByPayment(
        payment: string,
        session?: ClientSession
    ): Promise<IPayout | null> {
        const client = getClient(session);
        const row = await client.payout.findFirst({
            where: {
                paymentId: payment.toString(),
                status: { in: [...LIVE_PAYOUT_STATUSES] as unknown as Prisma.EnumPayoutStatusFilter["in"] },
            },
        });
        return row ? formatPayout(row) : null;
    }

    async sumAmountByDriver(
        driver: string,
        statuses: readonly PayoutStatus[]
    ): Promise<number> {
        const result = await prisma.payout.aggregate({
            where: {
                driverId: driver.toString(),
                status: { in: [...statuses] as unknown as Prisma.EnumPayoutStatusFilter["in"] },
            },
            _sum: {
                amountPaise: true,
            },
        });
        return result._sum?.amountPaise ?? 0;
    }

    async updateStatus(
        payoutId: string,
        status: PayoutStatus,
        update: Partial<IPayout> = {},
        session?: ClientSession
    ): Promise<IPayout | null> {
        const client = getClient(session);
        const updated = await client.payout.update({
            where: { id: payoutId },
            data: {
                status: status as unknown as Prisma.EnumPayoutStatusFilter["equals"],
                ...(update.gatewayPayoutId ? { gatewayPayoutId: update.gatewayPayoutId } : {}),
                ...(update.utr ? { utr: update.utr } : {}),
                ...(update.failureReason ? { failureReason: update.failureReason } : {}),
            },
        });
        return formatPayout(updated);
    }

    async update(
        payoutId: string,
        update: Partial<IPayout>,
        session?: ClientSession
    ): Promise<IPayout | null> {
        const client = getClient(session);
        const updated = await client.payout.update({
            where: { id: payoutId },
            data: {
                ...(update.status ? { status: update.status as unknown as Prisma.EnumPayoutStatusFilter["equals"] } : {}),
                ...(update.gatewayPayoutId ? { gatewayPayoutId: update.gatewayPayoutId } : {}),
                ...(update.utr ? { utr: update.utr } : {}),
                ...(update.failureReason ? { failureReason: update.failureReason } : {}),
            },
        });
        return formatPayout(updated);
    }

    async findPendingForDriver(driver: string): Promise<IPayout[]> {
        const rows = await prisma.payout.findMany({
            where: {
                driverId: driver.toString(),
                status: {
                    in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] as unknown as Prisma.EnumPayoutStatusFilter["in"],
                },
            },
            orderBy: {
                createdAt: "asc",
            },
        });
        return rows.map(formatPayout);
    }

    async findByPayment(
        payment: string,
        session?: ClientSession
    ): Promise<IPayout | null> {
        const client = getClient(session);
        const row = await client.payout.findFirst({
            where: {
                paymentId: payment.toString(),
            },
        });
        return row ? formatPayout(row) : null;
    }

    async list(
        driver: string,
        page = 1,
        limit = 20
    ): Promise<{
        items: IPayout[];
        total: number;
    }> {
        const where = {
            driverId: driver.toString(),
        };

        const [rows, total] = await Promise.all([
            prisma.payout.findMany({
                where,
                orderBy: {
                    createdAt: "desc",
                },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.payout.count({ where }),
        ]);

        return {
            items: rows.map(formatPayout),
            total,
        };
    }

    async findByDriver(driverId: string): Promise<IPayout[]> {
        const rows = await prisma.payout.findMany({
            where: { driverId: driverId.toString() },
            orderBy: { createdAt: "desc" },
        });
        return rows.map(formatPayout);
    }

    async findPending(): Promise<IPayout[]> {
        const rows = await prisma.payout.findMany({
            where: { status: "PENDING" },
            orderBy: { createdAt: "desc" },
        });
        return rows.map(formatPayout);
    }

    async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
        return prisma.$transaction(fn as unknown as Parameters<typeof prisma.$transaction>[0]) as Promise<T>;
    }
}

export const payoutRepository = new PayoutRepository();
