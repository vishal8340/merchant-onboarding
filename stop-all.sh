#!/bin/zsh
setopt NO_BANG_HIST

echo "=== Stopping all merchant-onboarding services ==="
echo ""

# ── [0/4] RabbitMQ ───────────────────────────────────────────────────────────
echo "[0/4] Stopping RabbitMQ..."
rabbitmqctl stop 2>/dev/null && echo "      RabbitMQ stopped" || echo "      RabbitMQ was not running"

# ── Try saved PIDs first ──────────────────────────────────────────────────────
if [[ -f /tmp/merchant-pids.txt ]]; then
  read MCC_PID RISK_PID BACKEND_PID FRONTEND_PID < /tmp/merchant-pids.txt
  echo "Found saved PIDs: mcc=$MCC_PID  risk=$RISK_PID  backend=$BACKEND_PID  frontend=$FRONTEND_PID"
  for PID in $MCC_PID $RISK_PID $BACKEND_PID $FRONTEND_PID; do
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
      kill -9 "$PID" && echo "  Killed PID $PID"
    fi
  done
  rm -f /tmp/merchant-pids.txt
else
  echo "No PID file found — falling back to port-based kill..."
fi

echo ""

# ── [1/4] mcc-analyser (port 8091) ───────────────────────────────────────────
echo "[1/4] Stopping mcc-analyser (port 8091)..."
PIDS=$(lsof -ti tcp:8091) && echo "      Killing PIDs: $PIDS" && echo $PIDS | xargs kill -9 2>/dev/null || echo "      Nothing running on port 8091"

# ── [2/4] smart-risk-scoring (port 8080) ─────────────────────────────────────
echo "[2/4] Stopping smart-risk-scoring (port 8080)..."
PIDS=$(lsof -ti tcp:8080) && echo "      Killing PIDs: $PIDS" && echo $PIDS | xargs kill -9 2>/dev/null || echo "      Nothing running on port 8080"

# ── [3/4] Node.js backend (port 3001) ────────────────────────────────────────
echo "[3/4] Stopping Node.js backend (port 3001)..."
PIDS=$(lsof -ti tcp:3001) && echo "      Killing PIDs: $PIDS" && echo $PIDS | xargs kill -9 2>/dev/null || echo "      Nothing running on port 3001"

# ── [4/4] React frontend (port 3000) ─────────────────────────────────────────
echo "[4/4] Stopping React frontend (port 3000)..."
PIDS=$(lsof -ti tcp:3000) && echo "      Killing PIDs: $PIDS" && echo $PIDS | xargs kill -9 2>/dev/null || echo "      Nothing running on port 3000"

echo ""
echo "=== All services stopped ==="
