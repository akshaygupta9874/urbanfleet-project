import { PrismaClient, PaymentStatus, LedgerAccount, LedgerEntryType } from '../src/db/client.js';
import crypto from 'crypto';

const prisma = new PrismaClient();
const DEMO_RIDER_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_DRIVER_PROFILE_ID = '44444444-4444-4444-4444-444444444444';

async function main() {
  console.log('🌱 Seeding urbanfleet_payment database...');

  const rideId = crypto.randomUUID();
  const payment = await prisma.payment.create({
    data: {
      rideId,
      riderId: DEMO_RIDER_ID,
      driverId: DEMO_DRIVER_PROFILE_ID,
      amountPaise: 14750,
      currency: 'INR',
      status: PaymentStatus.CAPTURED,
      gateway: 'RAZORPAY',
      gatewayPaymentId: 'pay_demo_seed_001',
      gatewayOrderId: 'order_demo_seed_001',
      method: 'UPI',
      capturedAt: new Date()
    }
  });

  // Seed balanced ledger journal
  const txId = crypto.randomUUID();
  await prisma.ledgerEntry.createMany({
    data: [
      {
        transactionId: txId,
        account: LedgerAccount.GATEWAY_CLEARING,
        entryType: LedgerEntryType.DEBIT,
        amountPaise: BigInt(14750),
        referenceType: 'PAYMENT_CAPTURE',
        referenceId: payment.id,
        idempotencyKey: `seed_${payment.id}`,
        legIndex: 1
      },
      {
        transactionId: txId,
        account: LedgerAccount.DRIVER,
        entryType: LedgerEntryType.CREDIT,
        amountPaise: BigInt(11800), // 80%
        ownerId: DEMO_DRIVER_PROFILE_ID,
        referenceType: 'PAYMENT_CAPTURE',
        referenceId: payment.id,
        idempotencyKey: `seed_${payment.id}`,
        legIndex: 2
      },
      {
        transactionId: txId,
        account: LedgerAccount.PLATFORM_COMMISSION,
        entryType: LedgerEntryType.CREDIT,
        amountPaise: BigInt(2950), // 20%
        referenceType: 'PAYMENT_CAPTURE',
        referenceId: payment.id,
        idempotencyKey: `seed_${payment.id}`,
        legIndex: 3
      }
    ]
  });

  console.log(`✅ Upserted Demo Payment: ${payment.id} with balanced double-entry ledger entries!`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
