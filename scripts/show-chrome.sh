#!/bin/bash
# Unhides the dedicated Coupang Chrome window (for login or checkout).
set -euo pipefail
PORT="${COUPANG_CDP_PORT:-9223}"
PID=$(pgrep -f "remote-debugging-port=$PORT.*coupang-chrome" | head -1 || true)
if [ -z "$PID" ]; then
  echo "Dedicated Chrome (port $PORT) is not running." >&2
  exit 1
fi
# Pause the auto-hide watcher in run-mcp-hidden.sh, then unhide.
touch "$HOME/.coupang-chrome/keep-visible"
osascript -e "tell application \"System Events\" to set visible of (first process whose unix id is $PID) to true"
osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $PID) to true"
echo "창을 다시 숨기려면: rm ~/.coupang-chrome/keep-visible"
