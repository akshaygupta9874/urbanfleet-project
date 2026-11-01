import { Kafka } from 'kafkajs';
import { createDurableProducer, createKafkaClient, createKafkaConsumer, createLogger } from '@urbanfleet/common';
import { DeadLetterEnvelopeSchema } from '@urbanfleet/contracts';

const logger = createLogger('dlq-replay-tool');

async function main() {
  const args = process.argv.slice(2);
  const topicArgIdx = args.indexOf('--topic');
  const limitArgIdx = args.indexOf('--limit');

  if (topicArgIdx === -1 || !args[topicArgIdx + 1]) {
    console.error('Usage: npm run dlq:replay -- --topic <dlq-topic-name> [--limit <number>]');
    process.exit(1);
  }

  const dlqTopic = args[topicArgIdx + 1];
  const limit = limitArgIdx !== -1 ? parseInt(args[limitArgIdx + 1], 10) : 10;
  if (!dlqTopic.endsWith('.DLQ')) {
    throw new Error(`Refusing to replay non-DLQ topic: ${dlqTopic}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('--limit must be an integer between 1 and 1000');
  }

  const kafka = createKafkaClient('dlq-replay-tool');

  const consumer = createKafkaConsumer(kafka, `dlq-replay-${Date.now()}`);
  const producer = createDurableProducer(kafka);

  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: dlqTopic, fromBeginning: true });

  logger.info(`Starting redrive replay from ${dlqTopic} (Limit: ${limit} events)...`);

  let replayedCount = 0;
  let skippedCount = 0;
  let stopping = false;

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value || replayedCount >= limit || stopping) return;

      try {
        const rawString = message.value.toString();
        const parsed: unknown = JSON.parse(rawString);
        const dlqEnvelope = DeadLetterEnvelopeSchema.parse(parsed);

        const targetTopic = dlqEnvelope.originalTopic;
        if (targetTopic.endsWith('.DLQ')) {
          throw new Error(`Refusing to replay into another DLQ topic: ${targetTopic}`);
        }

        const originalValue =
          dlqEnvelope.originalValue ??
          (dlqEnvelope.originalEnvelope
            ? JSON.stringify(dlqEnvelope.originalEnvelope)
            : undefined);
        if (!originalValue) {
          skippedCount++;
          logger.error(
            `Skipping legacy DLQ message at offset ${message.offset}: original Kafka value is unavailable.`
          );
          return;
        }

        await producer.send({
          acks: -1,
          topic: targetTopic,
          messages: [
            {
              key: dlqEnvelope.originalKey || dlqEnvelope.id,
              value: originalValue,
              headers: {
                'x-replayed': 'true',
                'x-replayed-at': new Date().toISOString(),
                'x-replayed-from-dlq': dlqTopic,
                'x-original-event-id': dlqEnvelope.originalEventId || '',
                'x-original-error': dlqEnvelope.error?.message || 'unknown',
              },
            },
          ],
        });

        replayedCount++;
        logger.info(`[REPLAYED ${replayedCount}/${limit}] Event ${dlqEnvelope.id} successfully redriven to ${targetTopic}`);

        if (replayedCount >= limit) {
          logger.info(`Reached replay limit of ${limit}. Disconnecting replay worker.`);
          stopping = true;
          await consumer.stop();
        }
      } catch (err: unknown) {
        logger.error(`Failed to replay DLQ message at offset ${message.offset}:`, err);
        skippedCount++;
      }
    },
  });

  await consumer.disconnect();
  await producer.disconnect();
  logger.info(`DLQ replay complete: replayed=${replayedCount}, skipped=${skippedCount}`);
}

main().catch((err) => {
  logger.error('Fatal error running DLQ replay CLI:', err);
  process.exit(1);
});
