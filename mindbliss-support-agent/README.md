# Mindbliss Support Agent

Bridge between Chatwoot and the Mindbliss support brain.

Flow:

1. Chatwoot sends a signed `message_created` webhook from the dedicated AgentBot.
2. This bridge verifies `X-Chatwoot-Signature`.
3. Non-support or private/outgoing messages are ignored.
4. Support messages are enriched with Qdrant + FalkorDB + OpenRouter rerank memory.
5. The bridge adds labels, priority and a private note for the human support team.
6. If enabled, it stores redacted vector memory in Qdrant and relation memory in FalkorDB.

Public replies are disabled by default. Use `CHATWOOT_AI_PUBLIC_REPLIES=true` only after QA.

## Local test

```bash
cd mindbliss-support-agent
npm test
```

## Support EC2 deploy shape

Run the bridge only on the support EC2:

```bash
docker compose -f docker-compose.production.yaml -f docker-compose.mindbliss-support.yaml up -d mindbliss-support-agent
```

The compose overlay joins Chatwoot's default network and the support-only `ai-memory_default`
network. On soporte, Qdrant, FalkorDB, `vp-support` and `vp-kb-indexer` live in `/opt/ai-memory`;
the bridge reaches them as `http://qdrant:6333`, `redis://falkordb:6379` and
`http://vp-support:9096` inside that private Docker network.

Check runtime wiring:

```bash
curl -fsS http://127.0.0.1:9108/healthz
curl -fsS http://127.0.0.1:9108/readyz
```

`/readyz?external=1` also calls the configured reranker provider. Use it manually because it
can consume paid OpenRouter/Cohere requests.

Provision the AgentBot inside the Chatwoot Rails container:

```bash
MINDBLISS_AGENT_ACCOUNT_ID=2 \
MINDBLISS_AGENT_INBOX_IDS=all \
bundle exec rails runner deployment/mindbliss_support_agent_setup.rb
```

## Import existing conversations

Backfill historical support conversations into Qdrant and FalkorDB from the support EC2:

```bash
docker compose -f docker-compose.production.yaml -f docker-compose.mindbliss-support.yaml exec \
  mindbliss-support-agent node src/importConversations.js \
  --account-id 1 \
  --status all \
  --max-conversations 500
```

The importer skips private notes by default and stores only chunks classified as support
requests. To run a small dry run first:

```bash
docker compose -f docker-compose.production.yaml -f docker-compose.mindbliss-support.yaml exec \
  mindbliss-support-agent node src/importConversations.js \
  --account-id 1 \
  --max-conversations 10 \
  --dry-run
```

The same importer is exposed over localhost for controlled operations:

```bash
curl -fsS -X POST http://127.0.0.1:9108/memory/import \
  -H "Authorization: Bearer $MEMORY_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"account_id":1,"status":"all","max_conversations":100}'
```
