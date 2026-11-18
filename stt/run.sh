#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
uv run --quiet "$dir/fetch-model.py" "$dir/models/nemotron"
cargo build --quiet --release --manifest-path "$dir/Cargo.toml"
exec "$dir/target/release/stt" "$dir/models/nemotron"
