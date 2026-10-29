#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v zip &>/dev/null; then
  echo "Error: zip is not installed. Install it with: sudo apt install zip"
  exit 1
fi

ARCHIVE_NAME="ftx-clockify.zip"

echo "==> Creating $ARCHIVE_NAME"
zip -r "$ARCHIVE_NAME" . \
  --exclude "*/node_modules/*" \
  --exclude "./node_modules/*" \
  --exclude "./.git/*" \
  --exclude "./.env" \
  --exclude "./data/*" \
  --exclude "./*.zip" \
  --exclude "*.DS_Store"

SIZE="$(du -sh "$ARCHIVE_NAME" | cut -f1)"
echo ""
echo "Package ready: $ARCHIVE_NAME ($SIZE)"
echo ""
echo "Deploy on server:"
echo "  unzip $ARCHIVE_NAME -d ftx-clockify"
echo "  cd ftx-clockify"
echo "  cp .env.example .env && \$EDITOR .env   # set PORT, CORS_ORIGIN, NODE_ENV=production"
echo "  ./deploy.sh && ./start.sh"
