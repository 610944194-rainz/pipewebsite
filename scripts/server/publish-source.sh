#!/usr/bin/env bash
set -euo pipefail

# Server-side publisher for source-specific inbox files.  Keep this script in the
# repository; deploy it to /srv/yandoubuy/bin/publish-source.sh with executable
# permissions.  It intentionally supports Danish only in V1.

SOURCE="${1:-}"
if [[ "$SOURCE" != "danish" ]]; then
  echo "publish-source: only 'danish' is supported in V1" >&2
  exit 64
fi

APP_DIR="${PUBLISHER_APP_DIR:-/srv/yandoubuy/app}"
INBOX_DIR="${PUBLISHER_INBOX_DIR:-/srv/yandoubuy/inbox/danish}"
STATE_DIR="${PUBLISHER_STATE_DIR:-/srv/yandoubuy/state/publisher}"
LOCK_PATH="${PUBLISHER_LOCK_PATH:-${STATE_DIR}/production-publish.lock}"
BACKUP_DIR="${PUBLISHER_BACKUP_DIR:-${STATE_DIR}/backups/danish}"
LOCK_WAIT_SECONDS="${PUBLISHER_LOCK_WAIT_SECONDS:-300}"
MIN_PRODUCT_COUNT="${DANISH_PUBLISH_MIN_PRODUCT_COUNT:-1000}"
NODE_BIN="${NODE_BIN:-node}"
SUDO_BIN="${PUBLISHER_SUDO_BIN:-sudo}"
SYSTEMCTL_BIN="${PUBLISHER_SYSTEMCTL_BIN:-systemctl}"
PRODUCT_PATH="${APP_DIR}/data/products/danish-products.json"
PUBLISH_PATH="${INBOX_DIR}/publish.json"
INBOX_PRODUCT_PATH="${INBOX_DIR}/danish-products.json"

base_head=""
rollback_required=0
published=0

rollback_if_needed() {
  local exit_code=$?
  if [[ "$exit_code" -ne 0 && "$rollback_required" -eq 1 && -n "$base_head" ]]; then
    echo "publish-source: rolling back Danish publication to ${base_head}" >&2
    set +e
    git -C "$APP_DIR" reset --hard "$base_head"
    local reset_code=$?
    local dirty
    dirty="$(git -C "$APP_DIR" status --porcelain --untracked-files=no)"
    set -e
    if [[ "$reset_code" -ne 0 || -n "$dirty" ]]; then
      echo "publish-source: rollback-failed reset=${reset_code} trackedDirty=${dirty:+true}" >&2
    fi
  fi
  exit "$exit_code"
}
trap rollback_if_needed EXIT

mkdir -p "$(dirname "$LOCK_PATH")" "$BACKUP_DIR"
exec 9>"$LOCK_PATH"
if ! flock -w "$LOCK_WAIT_SECONDS" 9; then
  echo "publish-source: retryable publisher-lock-timeout after ${LOCK_WAIT_SECONDS}s" >&2
  exit 75
fi

require_tracked_clean() {
  local dirty
  dirty="$(git -C "$APP_DIR" status --porcelain --untracked-files=no)"
  if [[ -n "$dirty" ]]; then
    echo "publish-source: tracked-worktree-dirty" >&2
    printf '%s\n' "$dirty" >&2
    exit 70
  fi
}

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "publish-source: production repository missing: $APP_DIR" >&2
  exit 70
fi
if [[ ! -f "$PUBLISH_PATH" || ! -f "$INBOX_PRODUCT_PATH" ]]; then
  echo "publish-source: Danish inbox files missing" >&2
  exit 66
fi

require_tracked_clean
git -C "$APP_DIR" fetch origin
git -C "$APP_DIR" pull --ff-only origin main
require_tracked_clean
base_head="$(git -C "$APP_DIR" rev-parse HEAD)"
upstream_head="$(git -C "$APP_DIR" rev-parse origin/main)"
if [[ "$base_head" != "$upstream_head" ]]; then
  echo "publish-source: production HEAD must equal origin/main after ff-only sync" >&2
  exit 70
fi

