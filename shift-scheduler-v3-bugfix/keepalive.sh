#!/bin/bash
while true; do
  cd /home/z/my-project
  NODE_OPTIONS="--max-old-space-size=4096" bun run dev 2>&1 | tee -a /home/z/my-project/dev.log
  echo "=== Server died, restarting in 3s ===" >> /home/z/my-project/dev.log
  sleep 3
  rm -rf /home/z/my-project/.next
done
