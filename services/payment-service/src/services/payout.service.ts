import { PayoutRepository } from '../repositories/payout.repository.js';
import { LedgerService } from './ledger.service.js';

export class PayoutService {
  private payoutRepo: PayoutRepository;
  private ledgerService: LedgerService;

  constructor(
    payoutRepo: PayoutRepository,
    ledgerService: LedgerService
  ) {
    this.payoutRepo = payoutRepo;
    this.ledgerService = ledgerService;
  }

  async createPayoutRequest(driverId: string, rideId: string, amountPaise: number) {
    return this.payoutRepo.create({
      driverId,
      rideId,
      amountPaise,
      status: 'PENDING'
    });
  }

  async processPayout(payoutId: string) {
    return this.payoutRepo.executeTransaction(async (tx) => {
      const payout = await this.payoutRepo.update(payoutId, {
        status: 'PROCESSED',
        processedAt: new Date()
      }, tx);
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
