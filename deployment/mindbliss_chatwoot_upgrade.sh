#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/chatwoot/source}"
DOCKERFILE="${DOCKERFILE:-docker/mindbliss-chatwoot.Dockerfile}"
COMPOSE_PROJECT_DIR="${COMPOSE_PROJECT_DIR:-$DEPLOY_DIR}"
CHATWOOT_VERSION="${CHATWOOT_VERSION:-$(tr -d '[:space:]' < "$SOURCE_DIR/VERSION_CW")}"
SHORT_SHA="$(git -C "$SOURCE_DIR" rev-parse --short=12 HEAD)"
IMAGE_TAG="${MINDBLISS_CHATWOOT_IMAGE:-chatwoot-support-crm:v${CHATWOOT_VERSION}-${SHORT_SHA}}"
OVERRIDE_FILE="${OVERRIDE_FILE:-$DEPLOY_DIR/docker-compose.support-crm.override.yaml}"
BUILD_SWAP_MB="${MINDBLISS_BUILD_SWAP_MB:-0}"
BUILD_SWAP_FILE="${MINDBLISS_BUILD_SWAP_FILE:-/tmp/mindbliss-chatwoot-build.swap}"

COMPOSE_FILES=(
  -f docker-compose.production.yaml
)
if [[ -f "$DEPLOY_DIR/docker-compose.mindbliss-support.yaml" ]]; then
  COMPOSE_FILES+=(-f docker-compose.mindbliss-support.yaml)
fi
COMPOSE_FILES+=(-f docker-compose.support-crm.override.yaml)
CAPTAIN_FEATURES=(
  captain_integration
  captain_integration_v2
  captain_tasks
  custom_tools
)

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  echo "SOURCE_DIR must be a Git worktree: $SOURCE_DIR" >&2
  exit 1
fi

if ! git -C "$SOURCE_DIR" diff --quiet || ! git -C "$SOURCE_DIR" diff --cached --quiet; then
  echo "SOURCE_DIR has uncommitted changes. Commit or stash before building a production image." >&2
  exit 1
fi

cleanup_swap() {
  if [[ "${SWAP_CREATED:-0}" == "1" ]]; then
    swapoff "$BUILD_SWAP_FILE" >/dev/null 2>&1 || true
    rm -f "$BUILD_SWAP_FILE"
  fi
}
trap cleanup_swap EXIT

if [[ "$BUILD_SWAP_MB" =~ ^[0-9]+$ ]] && (( BUILD_SWAP_MB > 0 )); then
  if [[ "$(id -u)" != "0" ]]; then
    echo "MINDBLISS_BUILD_SWAP_MB requires running this script as root." >&2
    exit 1
  fi
  if ! swapon --show=NAME --noheadings | grep -Fxq "$BUILD_SWAP_FILE"; then
    echo "Creating temporary ${BUILD_SWAP_MB}MB build swap at $BUILD_SWAP_FILE"
    fallocate -l "${BUILD_SWAP_MB}M" "$BUILD_SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$BUILD_SWAP_FILE" bs=1M count="$BUILD_SWAP_MB"
    chmod 600 "$BUILD_SWAP_FILE"
    mkswap "$BUILD_SWAP_FILE" >/dev/null
    swapon "$BUILD_SWAP_FILE"
    SWAP_CREATED=1
  fi
fi

echo "Building $IMAGE_TAG from $SOURCE_DIR ($SHORT_SHA)"
docker build \
  --build-arg "CHATWOOT_VERSION=$CHATWOOT_VERSION" \
  --build-arg "BUILD_SHA=$SHORT_SHA" \
  -f "$SOURCE_DIR/$DOCKERFILE" \
  -t "$IMAGE_TAG" \
  "$SOURCE_DIR"

cat > "$OVERRIDE_FILE" <<YAML
services:
  rails:
    image: $IMAGE_TAG
  sidekiq:
    image: $IMAGE_TAG
YAML

echo "Running Chatwoot database preparation with $IMAGE_TAG"
(
  cd "$COMPOSE_PROJECT_DIR"
  docker compose "${COMPOSE_FILES[@]}" run --rm rails bundle exec rails db:chatwoot_prepare
)

echo "Enabling Mindbliss Captain account features"
(
  cd "$COMPOSE_PROJECT_DIR"
  captain_features="${CAPTAIN_FEATURES[*]}"
  docker compose "${COMPOSE_FILES[@]}" run --rm rails bundle exec rails runner \
    "Account.find_each { |account| account.enable_features!(*%w[$captain_features]) }"
)

echo "Enforcing Mindbliss web widget support intake form"
(
  cd "$COMPOSE_PROJECT_DIR"
  docker compose "${COMPOSE_FILES[@]}" run --rm rails bundle exec rails runner \
    "Channel::WebWidget.find_each { |widget| widget.update!(pre_chat_form_enabled: true, pre_chat_form_options: Mindbliss::SupportPreChat.mandatory_options(widget.pre_chat_form_options)) }"
)

echo "Restarting Chatwoot Rails and Sidekiq with $IMAGE_TAG"
(
  cd "$COMPOSE_PROJECT_DIR"
  docker compose "${COMPOSE_FILES[@]}" up -d rails sidekiq
)

echo "Deployed $IMAGE_TAG"
