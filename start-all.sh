#!/bin/zsh
setopt NO_BANG_HIST
set -e

WORKSPACE=/Users/Vishal_Kumar1/bfsi-hackthon-2026/merchant-onboarding
JAVA25=$(/usr/libexec/java_home -v 25)
JAVA25_BIN=$JAVA25/bin/java

echo "=== Starting all merchant-onboarding services ==="
echo ""

# ── 0. RabbitMQ (port 5672) ──────────────────────────────────────────────────
echo "[0/4] Starting RabbitMQ (port 5672)..."
# Only start if not already running
if nc -z localhost 5672 2>/dev/null; then
  echo "      RabbitMQ already running — skipping"
else
  # Ensure standard port config is in place
  RABBIT_CONF=/opt/homebrew/etc/rabbitmq/rabbitmq.conf
  if ! grep -q 'listeners.tcp.default = 5672' "$RABBIT_CONF" 2>/dev/null; then
    echo 'listeners.tcp.default = 5672' > "$RABBIT_CONF"
    echo 'management.tcp.port = 15672'  >> "$RABBIT_CONF"
    echo "      Updated RabbitMQ config to use standard port 5672"
  fi
  RABBITMQ_LOG_BASE=/opt/homebrew/var/log/rabbitmq \
  RABBITMQ_MNESIA_BASE=/opt/homebrew/var/lib/rabbitmq/mnesia \
  RABBITMQ_CONFIG_FILE="$RABBIT_CONF" \
    /opt/homebrew/sbin/rabbitmq-server -detached 2>/tmp/rabbitmq-start.log
  echo "      RabbitMQ starting (takes ~40s)  |  logs: /opt/homebrew/var/log/rabbitmq/"
  # Wait up to 60s for AMQP port to open
  for i in $(seq 1 12); do
    sleep 5
    if nc -z localhost 5672 2>/dev/null; then
      echo "      RabbitMQ UP on port 5672"
      # Ensure admin user exists
      rabbitmqctl add_user admin admin123 2>/dev/null || true
      rabbitmqctl set_user_tags admin administrator 2>/dev/null || true
      rabbitmqctl set_permissions -p / admin '.*' '.*' '.*' 2>/dev/null || true
      echo "      admin user provisioned"
      break
    fi
    echo "      Still waiting for RabbitMQ... ($((i*5))s)"
  done
fi

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
nc -z localhost 5672 2>/dev/null && echo "RabbitMQ:           UP (port 5672)" || echo "RabbitMQ:           STARTING (check /opt/homebrew/var/log/rabbitmq/)"
curl -sf "http://localhost:8091/api/v1/onboarding/test-onboarding?type=TEST" 2>/dev/null && echo "mcc-analyser:       UP" || echo "mcc-analyser:       STARTING (check /tmp/mcc-analyser.log)"
curl -sf http://localhost:8080/api/risk/health 2>/dev/null && echo "smart-risk-scoring: UP" || echo "smart-risk-scoring: STARTING (check /tmp/smart-risk-scoring.log)"
curl -sf http://localhost:3001/health        2>/dev/null && echo "backend:            UP" || echo "backend:            STARTING (check /tmp/backend.log)"
echo ""
echo "PIDs saved to /tmp/merchant-pids.txt"
echo "$MCC_PID $RISK_PID $BACKEND_PID $FRONTEND_PID" > /tmp/merchant-pids.txt
curl -sf http://localhost:3001/health 2>/dev/null | grep -o '"eventBus":"[^"]*"' | sed 's/"eventBus"://; s/"//g' | xargs -I{} echo "RabbitMQ eventBus: {}" || true
echo ""
echo "Frontend  → http://localhost:3000"
echo "Backend   → http://localhost:3001"
echo "Risk API  → http://localhost:8080"
echo "MCC API   → http://localhost:8091"
echo "RabbitMQ  → amqp://localhost:5672  |  UI: http://localhost:15672"
echo ""
echo "=== Backend live log (Ctrl+C to detach) ==="
tail -f /tmp/backend.log
