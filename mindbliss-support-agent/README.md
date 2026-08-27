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
the bridge reaches them as `http://mindbrain-qdrant:6333`,
`redis://:<FALKORDB_PASSWORD>@mindbrain-falkordb:6379` and
`http://mindbrain-vp-support:9096` inside that private Docker network.

Chatwoot's own `REDIS_URL` is separate and should stay pointed at Chatwoot Redis
(`redis:6379`) for Rails/Sidekiq. Do not reuse it for FalkorDB memory; FalkorDB
only shares the Redis wire protocol.

Preferred production URLs:

```env
VP_SUPPORT_AI_URL=http://mindbrain-vp-support:9096
QDRANT_URL=http://mindbrain-qdrant:6333
FALKORDB_URL=redis://:<FALKORDB_PASSWORD>@mindbrain-falkordb:6379
OPENROUTER_RERANK_URL=https://openrouter.ai/api/v1/rerank
SUPPORT_RERANK_MODEL=cohere/rerank-4-pro
```

Keep Qdrant and FalkorDB bound to localhost/private Docker networks. Use an SSH
tunnel for dashboards and debugging instead of exposing database ports publicly.

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

## Ticket operations

The bridge also exposes a localhost-only ticket API backed by Chatwoot
conversations. Protect it with `SUPPORT_TICKET_TOKEN`; set
`SUPPORT_TICKET_ACCOUNT_ID=2` and optionally `SUPPORT_TICKET_INBOX_ID` for the
default inbox used when creating tickets.

List tickets:

```bash
curl -fsS 'http://127.0.0.1:9108/tickets?status=open&account_id=2' \
  -H "Authorization: Bearer $SUPPORT_TICKET_TOKEN"

curl -fsS 'http://127.0.0.1:9108/tickets?status=closed&account_id=2' \
  -H "Authorization: Bearer $SUPPORT_TICKET_TOKEN"
```

List routing targets:

```bash
curl -fsS 'http://127.0.0.1:9108/tickets/agents?account_id=2' \
  -H "Authorization: Bearer $SUPPORT_TICKET_TOKEN"

curl -fsS 'http://127.0.0.1:9108/tickets/teams?account_id=2' \
  -H "Authorization: Bearer $SUPPORT_TICKET_TOKEN"

curl -fsS 'http://127.0.0.1:9108/tickets/inboxes?account_id=2' \
  -H "Authorization: Bearer $SUPPORT_TICKET_TOKEN"
```

Create a ticket and route it to a responsible agent. Assignment uses Chatwoot's
native notification settings, including email notifications when enabled for the
agent:

```bash
curl -fsS -X POST http://127.0.0.1:9108/tickets \
  -H "Authorization: Bearer $SUPPORT_TICKET_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": 2,
    "inbox_id": 1,
    "email": "cliente@example.com",
    "name": "Cliente",
    "subject": "OTP no llega",
    "content": "El usuario no puede validar el codigo OTP.",
    "category": "auth",
    "priority": "high",
    "assignee_email": "agente@example.com"
  }'
```

Close or escalate an existing ticket:

```bash
curl -fsS -X POST http://127.0.0.1:9108/tickets/123/close \
  -H "Authorization: Bearer $SUPPORT_TICKET_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"account_id":2,"note":"Validado y resuelto."}'

curl -fsS -X POST http://127.0.0.1:9108/tickets/123/escalate \
  -H "Authorization: Bearer $SUPPORT_TICKET_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"account_id":2,"priority":"urgent","assignee_email":"lider@example.com","note":"Requiere revision manual."}'
```

## Import existing conversations

Backfill historical support conversations into Qdrant and FalkorDB from the support EC2:

```bash
docker compose -f docker-compose.production.yaml -f docker-compose.mindbliss-support.yaml exec \
  mindbliss-support-agent node src/importConversations.js \
  --account-id 2 \
  --status all \
  --max-conversations 500
```

The importer skips private notes by default and stores only chunks classified as support
requests. To run a small dry run first:

```bash
docker compose -f docker-compose.production.yaml -f docker-compose.mindbliss-support.yaml exec \
  mindbliss-support-agent node src/importConversations.js \
  --account-id 2 \
  --max-conversations 10 \
  --dry-run
```

The same importer is exposed over localhost for controlled operations:

```bash
curl -fsS -X POST http://127.0.0.1:9108/memory/import \
  -H "Authorization: Bearer $MEMORY_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"account_id":2,"status":"all","max_conversations":100}'
```

## Add documentation from Chatwoot

Agents can add support knowledge without opening Qdrant/FalkorDB directly. In any
Chatwoot conversation, create a private note that starts with `#kb`, `#memoria`
or `/kb`:

```text
#kb OTP por SMS
Categoria: auth
Tags: otp, telefono
Pregunta: El usuario no recibe el codigo OTP por correo.
Respuesta: Validar el telefono del usuario y usar reenvio por SMS cuando el correo falle.
```

The bridge stores the note as account-level knowledge in Qdrant and FalkorDB,
adds labels to the conversation, and replies with a private confirmation note
containing `MB-KB-ID`. Public customer messages are never created by this flow.
