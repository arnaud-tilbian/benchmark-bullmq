#!/bin/bash

# =============================================================================
# BullMQ Benchmark Script - Reader/Writer Variation
# Focus: Testing different read/write workload patterns
# =============================================================================

set -e

# Configuration
THREADS=4           # Fixed thread count
QUEUES=4            # Fixed queue count
DURATION=10
CONCURRENCY=1
COOLDOWN=3
CONTAINER_NAME="bench-db"
OUTPUT_FILE="benchmark_rw_$(date +%Y%m%d_%H%M%S).csv"

# Reader/Writer configurations: "readers:writers"
RW_CONFIGS=(
  "8:8"    # balanced
  "16:4"   # read-heavy
  "4:16"   # write-heavy
)

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
  local readers="$3"
  local writers="$4"
  
  local workload_type="balanced"
  if [ "$readers" -gt "$writers" ]; then
    workload_type="read-heavy"
  elif [ "$writers" -gt "$readers" ]; then
    workload_type="write-heavy"
  fi
  
  log_subheader "r=$readers, w=$writers ($workload_type)"
  
  # Run benchmark and capture output
  output=$(bun index.ts -r "$readers" -w "$writers" -q "$QUEUES" -c "$CONCURRENCY" -d "$DURATION" 2>&1)
  
  # Print raw output
  echo "$output" | grep -E "(Total writes|Total reads)"
  
  # Parse results
  parse_results "$output"
  
  # Append to CSV
  echo "$db,$threads,$QUEUES,$readers,$writers,$DURATION,$total_writes,$writes_per_sec,$total_reads,$reads_per_sec" >> "$OUTPUT_FILE"
  
  log_success "Saved to CSV"
}

run_all_rw_configs() {
  local db="$1"
  local threads="$2"
  
  for rw in "${RW_CONFIGS[@]}"; do
    local readers="${rw%%:*}"
    local writers="${rw##*:}"
    run_benchmark "$db" "$threads" "$readers" "$writers"
  done
}

# =============================================================================
# Database-specific functions
# =============================================================================

start_dragonfly() {
  stop_container
  
  log_info "Starting Dragonfly with $THREADS proactor thread(s)..."
  docker run -d --rm --name "$CONTAINER_NAME" \
    -p 6379:6379 \
    docker.dragonflydb.io/dragonflydb/dragonfly \
    --proactor_threads="$THREADS" \
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
  stop_container
  
  log_info "Starting Valkey with $THREADS io-thread(s)..."
  docker run -d --rm --name "$CONTAINER_NAME" \
    -p 6379:6379 \
    valkey/valkey:latest \
    --io-threads "$THREADS" \
    --io-threads-do-reads yes > /dev/null
  
  wait_for_ready
}

# =============================================================================
# Benchmark Runners
# =============================================================================

bench_dragonfly() {
  log_header "Benchmarking DRAGONFLY (threads=$THREADS, queues=$QUEUES)"
  start_dragonfly
  run_all_rw_configs "dragonfly" "$THREADS"
}

bench_redis() {
  log_header "Benchmarking REDIS (single-threaded, queues=$QUEUES)"
  start_redis
  run_all_rw_configs "redis" "1"
}

bench_valkey() {
  log_header "Benchmarking VALKEY (io-threads=$THREADS, queues=$QUEUES)"
  start_valkey
  run_all_rw_configs "valkey" "$THREADS"
}

# =============================================================================
# Main
# =============================================================================

main() {
  echo ""
  echo "=============================================="
  echo "  BullMQ Benchmark: Reader/Writer Variation"
  echo "=============================================="
  echo ""
  echo "Configuration:"
  echo "  Threads:     $THREADS (fixed)"
  echo "  Queues:      $QUEUES (fixed)"
  echo "  R/W configs: ${RW_CONFIGS[*]}"
  echo "  Duration:    ${DURATION}s"
  echo "  Concurrency: $CONCURRENCY"
  echo "  Output:      $OUTPUT_FILE"
  echo ""
  echo "Workload patterns:"
  echo "  - 8:8   = balanced"
  echo "  - 16:4  = read-heavy (status polling, monitoring)"
  echo "  - 4:16  = write-heavy (high ingestion, event streaming)"
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
  echo "Results by workload pattern:"
  echo ""
  column -t -s',' "$OUTPUT_FILE"
  echo ""
}

# Run main
main "$@"
