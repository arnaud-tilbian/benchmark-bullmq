#!/bin/bash

# Benchmark avec différentes configs Dragonfly
QUEUES=(1)
THREADS=(1)

for threads in "${THREADS[@]}"; do
  echo "=== Dragonfly avec $threads thread(s) ==="
  
  # Stopper l'instance précédente
  docker stop mongo-bench 2>/dev/null
  
  # Lancer Dragonfly avec N threads
  docker run -d --rm --name mongo-bench \
    -p 27018:27017 \
    mongo:latest \
    --dbpath /data/db
  
  sleep 3  # Attendre le démarrage
  
  for q in "${QUEUES[@]}"; do
    echo "--- $q queue(s), $threads thread(s) ---"
    
    # Utiliser l'outil de benchmark BullMQ officiel
    bun index-agenda.ts -r 1 -w 1 -c 1 -d 10
  done
done