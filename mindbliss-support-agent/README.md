# Mindbliss Support Agent

Bridge between Chatwoot and the Mindbliss support brain.

Flow:

1. Chatwoot sends a signed `message_created` webhook from the dedicated AgentBot.
2. This bridge verifies `X-Chatwoot-Signature`.
3. Non-support or private/outgoing messages are ignored.
4. Support messages are sent to `vp-support`, which uses Qdrant + FalkorDB + OpenRouter rerank.
5. The bridge adds labels, priority and a private note for the human support team.
6. If enabled, it stores redacted vector memory in Qdrant and relation memory in FalkorDB.

Public replies are disabled by default. Use `CHATWOOT_AI_PUBLIC_REPLIES=true` only after QA.

## Local test

```bash
cd mindbliss-support-agent
npm test
```

## Support EC2 deploy shape

Run the service only on the support EC2:

```bash
docker compose -f docker-compose.production.yaml -f docker-compose.mindbliss-support.yaml up -d mindbliss-support-agent
```

Provision the AgentBot inside the Chatwoot Rails container:

```bash
MINDBLISS_AGENT_ACCOUNT_ID=2 \
MINDBLISS_AGENT_INBOX_IDS=all \
bundle exec rails runner deployment/mindbliss_support_agent_setup.rb
```
