#!/bin/bash
# Launches the MCP server against a dedicated, hidden Chrome instance.
#
# A separate Chrome (own profile, port 9223) is started headful — Coupang's
# bot protection serves "Access Denied" to headless Chrome, and this project
# deliberately does not evade bot detection — and its window is then hidden
# via System Events, so nothing appears on screen. Your everyday Chrome is
# untouched.
#
# For checkout/login, run: scripts/show-chrome.sh (unhides the window).
set -euo pipefail

PORT="${COUPANG_CDP_PORT:-9223}"
PROFILE="$HOME/.coupang-chrome/profile"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$HOME/.coupang-chrome"

if ! curl -sf "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
  "$CHROME" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check \
    --window-size=1280,900 \
    about:blank > "$HOME/.coupang-chrome/chrome.log" 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf "http://localhost:$PORT/json/version" > /dev/null 2>&1 && break
    sleep 0.5
  done
fi

CHROME_PID=$(pgrep -f "remote-debugging-port=$PORT" | head -1 || true)

# macOS un-hides an app whenever it opens a new window, and every tool call
# opens a tab — so hide once now and keep re-hiding while the server runs.
# show-chrome.sh pauses this by creating the marker file below.
if [ -n "$CHROME_PID" ]; then
  (
    while kill -0 "$CHROME_PID" 2>/dev/null; do
      if [ ! -f "$HOME/.coupang-chrome/keep-visible" ]; then
        osascript -e "tell application \"System Events\" to set visible of (first process whose unix id is $CHROME_PID) to false" 2>/dev/null || true
      fi
      sleep 2
    done
  ) &
  WATCHER_PID=$!
  trap 'kill $WATCHER_PID 2>/dev/null' EXIT
fi

# Playwright's connectOverCDP needs at least one page target; a hidden Chrome
# can end up with zero, which makes context lookup fail.
if [ "$(curl -sf "http://localhost:$PORT/json/list" | grep -c '"type": "page"')" = "0" ]; then
  curl -sf -X PUT "http://localhost:$PORT/json/new?about:blank" > /dev/null || true
fi

export COUPANG_CDP_URL="http://localhost:$PORT"
exec node "$(dirname "$0")/../dist/index.js"
