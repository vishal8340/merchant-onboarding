#!/bin/sh
cd /Users/Vishal_Kumar1/bfsi-hackthon-2026/merchant-onboarding/backend
nohup npx ts-node src/server.ts > /tmp/backend.log 2>&1 &
echo "Backend started with PID=$!"
