import { prisma, type Prisma } from "../../db/client.js";
import { ClientSession } from "../types/database.types.js";
import { ILedgerEntry } from "../types/payment.models.js";
import {
    CurrencyType,
    LedgerAccount,
    LedgerEntryType,
    LedgerReferenceType,
    Paise,
} from "../types/payment.types.js";

interface InsertableEntry {
    transactionId: string;
    account: LedgerAccount;
    ownerId?: string | undefined;
    entryType: LedgerEntryType;
    amountPaise: Paise;
    currency: CurrencyType;
    referenceType: LedgerReferenceType;
    referenceId: string;
    idempotencyKey?: string | undefined;
    legIndex?: number | undefined;
    description: string;
    metadata?: Record<string, unknown>;
}

export interface AccountTotals {
    totalDebitPaise: Paise;
    totalCreditPaise: Paise;
}

export interface UnbalancedTransaction {
    transactionId: string;
    debitPaise: Paise;
    creditPaise: Paise;
}

function formatLedgerEntry(row: Record<string, unknown>): ILedgerEntry {
    return {
        id: String(row.id),
        transactionId: String(row.transactionId),
        account: row.account as LedgerAccount,
        ownerId: (row.ownerId as string | null) ?? null,
        entryType: row.entryType as LedgerEntryType,
        amountPaise: Number(row.amountPaise),
        currency: (row.currency as CurrencyType) || "INR",
        referenceType: row.referenceType as LedgerReferenceType,
        referenceId: (row.referenceId as string | null) ?? null,
        idempotencyKey: (row.idempotencyKey as string | undefined) ?? undefined,
        legIndex: (row.legIndex as number | undefined) ?? undefined,
        description: (row.description as string | undefined) ?? "",
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        createdAt: row.createdAt as Date,
    } as unknown as ILedgerEntry;
}

class LedgerRepository {
    async insertEntries(
        entries: InsertableEntry[],
        session?: ClientSession
    ): Promise<ILedgerEntry[]> {
        if (entries.length === 0) {
            return [];
        }

        const client = (session && typeof session === "object" && "tx" in session && session.tx)
            ? session.tx
            : ((session as Prisma.TransactionClient | undefined) ?? prisma);

        const data = entries.map((e) => ({
            transactionId: e.transactionId,
            account: e.account as unknown as Prisma.LedgerEntryCreateManyInput["account"],
            ownerId: e.ownerId ? e.ownerId.toString() : null,
            entryType: e.entryType as unknown as Prisma.LedgerEntryCreateManyInput["entryType"],
            amountPaise: BigInt(e.amountPaise),
            currency: e.currency,
            referenceType: e.referenceType.toString(),
            referenceId: e.referenceId ? e.referenceId.toString() : null,
            idempotencyKey: e.idempotencyKey ?? null,
            legIndex: e.legIndex ?? null,
            description: e.description,
            metadata: (e.metadata as Prisma.InputJsonValue) ?? undefined,
        }));

        await client.ledgerEntry.createMany({
            data,
        });

        const first = entries[0];
        if (!first) {
            return [];
        }

        const created = await client.ledgerEntry.findMany({
            where: {
                transactionId: first.transactionId,
            },
            orderBy: {
                createdAt: "asc",
            },
        });

        return created.map(formatLedgerEntry);
    }

    async findByTransactionId(
        transactionId: string
    ): Promise<ILedgerEntry[]> {
        const rows = await prisma.ledgerEntry.findMany({
            where: {
                transactionId,
            },
            orderBy: {
                createdAt: "asc",
            },
        });
        return rows.map(formatLedgerEntry);
    }

    async findByIdempotencyKey(
        idempotencyKey: string
    ): Promise<ILedgerEntry[]> {
        const rows = await prisma.ledgerEntry.findMany({
            where: {
                idempotencyKey,
            },
            orderBy: {
                legIndex: "asc",
            },
        });
        return rows.map(formatLedgerEntry);
    }

    async listByReference(
        referenceType: LedgerReferenceType,
        referenceId: string
    ): Promise<ILedgerEntry[]> {
        const rows = await prisma.ledgerEntry.findMany({
            where: {
                referenceType: referenceType.toString(),
                referenceId: referenceId.toString(),
            },
            orderBy: {
                createdAt: "asc",
            },
        });
        return rows.map(formatLedgerEntry);
    }

    /**
     * Debit / credit totals of one account, optionally limited to a time range
     * and / or to one owner (e.g. a single driver).
     */
    async sumByAccount(
        account: LedgerAccount,
        range?: {
            from?: Date;
            to?: Date;
        },
        ownerId?: string
    ): Promise<AccountTotals> {
        const where: Prisma.LedgerEntryWhereInput = {
            account: account as unknown as Prisma.EnumLedgerAccountFilter["equals"],
        };

        if (ownerId) {
            where.ownerId = ownerId.toString();
        }

        if (range?.from || range?.to) {
            where.createdAt = {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lt: range.to } : {}),
            };
        }

        return this.totalsFor(where);
    }

    /** Debit / credit totals over the WHOLE ledger (must always be equal). */
    async sumAll(): Promise<AccountTotals> {
        return this.totalsFor({});
    }

    /** Transactions whose debits and credits differ (should always be empty). */
    async findUnbalancedTransactions(
        limit = 100
    ): Promise<UnbalancedTransaction[]> {
        const rows = await prisma.$queryRawUnsafe<
            { transactionId: string; debitPaise: bigint; creditPaise: bigint }[]
        >(
            `SELECT 
                transaction_id as "transactionId",
                SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_paise ELSE 0 END) as "debitPaise",
                SUM(CASE WHEN entry_type = 'CREDIT' THEN amount_paise ELSE 0 END) as "creditPaise"
            FROM ledger_entries
            GROUP BY transaction_id
            HAVING SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_paise ELSE 0 END) <> 
                   SUM(CASE WHEN entry_type = 'CREDIT' THEN amount_paise ELSE 0 END)
            LIMIT $1`,
            limit
        );

        return rows.map((r) => ({
            transactionId: r.transactionId,
            debitPaise: Number(r.debitPaise),
            creditPaise: Number(r.creditPaise),
        }));
    }

    async listAll(
        limit = 100
    ): Promise<ILedgerEntry[]> {
        const rows = await prisma.ledgerEntry.findMany({
            orderBy: {
                createdAt: "desc",
            },
            take: limit,
        });
        return rows.map(formatLedgerEntry);
    }

    private async totalsFor(
        where: Prisma.LedgerEntryWhereInput
    ): Promise<AccountTotals> {
        const groups = await prisma.ledgerEntry.groupBy({
            by: ["entryType"],
            where,
            _sum: {
                amountPaise: true,
            },
        });

        const debitGroup = groups.find((g) => g.entryType === LedgerEntryType.DEBIT);
        const creditGroup = groups.find((g) => g.entryType === LedgerEntryType.CREDIT);

        return {
            totalDebitPaise: debitGroup?._sum.amountPaise ? Number(debitGroup._sum.amountPaise) : 0,
            totalCreditPaise: creditGroup?._sum.amountPaise ? Number(creditGroup._sum.amountPaise) : 0,
        };
    }
}

export const ledgerRepository = new LedgerRepository();
