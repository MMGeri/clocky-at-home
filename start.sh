#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SESSION="ftx-clockify"

# Load .env so we can print the port in the startup message
if [[ -f "$ROOT/.env" ]]; then
  # Export vars, ignoring blank lines and comments
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^\s*#' "$ROOT/.env" | grep -v '^\s*$')
  set +a
fi

PORT="${PORT:-3001}"
NODE_ENV="${NODE_ENV:-production}"

if ! command -v tmux &>/dev/null; then
  echo "Error: tmux is not installed. Install it with: sudo apt install tmux"
  exit 1
fi

if [[ ! -f "$ROOT/server/dist/index.js" ]]; then
  echo "Error: server/dist/index.js not found. Run ./deploy.sh first."
  exit 1
fi

if [[ ! -d "$ROOT/client/dist" ]]; then
  echo "Error: client/dist/ not found. Run ./deploy.sh first."
  exit 1
fi

# Kill existing session if running
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "==> Stopping existing session '$SESSION'"
  tmux kill-session -t "$SESSION"
fi

echo "==> Starting $SESSION (NODE_ENV=$NODE_ENV PORT=$PORT)"
tmux new-session -d -s "$SESSION" -x 220 -y 50 \
  "cd '$ROOT' && node server/dist/index.js; read -p 'Press Enter to close…'"

echo ""
echo "App is running in tmux session '$SESSION'."
echo "  Attach : tmux attach -t $SESSION"
echo "  Stop   : tmux kill-session -t $SESSION"
echo "  Logs   : tmux attach -t $SESSION  (then Ctrl+B D to detach)"
echo ""
echo "Listening on http://localhost:$PORT"
