#!/bin/zsh
setopt NO_BANG_HIST
set -e

WORKSPACE=/Users/Vishal_Kumar1/bfsi-hackthon-2026/merchant-onboarding
JAVA25=$(/usr/libexec/java_home -v 25)
JAVA25_BIN=$JAVA25/bin/java

echo "=== Starting all merchant-onboarding services ==="
echo ""

# ── 1. mcc-analyser (port 8091) ──────────────────────────────────────────────
echo "[1/4] Starting mcc-analyser (port 8091)..."
API_KEY=dial-ftwcbhgzau3w9ogooz3rt9mmdho nohup $JAVA25_BIN \
  -jar $WORKSPACE/mcc-analyser/target/mcc-analyser-1.0.0-SNAPSHOT.jar \
  > /tmp/mcc-analyser.log 2>&1 &
MCC_PID=$!
echo "      mcc-analyser PID=$MCC_PID  |  logs: /tmp/mcc-analyser.log"

# ── 2. smart-risk-scoring (port 8080) ────────────────────────────────────────
echo "[2/4] Starting smart-risk-scoring (port 8080)..."
(cd $WORKSPACE/smart-risk-scoring && nohup $JAVA25_BIN \
  -jar target/smart-risk-scoring-1.0.0.jar \
  --openai.api.key=dial-ftwcbhgzau3w9ogooz3rt9mmdho \
  > /tmp/smart-risk-scoring.log 2>&1) &
RISK_PID=$!
echo "      smart-risk-scoring PID=$RISK_PID  |  logs: /tmp/smart-risk-scoring.log"

# ── 3. backend Node.js (port 3001) ───────────────────────────────────────────
echo "[3/4] Starting Node.js backend (port 3001)..."
cd $WORKSPACE/backend
nohup npx ts-node src/server.ts \
  > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
echo "      backend PID=$BACKEND_PID  |  logs: /tmp/backend.log"

# ── 4. React frontend (port 3000) ────────────────────────────────────────────
echo "[4/4] Starting React frontend (port 3000)..."
cd $WORKSPACE/frontend
BROWSER=none nohup npm start \
  > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "      frontend PID=$FRONTEND_PID  |  logs: /tmp/frontend.log"

echo ""
echo "=== All services starting. Waiting 20s for health checks... ==="
sleep 20

echo ""
echo "=== Health Check ==="
curl -sf "http://localhost:8091/api/v1/onboarding/test-onboarding?type=TEST" 2>/dev/null && echo "mcc-analyser:      UP" || echo "mcc-analyser:      STARTING (check /tmp/mcc-analyser.log)"
curl -sf http://localhost:8080/api/risk/health 2>/dev/null && echo " smart-risk-scoring: UP" || echo "smart-risk-scoring: STARTING (check /tmp/smart-risk-scoring.log)"
curl -sf http://localhost:3001/health        2>/dev/null && echo "backend:            UP" || echo "backend:            STARTING (check /tmp/backend.log)"
echo ""
echo "PIDs saved to /tmp/merchant-pids.txt"
echo "$MCC_PID $RISK_PID $BACKEND_PID $FRONTEND_PID" > /tmp/merchant-pids.txt
echo ""
echo "Frontend → http://localhost:3000"
echo "Backend  → http://localhost:3001"
echo "Risk API → http://localhost:8080"
echo "MCC API  → http://localhost:8091"
