#!/bin/bash
# Pre-create all required Kafka topics with 3 partitions each
# Note: Docker Compose enforces `depends_on: kafka: condition: service_healthy` before running this script
echo "Creating UrbanFleet Event Topics..."

TOPIC_REPLICATION_FACTOR="${KAFKA_TOPIC_REPLICATION_FACTOR:-1}"
TOPIC_MIN_ISR="${KAFKA_TOPIC_MIN_ISR:-1}"

for topic in \
  urbanfleet.auth.events \
  urbanfleet.driver.events \
  urbanfleet.ride.events \
  urbanfleet.payment.events \
  urbanfleet.notification.events
do
  kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists \
    --topic "$topic" --partitions 3 --replication-factor "$TOPIC_REPLICATION_FACTOR" \
    --config min.insync.replicas="$TOPIC_MIN_ISR"
done

# Dead Letter Queues. Keep failed events for seven days while preventing
# unbounded disk growth. Increase replication when running multiple brokers.
for topic in \
  urbanfleet.auth.events.DLQ \
  urbanfleet.driver.events.DLQ \
  urbanfleet.ride.events.DLQ \
  urbanfleet.payment.events.DLQ \
  urbanfleet.notification.events.DLQ
do
  kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists \
    --topic "$topic" --partitions 1 --replication-factor "$TOPIC_REPLICATION_FACTOR" \
    --config cleanup.policy=delete \
    --config retention.ms=604800000 \
    --config segment.ms=86400000 \
    --config min.insync.replicas="$TOPIC_MIN_ISR"
done

echo "Kafka topics created successfully!"
