#!/bin/bash
set -e

rm -rf dist && mkdir -p dist

esbuild src/index.js \
  --bundle \
  --minify \
  --sourcemap \
  --format=esm \
  --outfile=dist/restinpieces.js


# The typescript npm package ships two things: the TypeScript compiler (tsc)
# and the type checker. You don't have to write .ts files to use it — tsc can
# read plain .js files and extract type information purely from JSDoc
# annotations, then emit .d.ts declaration files.  A .d.ts file contains only
# types, no code. It's what TypeScript users (and IDEs) read to get
# autocomplete and type checking when they import your SDK.
# Your actual runtime code stays as the esbuild-bundled dist/restinpieces.js.
#
# tsconfig.json ← tells tsc how to read your JS
tsc

echo "✓ built dist/restinpieces.js"
