#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tmp/vae-tool
if [ ! -f tmp/vae-tool/plugin/scripts/vae.py ]; then
  tar -xzf vendor/sources/defuss-vae-source.tgz -C tmp/vae-tool --strip-components=1
fi
exec python3 tmp/vae-tool/plugin/scripts/vae.py "$@" --repo .
