#!/usr/bin/env sh
# Build and publish this package to npm and the vlt registry.
#   sh scripts/publish.sh            publish
#   sh scripts/publish.sh --dry-run  show what would be published
set -eu
cd "$(dirname "$0")/.."
dry=""
[ "${1:-}" = "--dry-run" ] && dry="--dry-run"
node scripts/build.mjs
echo "== npm: dist"
( cd dist && npm publish --access public $dry )
echo "== vlt: dist"
( cd dist && vlt registry main publish $dry )
