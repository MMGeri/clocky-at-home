#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> Installing dependencies"
npm install --ignore-scripts
(cd server && npm install)   # no --ignore-scripts: better-sqlite3 needs to compile native bindings
(cd client && npm install --ignore-scripts)

echo "==> Building client"
(cd client && npm run build)

echo "==> Building server"
(cd server && npm run build)

echo ""
echo "Build complete. Run ./start.sh to launch the app."
