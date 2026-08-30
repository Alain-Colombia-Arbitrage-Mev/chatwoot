# Mindbliss Chatwoot upgrade flow

Use this flow to keep Chatwoot current without losing the Mindbliss support CRM
board, escalation controls and AI support agent integration.

## Update the fork

1. Check the latest upstream Chatwoot release and review release notes.
2. Merge the release tag into the Mindbliss branch.
3. Run focused tests for the customized surface.
4. Push the branch before production deployment.

```bash
git fetch upstream --tags
git merge --no-ff v4.17.1 -m "Merge Chatwoot v4.17.1"
pnpm exec eslint app/javascript/dashboard/components/ChatList.vue \
  app/javascript/dashboard/components/SupportTicketBoard.vue \
  app/javascript/dashboard/store/modules/conversations/actions.js \
  app/javascript/dashboard/api/inbox/conversation.js
pnpm vitest run \
  app/javascript/dashboard/api/specs/inbox/conversation.spec.js \
  app/javascript/dashboard/store/modules/specs/conversations/actions.spec.js
cd mindbliss-support-agent && npm test
git push origin feature/support-ticket-routing-board
```

## Production build layout

Build Chatwoot from a clean Git worktree, separate from `/opt/chatwoot/source`.
The production directory contains runtime `.env` files and compose overlays, so
do not reset or overwrite it during upgrades.

Recommended EC2 layout:

```text
/opt/chatwoot/source                         # production compose/env directory
/opt/chatwoot/builds/chatwoot-mindbliss      # clean Git worktree for builds
```

The production override is versioned as `docker-compose.support-crm.override.yaml`
and points `rails` and `sidekiq` to the custom image. The upgrade script rewrites
that override with the exact image tag it built.

By default the script uses `docker/mindbliss-chatwoot.Dockerfile`, which starts
from the official `chatwoot/chatwoot:v<VERSION_CW>` image, copies the Mindbliss
CRM frontend files and recompiles assets. This keeps upstream runtime layers
current without rebuilding every native gem on the EC2 for each minor release.

## Deploy

From the clean build worktree on the EC2:

```bash
SOURCE_DIR=/opt/chatwoot/builds/chatwoot-mindbliss \
DEPLOY_DIR=/opt/chatwoot/source \
deployment/mindbliss_chatwoot_upgrade.sh
```

On small EC2 instances, Vite can be killed by the kernel during production asset
builds. Run the script as root with temporary build swap enabled:

```bash
sudo env SOURCE_DIR=/opt/chatwoot/builds/chatwoot-mindbliss \
  DEPLOY_DIR=/opt/chatwoot/source \
  MINDBLISS_BUILD_SWAP_MB=4096 \
  bash /opt/chatwoot/builds/chatwoot-mindbliss/deployment/mindbliss_chatwoot_upgrade.sh
```

The script:

1. Refuses to build if the source worktree has uncommitted changes.
2. Optionally creates temporary swap when `MINDBLISS_BUILD_SWAP_MB` is set.
3. Builds a production image from `docker/mindbliss-chatwoot.Dockerfile`.
4. Tags it as `chatwoot-support-crm:v<VERSION_CW>-<git-sha>`.
5. Writes `/opt/chatwoot/source/docker-compose.support-crm.override.yaml`.
6. Runs `bundle exec rails db:chatwoot_prepare`.
7. Restarts `rails` and `sidekiq`.

## Verify

```bash
curl -fsS -I http://127.0.0.1:3000/app/login
docker compose -f docker-compose.production.yaml \
  -f docker-compose.mindbliss-support.yaml \
  -f docker-compose.support-crm.override.yaml ps rails sidekiq
docker compose -f docker-compose.production.yaml \
  -f docker-compose.mindbliss-support.yaml \
  -f docker-compose.support-crm.override.yaml exec rails cat /app/.git_sha
curl -fsS http://127.0.0.1:9108/healthz
```

Keep `CHATWOOT_AI_PUBLIC_REPLIES=false` until support agents finish manual QA
for each model/provider change.

For a full source build instead of the overlay build, pass:

```bash
DOCKERFILE=docker/Dockerfile deployment/mindbliss_chatwoot_upgrade.sh
```

## GitHub Actions deploy

The `Mindbliss Chatwoot Deploy` workflow can run the same production deploy from
GitHub Actions. It deploys manually via `workflow_dispatch`, and also on pushes
to `develop` when Chatwoot frontend, Docker overlay or deployment files change.

Configure these repository secrets before using it:

```text
MINDBLISS_EC2_HOST=34.197.213.11
MINDBLISS_EC2_USER=ubuntu
MINDBLISS_EC2_SSH_KEY=<private SSH key with access to the EC2>
```

Optionally configure this repository variable:

```text
MINDBLISS_DEPLOY_HEALTH_URL=https://soporte.mindblisspower.com/api
```

The workflow fetches the selected branch in
`/opt/chatwoot/builds/chatwoot-mindbliss`, runs
`deployment/mindbliss_chatwoot_upgrade.sh` with temporary swap, then verifies
the `/api` health response.
