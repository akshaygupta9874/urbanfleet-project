export enum LedgerEntryType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT'
}

export interface LedgerLegInput {
  entryType: LedgerEntryType;
  amountPaise: bigint | number;
}

/**
 * Asserts the double-entry accounting invariant:
 * Sum(Debits) - Sum(Credits) === 0
 * Throws an error immediately if unbalanced.
 */
export function validateLedgerBalance(legs: LedgerLegInput[]): void {
  let totalDebits = BigInt(0);
  let totalCredits = BigInt(0);

  for (const leg of legs) {
    const amount = typeof leg.amountPaise === 'bigint' ? leg.amountPaise : BigInt(leg.amountPaise);
    if (amount <= BigInt(0)) {
      throw new Error(`Ledger entry amount must be strictly positive. Received: ${amount}`);
    }

    if (leg.entryType === LedgerEntryType.DEBIT) {
      totalDebits += amount;
    } else if (leg.entryType === LedgerEntryType.CREDIT) {
      totalCredits += amount;
    } else {
      throw new Error(`Invalid ledger entry type: ${(leg as any).entryType}`);
    }
  }

  if (totalDebits !== totalCredits) {
    throw new Error(
      `Ledger invariant violation! Journal is unbalanced: Total Debits (${totalDebits}) != Total Credits (${totalCredits})`
    );
  }
}
