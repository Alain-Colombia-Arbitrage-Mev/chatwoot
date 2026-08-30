#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/chatwoot/source}"
DOCKERFILE="${DOCKERFILE:-docker/Dockerfile}"
COMPOSE_PROJECT_DIR="${COMPOSE_PROJECT_DIR:-$DEPLOY_DIR}"
CHATWOOT_VERSION="${CHATWOOT_VERSION:-$(tr -d '[:space:]' < "$SOURCE_DIR/VERSION_CW")}"
SHORT_SHA="$(git -C "$SOURCE_DIR" rev-parse --short=12 HEAD)"
IMAGE_TAG="${MINDBLISS_CHATWOOT_IMAGE:-chatwoot-support-crm:v${CHATWOOT_VERSION}-${SHORT_SHA}}"
OVERRIDE_FILE="${OVERRIDE_FILE:-$DEPLOY_DIR/docker-compose.support-crm.override.yaml}"

COMPOSE_FILES=(
  -f docker-compose.production.yaml
)
if [[ -f "$DEPLOY_DIR/docker-compose.mindbliss-support.yaml" ]]; then
  COMPOSE_FILES+=(-f docker-compose.mindbliss-support.yaml)
fi
COMPOSE_FILES+=(-f docker-compose.support-crm.override.yaml)

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  echo "SOURCE_DIR must be a Git worktree: $SOURCE_DIR" >&2
  exit 1
fi

if ! git -C "$SOURCE_DIR" diff --quiet || ! git -C "$SOURCE_DIR" diff --cached --quiet; then
  echo "SOURCE_DIR has uncommitted changes. Commit or stash before building a production image." >&2
  exit 1
fi

echo "Building $IMAGE_TAG from $SOURCE_DIR ($SHORT_SHA)"
docker build -f "$SOURCE_DIR/$DOCKERFILE" -t "$IMAGE_TAG" "$SOURCE_DIR"

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

echo "Restarting Chatwoot Rails and Sidekiq with $IMAGE_TAG"
(
  cd "$COMPOSE_PROJECT_DIR"
  docker compose "${COMPOSE_FILES[@]}" up -d rails sidekiq
)

echo "Deployed $IMAGE_TAG"
