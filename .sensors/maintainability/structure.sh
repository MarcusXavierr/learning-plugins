#!/bin/sh
# Ports-and-adapters layering check over the source roots that exist so far.
roots=""
for dir in build shared plugins test-support; do
  [ -d "$dir" ] && roots="$roots $dir"
done
if [ -z "$roots" ]; then
  echo "no source roots yet"
  exit 0
fi
# shellcheck disable=SC2086 # word splitting of $roots is intended
exec npx --no-install depcruise --config .sensors/maintainability/dependency-cruiser.cjs --output-type err-long $roots
