#!/bin/bash
# Deploy the Apple Royale page (static site) to S3 + CloudFront.
# Bucket + distribution are provisioned by the drawvidverse CDK stack
# (appleroyale.drawvid.com). Usage: ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="appleroyale-drawvid-frontend-${ACCOUNT}"

echo "==> Target bucket: s3://${BUCKET}"

# Assets aren't content-hashed: serve with revalidation (cheap 304s via ETag).
echo "==> Syncing assets (no-cache, ETag-revalidated)"
aws s3 sync assets "s3://${BUCKET}/assets" --delete --cache-control "no-cache" --exclude "*.glb"

# GLBs gzip to about half and S3 serves them as octet-stream, which
# CloudFront won't compress: upload them pre-gzipped (-n: stable bytes/ETag).
echo "==> Uploading GLBs (gzipped)"
find assets -name "*.glb" | while read -r f; do
  gzip -9nc "$f" | aws s3 cp - "s3://${BUCKET}/$f" --only-show-errors \
    --content-encoding gzip --content-type model/gltf-binary --cache-control "no-cache"
done

# The engine, straight from node_modules (the page loads it from there too):
# big and very compressible, so it goes up brotli-compressed, at about a
# fifth of the size.
echo "==> Uploading the engine (brotli)"
command -v brotli >/dev/null || { echo "!! brotli not found: brew install brotli" >&2; exit 1; }
npm install --silent # node_modules matches package-lock.json
for f in node_modules/babylonjs/babylon.js node_modules/babylonjs-loaders/babylonjs.loaders.min.js \
  node_modules/@babylonjs/havok/lib/umd/HavokPhysics_umd.js node_modules/@babylonjs/havok/lib/umd/HavokPhysics.wasm; do
  case "$f" in *.wasm) type=application/wasm ;; *) type=application/javascript ;; esac
  brotli -q 11 -c "$f" | aws s3 cp - "s3://${BUCKET}/$f" --only-show-errors \
    --content-encoding br --content-type "$type" --cache-control "no-cache"
done

# The page and its scripts: no-cache, so a release shows up on the next load.
echo "==> Uploading page + scripts (no-cache)"
for f in index.html royale.js core.js net.js bots.js sliceBurst.js game.js game2.js; do
  aws s3 cp "$f" "s3://${BUCKET}/$f" --only-show-errors --cache-control "no-cache"
done

# Discover the distribution by its alias so no id needs hardcoding.
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, 'appleroyale.drawvid.com')].Id | [0]" \
  --output text)
if [ -n "$DIST_ID" ] && [ "$DIST_ID" != "None" ]; then
  echo "==> Invalidating CloudFront ${DIST_ID}"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null
else
  echo "!! No CloudFront distribution for appleroyale.drawvid.com found — run the CDK deploy first."
fi

echo "==> Done: https://appleroyale.drawvid.com"
