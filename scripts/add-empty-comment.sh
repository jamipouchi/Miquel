#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <path>"
  exit 1
fi

path=$1

echo '{"comments":[]}' | \
wrangler r2 object put comments/${path}.json \
  --pipe \
  --remote \
  --content-type "application/json" \
  --cache-control "public, max-age=60, must-revalidate"

echo "✅ Created comments/${path}.json in R2"
