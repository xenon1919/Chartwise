#!/bin/bash
# Runs the analytics engine and the gateway side by side; if either exits, the
# container exits so the orchestrator can restart it.
set -euo pipefail

cd /app/engine
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --no-access-log &
ENGINE_PID=$!

# Wait for the engine before accepting traffic
for _ in $(seq 1 60); do
  if python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=2)" 2>/dev/null; then
    break
  fi
  sleep 1
done

cd /app/server
node src/index.js &
SERVER_PID=$!

trap 'kill -TERM $ENGINE_PID $SERVER_PID 2>/dev/null' TERM INT
wait -n $ENGINE_PID $SERVER_PID
EXIT_CODE=$?
kill -TERM $ENGINE_PID $SERVER_PID 2>/dev/null || true
exit $EXIT_CODE
