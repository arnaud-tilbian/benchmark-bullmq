#!/bin/bash
set -e

CONTAINER_NAME="redis-memory-test"

cleanup() {
  docker stop $CONTAINER_NAME 2>/dev/null || true
  docker rm $CONTAINER_NAME 2>/dev/null || true
}
trap cleanup EXIT
PORT=6379  # Avoid conflict with main Redis on 6379

# Stop existing container if any
docker stop $CONTAINER_NAME 2>/dev/null || true
docker rm $CONTAINER_NAME 2>/dev/null || true

# Start Redis (container memory limit is fixed to 8Go)
docker run -d --name $CONTAINER_NAME -p $PORT:6379 redis:latest --save "" --appendonly no

echo "Starting..."
sleep 5  # Wait for Redis to be ready

echo "Running !"

# Run the memory test (pass port via env)
REDIS_PORT=$PORT bun run ./memory-test.ts
