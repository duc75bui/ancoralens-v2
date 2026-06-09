#!/usr/bin/env bash
# AncoraLens — start the unified server (serves UI + API on one port)
set -e
cd "$(dirname "$0")"
if [ ! -d server/node_modules ]; then
  echo "Installing server dependencies..."
  ( cd server && npm ci --omit=dev )
fi
export PORT="${PORT:-8080}"
echo "Starting AncoraLens on port $PORT ..."
exec node server/index.js
