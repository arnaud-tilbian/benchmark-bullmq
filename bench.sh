#!/bin/bash

# Benchmark avec différentes configs Dragonfly
QUEUES=(1)
THREADS=(1)

for threads in "${THREADS[@]}"; do
  echo "=== Dragonfly avec $threads thread(s) ==="
  
  # Stopper l'instance précédente
  docker stop dragonfly-bench 2>/dev/null
  
  # Lancer Dragonfly avec N threads
  docker run -d --rm --name dragonfly-bench \
    -p 6379:6379 \
    docker.dragonflydb.io/dragonflydb/dragonfly \
    --proactor_threads=$threads \
    --cluster_mode=emulated \
    --lock_on_hashtags
  
  sleep 3  # Attendre le démarrage
  
  for q in "${QUEUES[@]}"; do
    echo "--- $q queue(s), $threads thread(s) ---"
    
    # Utiliser l'outil de benchmark BullMQ officiel
    bun index.ts -r 8 -w 8 -c 1 -d 10
  done
done