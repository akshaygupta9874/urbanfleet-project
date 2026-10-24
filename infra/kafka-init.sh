#!/bin/bash
# Pre-create all required Kafka topics with 3 partitions each
echo "Waiting for Kafka to be ready..."
cub kafka-ready -b kafka:29092 1 30

echo "Creating UrbanFleet Event Topics..."

kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.auth.events --partitions 3 --replication-factor 1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.driver.events --partitions 3 --replication-factor 1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.ride.events --partitions 3 --replication-factor 1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.payment.events --partitions 3 --replication-factor 1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.notification.events --partitions 3 --replication-factor 1

# Dead Letter Queues
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.auth.events.DLQ --partitions 1 --replication-factor 1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.driver.events.DLQ --partitions 1 --replication-factor 1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.ride.events.DLQ --partitions 1 --replication-factor 1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.payment.events.DLQ --partitions 1 --replication-factor 1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic urbanfleet.notification.events.DLQ --partitions 1 --replication-factor 1

echo "Kafka topics created successfully!"
