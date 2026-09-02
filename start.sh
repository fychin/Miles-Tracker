#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d ".venv" ]; then
  echo "Creating virtual environment…"
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt
echo ""
echo "  Miles & Points Tracker"
echo "  Open: http://localhost:3000"
echo "  Ctrl+C to stop."
echo ""
python3 server.py
