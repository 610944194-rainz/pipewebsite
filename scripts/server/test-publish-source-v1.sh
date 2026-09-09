#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUBLISHER="${ROOT}/scripts/server/publish-source.sh"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

APP_DIR="${TMP_ROOT}/app"
INBOX_DIR="${TMP_ROOT}/inbox/danish"
STATE_DIR="${TMP_ROOT}/state/publisher"
REMOTE_DIR="${TMP_ROOT}/origin.git"
mkdir -p "${APP_DIR}/data/products" "${APP_DIR}/data/generated/public-products" "${APP_DIR}/scripts" "$INBOX_DIR"

git init -q -b main "$APP_DIR"
git -C "$APP_DIR" config user.name "Publisher fixture"
git -C "$APP_DIR" config user.email "publisher-fixture@example.invalid"
printf '[{"id":"1001","sourceProductId":"1001","source":"The Danish Pipe Shop"}]\n' > "${APP_DIR}/data/products/danish-products.json"
printf '[]\n' > "${APP_DIR}/data/products/unified-products-staging.json"
printf '{"products":[]}\n' > "${APP_DIR}/data/generated/public-products/catalog.json"
printf 'process.exit(process.env.PUBLISHER_FIXTURE_FAIL_STAGE === "unified" ? 1 : 0);\n' > "${APP_DIR}/scripts/build-unified-products-staging-v1.mjs"
printf 'process.exit(process.env.PUBLISHER_FIXTURE_FAIL_STAGE === "public" ? 1 : 0);\n' > "${APP_DIR}/scripts/build-public-product-indexes-v1.mjs"
printf 'process.exit(process.env.PUBLISHER_FIXTURE_FAIL_STAGE === "validator" ? 1 : 0);\n' > "${APP_DIR}/scripts/validate-public-product-indexes-v1.mjs"
git -C "$APP_DIR" add -- data scripts
git -C "$APP_DIR" commit -qm "fixture baseline"
git init -q --bare "$REMOTE_DIR"
git -C "$APP_DIR" remote add origin "$REMOTE_DIR"
git -C "$APP_DIR" push -qu origin main

BIN_DIR="${TMP_ROOT}/bin"
mkdir -p "$BIN_DIR"
cat > "${BIN_DIR}/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
cat > "${BIN_DIR}/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "${BIN_DIR}/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "${BIN_DIR}/sudo" "${BIN_DIR}/systemctl" "${BIN_DIR}/flock"

write_inbox() {
  local product_name="${1:-fixture update}"
  cat > "${INBOX_DIR}/publish.json" <<'EOF'
{"source":"danish","runId":"fixture-run","createdAt":"2026-09-09T00:00:00.000Z","productCount":1,"allowPublish":true}
EOF
  printf '[{"id":"1001","sourceProductId":"1001","source":"The Danish Pipe Shop","name":"%s"}]\n' "$product_name" > "${INBOX_DIR}/danish-products.json"
}

run_publisher() {
  PUBLISHER_APP_DIR="$APP_DIR" \
  PUBLISHER_INBOX_DIR="$INBOX_DIR" \
  PUBLISHER_STATE_DIR="$STATE_DIR" \
  PUBLISHER_BACKUP_DIR="${STATE_DIR}/backups/danish" \
  DANISH_PUBLISH_MIN_PRODUCT_COUNT=1 \
  PUBLISHER_SUDO_BIN="${BIN_DIR}/sudo" \
  PUBLISHER_SYSTEMCTL_BIN="${BIN_DIR}/systemctl" \
  PATH="${BIN_DIR}:$PATH" \
  "$PUBLISHER" danish
}

# Success clears the inbox and leaves the production checkout tracked-clean.
write_inbox
run_publisher
grep -q 'fixture update' "${APP_DIR}/data/products/danish-products.json"
test ! -e "${INBOX_DIR}/publish.json"
test ! -e "${INBOX_DIR}/danish-products.json"
test -z "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)"

# A rebuild failure rolls the tracked checkout back, retains inbox files for retry,
# and does not create a second remote commit.
write_inbox "fixture failed update"
before_head="$(git -C "$APP_DIR" rev-parse HEAD)"
if PUBLISHER_FIXTURE_FAIL_STAGE=unified run_publisher; then
  echo "expected rebuild failure" >&2
  exit 1
fi
test "$(git -C "$APP_DIR" rev-parse HEAD)" = "$before_head"
! grep -q 'fixture failed update' "${APP_DIR}/data/products/danish-products.json"
test -f "${INBOX_DIR}/publish.json"
test -f "${INBOX_DIR}/danish-products.json"
test -z "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)"

echo "Danish server publisher V1 fixture tests passed."
