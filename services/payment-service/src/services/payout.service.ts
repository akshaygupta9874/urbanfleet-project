import { PayoutRepository } from '../repositories/payout.repository.js';
import { LedgerService } from './ledger.service.js';
import { PrismaClient } from '@prisma/client';

export class PayoutService {
  constructor(
    private prisma: PrismaClient,
    private payoutRepo: PayoutRepository,
    private ledgerService: LedgerService
  ) {}

  async createPayoutRequest(driverId: string, rideId: string, amountPaise: number) {
    return this.payoutRepo.create({
      driverId,
      rideId,
      amountPaise,
      status: 'PENDING'
    });
  }

  async processPayout(payoutId: string) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.update({
        where: { id: payoutId },
        data: { status: 'PROCESSED', processedAt: new Date() }
      });
      await this.ledgerService.recordDriverPayout(tx, payout);
      return payout;
    });
  }

  async handlePayoutWebhook(payload: any) {
    return { received: true };
  }

  async getPayoutHistory(driverId: string) {
    return this.payoutRepo.findByDriverId(driverId);
  }
}