"$NODE_BIN" - "$PUBLISH_PATH" "$INBOX_PRODUCT_PATH" "$PRODUCT_PATH" "$MIN_PRODUCT_COUNT" <<'NODE'
const fs = require("node:fs");
const [publishPath, candidatePath, currentPath, minimumRaw] = process.argv.slice(2);
const fail = (message) => { console.error(`publish-source validation: ${message}`); process.exit(1); };
const compact = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
let publish;
let candidate;
try {
  publish = JSON.parse(fs.readFileSync(publishPath, "utf8"));
  candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
} catch (error) {
  fail(`invalid-json ${error.message}`);
}
if (publish?.source !== "danish") fail("publish.source must be danish");
if (publish?.allowPublish !== true) fail("publish.allowPublish must be true");
if (!compact(publish?.runId)) fail("publish.runId missing");
if (!Array.isArray(candidate) || candidate.length === 0) fail("candidate products missing");
if (!Number.isInteger(publish?.productCount) || publish.productCount !== candidate.length) fail("productCount mismatch");
const ids = candidate.map((product) => compact(product?.sourceProductId || product?.id).replace(/^danish-/i, ""));
if (ids.some((id) => !/^\d+$/.test(id) || Number(id) < 1)) fail("invalid Danish stable ID");
if (new Set(ids).size !== ids.length) fail("duplicate Danish stable ID");
if (candidate.some((product) => !/\bdanish\b/i.test(compact(product?.source)))) fail("non-Danish candidate product");
if (ids.includes("32447")) fail("BPK 32447 must remain excluded");
if (candidate.some((product) => /^(falcon)(\b| |,|-)/i.test(compact(product?.brand?.name || product?.brand)) || /^(falcon)(\b| |,|-)/i.test(compact(product?.displayName || product?.name)))) {
  fail("Falcon must remain excluded");
}
const minimum = Math.max(1, Number(minimumRaw) || 1);
let existingCount = 0;
try {
  const existing = JSON.parse(fs.readFileSync(currentPath, "utf8"));
  existingCount = Array.isArray(existing) ? existing.length : Array.isArray(existing?.products) ? existing.products.length : 0;
} catch {}
const collapseFloor = existingCount > 0 ? Math.floor(existingCount * 0.65) : 0;
if (candidate.length < Math.max(minimum, collapseFloor)) {
  fail(`candidate-count-too-low count=${candidate.length} minimum=${minimum} collapseFloor=${collapseFloor}`);
}
NODE
RUN_ID="$("$NODE_BIN" -pe 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).runId' "$PUBLISH_PATH")"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
if [[ -f "$PRODUCT_PATH" ]]; then
  cp -p "$PRODUCT_PATH" "$BACKUP_DIR/danish-products.${timestamp}.json"
fi

candidate_tmp="${PRODUCT_PATH}.${SOURCE}.$$.tmp"
cp "$INBOX_PRODUCT_PATH" "$candidate_tmp"
"$NODE_BIN" -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$candidate_tmp"
mv "$candidate_tmp" "$PRODUCT_PATH"
rollback_required=1

(
  cd "$APP_DIR"
  "$NODE_BIN" scripts/build-unified-products-staging-v1.mjs
  "$NODE_BIN" scripts/build-public-product-indexes-v1.mjs
  "$NODE_BIN" scripts/validate-public-product-indexes-v1.mjs
  git diff --check
)

if git -C "$APP_DIR" diff --quiet -- data/products/danish-products.json data/products/unified-products-staging.json data/generated/public-products; then
  require_tracked_clean
  rm -f "$INBOX_PRODUCT_PATH" "$PUBLISH_PATH"
  rollback_required=0
  echo "publish-source: Danish no-op"
  exit 0
fi

git -C "$APP_DIR" add -- data/products/danish-products.json data/products/unified-products-staging.json data/generated/public-products
if git -C "$APP_DIR" diff --cached --quiet; then
  require_tracked_clean
  rm -f "$INBOX_PRODUCT_PATH" "$PUBLISH_PATH"
  rollback_required=0
  echo "publish-source: Danish no-op"
  exit 0
fi
git -C "$APP_DIR" commit -m "chore(inventory): publish Danish daily ${RUN_ID}"
git -C "$APP_DIR" push origin main
published=1
rollback_required=0

restart_service() {
  "$SUDO_BIN" "$SYSTEMCTL_BIN" restart yandoubuy.service && "$SYSTEMCTL_BIN" is-active --quiet yandoubuy.service
}
if ! restart_service; then
  if ! restart_service; then
    echo "publish-source: published-but-restart-failed" >&2
    exit 71
  fi
fi

rm -f "$INBOX_PRODUCT_PATH" "$PUBLISH_PATH"
require_tracked_clean
echo "publish-source: Danish published runId=${RUN_ID}"
