#!/bin/bash

# =============================================================================
# BullMQ Benchmark Script - Dragonfly vs Redis vs Valkey
# =============================================================================

set -e

# Configuration
THREADS=(1 2 4 8 16)
QUEUES=(1 4 8 16)
READERS=8
WRITERS=8
DURATION=10
CONCURRENCY=1
COOLDOWN=3
CONTAINER_NAME="bench-db"
OUTPUT_FILE="benchmark_results_$(date +%Y%m%d_%H%M%S).csv"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_header() {
  echo ""
  echo -e "${YELLOW}=== $1 ===${NC}"
}

log_subheader() {
  echo -e "${BLUE}--- $1 ---${NC}"
}

stop_container() {
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
}

wait_for_ready() {
  log_info "Waiting ${COOLDOWN}s for database to start..."
  sleep "$COOLDOWN"
}

parse_results() {
  local output="$1"
  
  # Extract from: "Total writes: 12,345 (1,234/s)"
  total_writes=$(echo "$output" | grep "Total writes" | sed 's/.*Total writes: \([0-9,]*\).*/\1/' | tr -d ',')
  writes_per_sec=$(echo "$output" | grep "Total writes" | sed 's/.*(\([0-9,]*\)\/s).*/\1/' | tr -d ',')
  
  # Extract from: "Total reads: 10,000 (1,000/s)"
  total_reads=$(echo "$output" | grep "Total reads" | sed 's/.*Total reads: \([0-9,]*\).*/\1/' | tr -d ',')
  reads_per_sec=$(echo "$output" | grep "Total reads" | sed 's/.*(\([0-9,]*\)\/s).*/\1/' | tr -d ',')
}

run_benchmark() {
  local db="$1"
  local threads="$2"
  local queues="$3"
  
  log_subheader "threads=$threads, queues=$queues"
  
  # Run benchmark and capture output
  output=$(bun index.ts -r "$READERS" -w "$WRITERS" -q "$queues" -c "$CONCURRENCY" -d "$DURATION" 2>&1)
  
  # Print raw output
  echo "$output" | grep -E "(Total writes|Total reads)"
  
  # Parse results
  parse_results "$output"
  
  # Append to CSV
  echo "$db,$threads,$queues,$READERS,$WRITERS,$DURATION,$total_writes,$writes_per_sec,$total_reads,$reads_per_sec" >> "$OUTPUT_FILE"
  
  log_success "Saved to CSV"
}

# =============================================================================
# Database-specific functions
# =============================================================================

start_dragonfly() {
  local threads=$1
  stop_container
  
  log_info "Starting Dragonfly with $threads proactor thread(s)..."
  docker run -d --rm --name "$CONTAINER_NAME" \
    -p 6379:6379 \
    docker.dragonflydb.io/dragonflydb/dragonfly \
    --proactor_threads="$threads" \
    --cluster_mode=emulated \
    --lock_on_hashtags > /dev/null
  
  wait_for_ready
}

start_redis() {
  stop_container
  
  log_info "Starting Redis..."
  docker run -d --rm --name "$CONTAINER_NAME" \
    -p 6379:6379 \
    redis:latest > /dev/null
  
  wait_for_ready
}

start_valkey() {
  local threads=$1
  stop_container
  
  log_info "Starting Valkey with $threads io-thread(s)..."
  docker run -d --rm --name "$CONTAINER_NAME" \
    -p 6379:6379 \
    valkey/valkey:latest \
    --io-threads "$threads" \
    --io-threads-do-reads yes > /dev/null
  
  wait_for_ready
}

# =============================================================================
# Benchmark Runners
# =============================================================================

bench_dragonfly() {
  log_header "Benchmarking DRAGONFLY"
  
  for threads in "${THREADS[@]}"; do
    start_dragonfly "$threads"

    log_header "started Dragonfly"
    
    for queues in "${QUEUES[@]}"; do
      run_benchmark "dragonfly" "$threads" "$queues"
    done
  done
}

bench_redis() {
  log_header "Benchmarking REDIS (single-threaded)"
  
  start_redis
  
  for queues in "${QUEUES[@]}"; do
    run_benchmark "redis" "1" "$queues"
  done
}

bench_valkey() {
  log_header "Benchmarking VALKEY"
  
  for threads in "${THREADS[@]}"; do
    start_valkey "$threads"
    
    for queues in "${QUEUES[@]}"; do
      run_benchmark "valkey" "$threads" "$queues"
    done
  done
}

# =============================================================================
# Main
# =============================================================================

main() {
  echo ""
  echo "=============================================="
  echo "  BullMQ Benchmark: Dragonfly vs Redis vs Valkey"
  echo "=============================================="
  echo ""
  echo "Configuration:"
  echo "  Threads:     ${THREADS[*]}"
  echo "  Queues:      ${QUEUES[*]}"
  echo "  Readers:     $READERS"
  echo "  Writers:     $WRITERS"
  echo "  Duration:    ${DURATION}s"
  echo "  Concurrency: $CONCURRENCY"
  echo "  Output:      $OUTPUT_FILE"
  echo ""
  
  # Initialize CSV
  echo "database,threads,queues,readers,writers,duration,total_writes,writes_per_sec,total_reads,reads_per_sec" > "$OUTPUT_FILE"
  
  # Run benchmarks
  bench_dragonfly
  bench_redis
  bench_valkey
  
  # Cleanup
  log_header "Cleanup"
  stop_container
  log_success "Container stopped"
  
  # Summary
  log_header "Benchmark Complete"
  echo ""
  echo "Results saved to: $OUTPUT_FILE"
  echo ""
  echo "Quick summary (top 5 by reads/sec):"
  echo ""
  (head -1 "$OUTPUT_FILE" && tail -n +2 "$OUTPUT_FILE" | sort -t',' -k10 -rn | head -5) | column -t -s','
  echo ""
}

# Run main
main "$@"
