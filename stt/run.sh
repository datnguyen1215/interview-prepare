#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
nv="$dir/.venv/lib/python3.12/site-packages/nvidia"
export LD_LIBRARY_PATH="$nv/cublas/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$dir/.venv/bin/python" "$dir/server.py"
