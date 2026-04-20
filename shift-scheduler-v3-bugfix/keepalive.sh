#!/bin/bash
cd /home/z/my-project
while true; do
  NODE_OPTIONS="--max-old-space-size=2048" ./node_modules/.bin/next dev -p 3000 2>&1 &
  PID=$!
  echo "Started next dev with PID $PID"
  # Wait for process to die
  wait $PID 2>/dev/null
  echo "Process died, restarting in 3s..."
  sleep 3
  rm -rf .next
done
