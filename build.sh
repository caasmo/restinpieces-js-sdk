#!/bin/bash
set -e

rm -rf dist && mkdir -p dist

esbuild src/index.js \
  --bundle \
  --minify \
  --sourcemap \
  --format=esm \
  --outfile=dist/restinpieces.js

echo "✓ built dist/restinpieces.js"
