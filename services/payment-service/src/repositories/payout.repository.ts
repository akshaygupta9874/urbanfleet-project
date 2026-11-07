import { ClientSession } from "../types/database.types.js";
import { prisma, Payout, type Prisma } from '../db/client.js';
import { IPayout } from "../types/payment.models.js";
import { PayoutMode, PayoutStatus } from "../types/payment.types.js";
import { LIVE_PAYOUT_STATUSES } from "../constants/payment.constants.js";
import { AppError } from '../utils/AppError.js';

export interface CreatePayoutInput {
    driver?: string;
    driverId?: string;
    payment?: string;
    paymentId?: string;
    ride?: string;
    rideId?: string;
    amountPaise: number;
    currency?: "INR";
    status?: PayoutStatus;
    mode?: PayoutMode;
    gatewayPayoutId?: string | null;
    utr?: string | null;
    ledgerTransactionId?: string | null;
    reversalLedgerTransactionId?: string | null;
    failureReason?: string | null;
    metadata?: Record<string, unknown>;
}

function formatPayout(row: Payout | Record<string, unknown>): IPayout {
    const raw = row as Record<string, unknown>;
    const paymentId = String(raw.paymentId || raw.payment || "");
    const rideId = String(raw.rideId || raw.ride || "");
    const driverId = String(raw.driverId || raw.driver || "");

    return {
        id: String(raw.id),
        payment: paymentId,
        ride: rideId,
        driver: driverId,
        amountPaise: raw.amountPaise !== undefined && raw.amountPaise !== null ? Number(raw.amountPaise) : 0,
        currency: (raw.currency as "INR") || "INR",
        status: raw.status as PayoutStatus,
        mode: raw.mode as PayoutMode,
        gatewayPayoutId: (raw.gatewayPayoutId as string | undefined) ?? undefined,
        utr: (raw.utr as string | undefined) ?? undefined,
        ledgerTransactionId: (raw.ledgerTransactionId as string | undefined) ?? undefined,
        reversalLedgerTransactionId: (raw.reversalLedgerTransactionId as string | undefined) ?? undefined,
        processedAt: (raw.processedAt as Date | undefined) ?? undefined,
        failedAt: (raw.failedAt as Date | undefined) ?? undefined,
        reversedAt: (raw.reversedAt as Date | undefined) ?? undefined,
        failureReason: (raw.failureReason as string | undefined) ?? undefined,
        metadata: (raw.metadata as Record<string, unknown>) ?? {},
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

class PayoutRepository {
    async create(
        data: CreatePayoutInput,
        session?: ClientSession
    ): Promise<IPayout> {
        const client = getClient(session);
        const created = await client.payout.create({
            data: {
                driverId: String(data.driverId || data.driver || ""),
                paymentId: data.paymentId ? String(data.paymentId) : data.payment ? String(data.payment) : null,
                rideId: data.rideId ? String(data.rideId) : data.ride ? String(data.ride) : null,
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
        driver: string | string[],
        statuses: readonly PayoutStatus[]
    ): Promise<number> {
        const where: Prisma.PayoutWhereInput = {
            status: { in: [...statuses] as unknown as Prisma.EnumPayoutStatusFilter["in"] },
        };
        if (Array.isArray(driver)) {
            where.driverId = { in: driver.map((d) => d.toString()) };
        } else {
            where.driverId = driver.toString();
        }
        const result = await prisma.payout.aggregate({
            where,
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

    async findPendingForDriver(driver: string | string[]): Promise<IPayout[]> {
        const where: Prisma.PayoutWhereInput = {
            status: {
                in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] as unknown as Prisma.EnumPayoutStatusFilter["in"],
            },
        };
        if (Array.isArray(driver)) {
            where.driverId = { in: driver.map((d) => d.toString()) };
        } else {
            where.driverId = driver.toString();
        }
        const rows = await prisma.payout.findMany({
            where,
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
        driver: string | string[],
        page = 1,
        limit = 20
    ): Promise<{
        items: IPayout[];
        total: number;
    }> {
        const where: Prisma.PayoutWhereInput = Array.isArray(driver)
            ? { driverId: { in: driver.map((d) => d.toString()) } }
            : { driverId: driver.toString() };

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

    async findByDriver(driverId: string | string[]): Promise<IPayout[]> {
        const where: Prisma.PayoutWhereInput = Array.isArray(driverId)
            ? { driverId: { in: driverId.map((d) => d.toString()) } }
            : { driverId: driverId.toString() };
        const rows = await prisma.payout.findMany({
            where,
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
