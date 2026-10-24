import { Kafka } from 'kafkajs';
import { createLogger } from '@urbanfleet/common';
import { DeadLetterEnvelope } from '@urbanfleet/contracts';

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

  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({ clientId: 'dlq-replay-tool', brokers });

  const consumer = kafka.consumer({ groupId: `dlq-replay-${Date.now()}` });
  const producer = kafka.producer();

  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: dlqTopic, fromBeginning: true });

  logger.info(`Starting redrive replay from ${dlqTopic} (Limit: ${limit} events)...`);

  let replayedCount = 0;

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value || replayedCount >= limit) return;

      try {
        const rawString = message.value.toString();
        const dlqEnvelope: DeadLetterEnvelope<unknown> = JSON.parse(rawString);

        const targetTopic = dlqEnvelope.originalTopic;
        if (!targetTopic) {
          logger.warn(`Skipping DLQ message ${message.offset}: missing originalTopic metadata.`);
          return;
        }

        // Re-inject original message payload with audit redrive headers
        await producer.send({
          topic: targetTopic,
          messages: [
            {
              key: dlqEnvelope.originalKey || dlqEnvelope.id,
              value: typeof dlqEnvelope.payload === 'string'
                ? dlqEnvelope.payload
                : JSON.stringify(dlqEnvelope.payload),
              headers: {
                'x-replayed': 'true',
                'x-replayed-at': new Date().toISOString(),
                'x-replayed-from-dlq': dlqTopic,
                'x-original-error': dlqEnvelope.error?.message || 'unknown',
              },
            },
          ],
        });

        replayedCount++;
        logger.info(`[REPLAYED ${replayedCount}/${limit}] Event ${dlqEnvelope.id} successfully redriven to ${targetTopic}`);

        if (replayedCount >= limit) {
          logger.info(`Reached replay limit of ${limit}. Disconnecting replay worker.`);
          await consumer.disconnect();
          await producer.disconnect();
          process.exit(0);
        }
      } catch (err: unknown) {
        logger.error(`Failed to replay DLQ message at offset ${message.offset}:`, err);
      }
    },
  });
}

main().catch((err) => {
  logger.error('Fatal error running DLQ replay CLI:', err);
  process.exit(1);
});
