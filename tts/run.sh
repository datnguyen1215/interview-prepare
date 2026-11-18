#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -x "$dir/.venv/bin/python" ]; then
	uv venv --quiet --python 3.12 "$dir/.venv"
	uv pip install --quiet --python "$dir/.venv" -r "$dir/requirements.txt"
fi
# Model and voices download here on first start, so the folder is self-contained.
export HF_HOME="$dir/models"
exec "$dir/.venv/bin/python" "$dir/server.py"
