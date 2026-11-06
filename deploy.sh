#!/usr/bin/env bash
# Test, then stamp a new build id into sw.js and index.html so installed
# phones pick up the new code. serve.py reads straight from this folder, so
# the tailnet copy is live at once.
#
#   ./deploy.sh                    stamp only
#   ./deploy.sh --push "message"   also commit and push (GitHub Pages republishes)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

for f in js/*.js sw.js; do node --check "$f"; done
node test/gen.test.js 4 15 | tail -1

BUILD="$(date -u +%Y%m%d-%H%M%S)"
sed -i -E "s/^const BUILD = '[^']*';/const BUILD = '$BUILD';/" sw.js
sed -i -E "s/(name=\"ew-build\" content=\")[^\"]*\"/\1$BUILD\"/" index.html
grep -q "$BUILD" sw.js && grep -q "$BUILD" index.html || { echo "stamp failed" >&2; exit 1; }
VER=$(grep -o "version: '[0-9.]*'" js/changelog.js | head -1 | cut -d"'" -f2)
echo "version $VER, build $BUILD"

if [ "${1:-}" = "--push" ]; then
  git add -A
  git commit -q -m "${2:-Deploy $BUILD}"
  git pull -q --rebase origin main && git push -q origin main
  echo "pushed"
fi
