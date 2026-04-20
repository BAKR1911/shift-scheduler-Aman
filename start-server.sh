#!/bin/bash
cd /home/z/my-project
while true; do
  rm -rf .next 2>/dev/null
  NODE_OPTIONS="--max-old-space-size=4096" node --max-old-space-size=4096 node_modules/.bin/next dev -p 3000 2>&1 | tee dev.log
  echo "[keepalive] Server died, restarting in 3s..."
  sleep 3
done
