import { PrismaClient, LedgerEntry } from '../db/client.js';

export class LedgerRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async insertLegs(tx: any, entries: any[]): Promise<LedgerEntry[]> {
    return Promise.all(
      entries.map(entry => tx.ledgerEntry.create({ data: entry }))
    );
  }

  async getAccountBalance(account: any, ownerId?: string): Promise<bigint> {
    const where: any = { account };
    if (ownerId) where.ownerId = ownerId;

    const entries = await this.prisma.ledgerEntry.findMany({ where });
    let balance = BigInt(0);
    for (const e of entries) {
      if (e.entryType === 'DEBIT') balance += e.amountPaise;
      else balance -= e.amountPaise;
    }
    return balance;
  }
}
