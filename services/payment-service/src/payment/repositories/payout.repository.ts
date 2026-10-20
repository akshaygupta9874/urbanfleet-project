import { ClientSession } from "../types/database.types.js";
import { prisma } from "../../db/client.js";
import { IPayout } from "../types/payment.models.js";
import { PayoutMode, PayoutStatus } from "../types/payment.types.js";
import { LIVE_PAYOUT_STATUSES } from "../constants/payment.constants.js";
import { AppError } from "../../utils/AppError.js";

function formatPayout(row: any): IPayout {
    if (!row) return null as any;
    return {
        id: row.id,
        payment: row.paymentId,
        paymentId: row.paymentId,
        ride: row.rideId,
        rideId: row.rideId,
        driver: row.driverId,
        driverId: row.driverId,
        amountPaise: row.amountPaise !== undefined && row.amountPaise !== null ? Number(row.amountPaise) : row.amountPaise,
        currency: row.currency as any,
        status: row.status as PayoutStatus,
        mode: row.mode as PayoutMode,
        gatewayPayoutId: row.gatewayPayoutId ?? undefined,
        utr: row.utr ?? undefined,
        ledgerTransactionId: row.ledgerTransactionId ?? undefined,
        reversalLedgerTransactionId: row.reversalLedgerTransactionId ?? undefined,
        processedAt: row.processedAt ?? undefined,
        failedAt: row.failedAt ?? undefined,
        reversedAt: row.reversedAt ?? undefined,
        failureReason: row.failureReason ?? undefined,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    } as unknown as IPayout;
}

function getClient(session?: ClientSession) {
    return (session as any)?.tx ?? session ?? prisma;
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
                status: data.status ?? "PENDING",
                mode: data.mode ?? "IMPS",
                gatewayPayoutId: data.gatewayPayoutId ?? null,
                utr: data.utr ?? null,
                ledgerTransactionId: data.ledgerTransactionId ?? null,
                reversalLedgerTransactionId: data.reversalLedgerTransactionId ?? null,
                failureReason: data.failureReason ?? null,
                metadata: (data.metadata as any) ?? undefined,
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
                status: { in: [...fromStatuses] as any },
            },
            data: {
                ...(update.status ? { status: update.status } : {}),
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
                status: { in: [...LIVE_PAYOUT_STATUSES] },
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
                status: { in: [...statuses] as any },
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
                status,
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
                ...(update.status ? { status: update.status } : {}),
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
                    in: [PayoutStatus.PENDING as any, PayoutStatus.PROCESSING as any],
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

    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        return prisma.$transaction(fn);
    }
}

export const payoutRepository = new PayoutRepository();
