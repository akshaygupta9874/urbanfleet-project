import { REDIS_KEYS } from "../constants/payment.constants.js";
import { reconciliationService } from "../services/reconciliation.service.js";
import { acquireLock } from "../../redis/redis-lock.js";
import { paymentLog } from "../utils/payment-logger.js";

export interface ReconciliationJobOptions {
    /** How often to run. Default: 5 minutes. */
    intervalMs?: number;
}

/**
 * Starts the periodic reconciliation (stuck payments, pending refunds, ledger integrity).
 * Safe to call on every instance of the API: a Redis lock lets only ONE instance run a cycle.
 * Call it once at start-up, after PostgreSQL and Redis are connected, and call the returned
 * function during graceful shutdown.
 */
export function startPaymentReconciliationJob(
    options: ReconciliationJobOptions = {}
): () => void {

    const intervalMs = options.intervalMs ?? 5 * 60_000;

    let running = false;

    const runOnce = async (): Promise<void> => {

        if (running) {
            return;
        }

        running = true;

        // TTL a bit shorter than the interval so the next tick is never skipped by its own lock
        const release = await acquireLock(
            REDIS_KEYS.reconciliationLock(),
            Math.floor(intervalMs * 0.8)
        ).catch(() => null);

        try {

            if (!release) {
                return; // another instance is doing this cycle
            }

            const payments = await reconciliationService.reconcileStalePayments();
            const refunds = await reconciliationService.reconcilePendingRefunds();
            const ledger = await reconciliationService.verifyLedgerIntegrity();

            if (!ledger.balanced) {
                paymentLog.error("reconcile.ledger_unbalanced", {
                    totalDebitPaise: ledger.totalDebitPaise,
                    totalCreditPaise: ledger.totalCreditPaise,
                    unbalancedTransactions: ledger.unbalancedTransactions.length,
                });
            }

            paymentLog.info("reconcile.cycle_done", {
                payments,
                refunds,
                ledgerBalanced: ledger.balanced,
            });

        } catch (err) {

            paymentLog.error("reconcile.cycle_failed", {
                message: err instanceof Error ? err.message : "unknown",
            });

        } finally {

            running = false;

            // Not released on purpose when the cycle ran: the lock's TTL keeps the other
            // instances quiet until the next cycle is due.
        }

    };

    const timer = setInterval(() => {
        void runOnce();
    }, intervalMs);

    timer.unref();

    return (): void => clearInterval(timer);

}
