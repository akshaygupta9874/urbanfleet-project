import { describe, it, expect } from 'vitest';
import { validateLedgerBalance, LedgerEntryType } from '../src/ledger/ledger-validator.js';

describe('Double-Entry Accounting Ledger Invariant', () => {
  it('should accept balanced debit and credit entries', () => {
    expect(() => {
      validateLedgerBalance([
        { entryType: LedgerEntryType.DEBIT, amountPaise: 10000n },
        { entryType: LedgerEntryType.CREDIT, amountPaise: 8000n },
        { entryType: LedgerEntryType.CREDIT, amountPaise: 2000n }
      ]);
    }).not.toThrow();
  });

  it('should throw an invariant violation if debits and credits do not balance to zero', () => {
    expect(() => {
      validateLedgerBalance([
        { entryType: LedgerEntryType.DEBIT, amountPaise: 10000n },
        { entryType: LedgerEntryType.CREDIT, amountPaise: 7000n }
      ]);
    }).toThrow(/Ledger invariant violation/);
  });

  it('should reject zero or negative amounts', () => {
    expect(() => {
      validateLedgerBalance([
        { entryType: LedgerEntryType.DEBIT, amountPaise: -500n },
        { entryType: LedgerEntryType.CREDIT, amountPaise: -500n }
      ]);
    }).toThrow(/must be strictly positive/);
  });
});
