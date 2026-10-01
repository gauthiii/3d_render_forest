#!/bin/bash
# Serves the forest over HTTP and opens it in the default browser.
cd "$(dirname "$0")/docs" || exit 1
PORT=8765
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  python3 -m http.server $PORT >/dev/null 2>&1 &
  sleep 1
fi
open "http://localhost:$PORT/"
echo "Forest running at http://localhost:$PORT/  (close this window to keep the server running in the background)"
