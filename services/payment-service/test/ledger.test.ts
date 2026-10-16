import { describe, it, expect, vi } from 'vitest';
import { LedgerService } from '../src/services/ledger.service.js';

describe('Payment Service Ledger Recording', () => {
  it('should generate balanced 3-legged entries for payment capture (Gateway, Driver, Platform)', async () => {
    const mockLedgerRepo: any = {
      insertLegs: vi.fn().mockResolvedValue([])
    };
    const ledgerService = new LedgerService(mockLedgerRepo);

    const payment = {
      id: 'pay-12345',
      driverId: 'drv-67890',
      amountPaise: 10000 // ₹100
    };

    const mockTx = {};
    const txId = await ledgerService.recordPaymentCapture(mockTx, payment);

    expect(txId).toBeDefined();
    expect(mockLedgerRepo.insertLegs).toHaveBeenCalledOnce();

    const capturedEntries = mockLedgerRepo.insertLegs.mock.calls[0][1];
    expect(capturedEntries).toHaveLength(3);

    // Leg 1: GATEWAY_CLEARING DEBIT ₹100
    expect(capturedEntries[0].account).toBe('GATEWAY_CLEARING');
    expect(capturedEntries[0].entryType).toBe('DEBIT');
    expect(capturedEntries[0].amountPaise).toBe(10000n);

    // Leg 2: DRIVER CREDIT ₹80 (80%)
    expect(capturedEntries[1].account).toBe('DRIVER');
    expect(capturedEntries[1].entryType).toBe('CREDIT');
    expect(capturedEntries[1].amountPaise).toBe(8000n);

    // Leg 3: PLATFORM_COMMISSION CREDIT ₹20 (20%)
    expect(capturedEntries[2].account).toBe('PLATFORM_COMMISSION');
    expect(capturedEntries[2].entryType).toBe('CREDIT');
    expect(capturedEntries[2].amountPaise).toBe(2000n);
  });
});
