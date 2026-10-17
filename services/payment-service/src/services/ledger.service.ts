import { LedgerRepository } from '../repositories/ledger.repository.js';
import { validateLedgerBalance } from '@urbanfleet/common';
import crypto from 'crypto';

export class LedgerService {
  constructor(private ledgerRepo: LedgerRepository) {}

  async recordPaymentCapture(tx: any, payment: any) {
    const transactionId = crypto.randomUUID();
    const amount = BigInt(payment.amountPaise);
    const platformCommission = (amount * BigInt(20)) / BigInt(100); // 20% commission
    const driverEarning = amount - platformCommission;

    const entries = [
      // Leg 1: Debit Gateway Clearing (Asset increased)
      {
        transactionId,
        account: 'GATEWAY_CLEARING',
        entryType: 'DEBIT',
        amountPaise: amount,
        referenceType: 'PAYMENT_CAPTURE',
        referenceId: payment.id,
        idempotencyKey: `pay_${payment.id}`,
        legIndex: 1,
        description: 'Payment capture received from gateway'
      },
      // Leg 2: Credit Driver Payable (Liability increased)
      {
        transactionId,
        account: 'DRIVER',
        entryType: 'CREDIT',
        amountPaise: driverEarning,
        ownerId: payment.driverId || undefined,
        referenceType: 'PAYMENT_CAPTURE',
        referenceId: payment.id,
        idempotencyKey: `pay_${payment.id}`,
        legIndex: 2,
        description: 'Net driver earning payable'
      },
      // Leg 3: Credit Platform Commission (Revenue increased)
      {
        transactionId,
        account: 'PLATFORM_COMMISSION',
        entryType: 'CREDIT',
        amountPaise: platformCommission,
        referenceType: 'PAYMENT_CAPTURE',
        referenceId: payment.id,
        idempotencyKey: `pay_${payment.id}`,
        legIndex: 3,
        description: 'Platform service commission (20%)'
      }
    ];

    // Invariant check: Sum(Debits) - Sum(Credits) === 0
    validateLedgerBalance(entries.map(e => ({ entryType: e.entryType as any, amountPaise: e.amountPaise })));

    await this.ledgerRepo.insertLegs(tx, entries);
    return transactionId;
  }

  async recordDriverPayout(tx: any, payout: any) {
    const transactionId = crypto.randomUUID();
    const amount = BigInt(payout.amountPaise);

    const entries = [
      {
        transactionId,
        account: 'DRIVER',
        entryType: 'DEBIT',
        amountPaise: amount,
        ownerId: payout.driverId,
        referenceType: 'PAYOUT',
        referenceId: payout.id,
        idempotencyKey: `payout_${payout.id}`,
        legIndex: 1,
        description: 'Driver liability settled via payout'
      },
      {
        transactionId,
        account: 'BANK',
        entryType: 'CREDIT',
        amountPaise: amount,
        referenceType: 'PAYOUT',
        referenceId: payout.id,
        idempotencyKey: `payout_${payout.id}`,
        legIndex: 2,
        description: 'Disbursement from platform bank account'
      }
    ];

    validateLedgerBalance(entries.map(e => ({ entryType: e.entryType as any, amountPaise: e.amountPaise })));
    await this.ledgerRepo.insertLegs(tx, entries);
    return transactionId;
  }

  async getAccountBalance(account: any, ownerId?: string) {
    return this.ledgerRepo.getAccountBalance(account, ownerId);
  }
}
