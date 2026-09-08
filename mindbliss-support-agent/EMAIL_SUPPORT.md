# Email support agent

Incoming email still uses Chatwoot's native SES ingress and Email inbox. The agent
does not read another mailbox or change MX records. Replies are native outgoing
messages, delivered through the company's Email channel, not a separate mail API.

## Enable one company

1. Configure the Email inbox and its sender/SMTP first. Verify incoming mail and
   sender-domain ownership. Add support agents to that company's inbox and team.
2. Attach the existing webhook AgentBot to the Email inbox. Its webhook secret
   must match the bridge; never expose tokens in source or command output.
3. In `/opt/chatwoot/source/.env.mindbliss-support-agent`, add an explicit route:

```dotenv
EMAIL_SUPPORT_ROUTES='[{"accountId":2,"inboxId":3,"teamId":1,"botId":1,"companyName":"Mindbliss Power"}]'
EMAIL_SUPPORT_MIN_RELEVANCE=0.7
```

4. Restart the support-agent container using the production Compose files. This
   setting is independent of `CHATWOOT_AI_PUBLIC_REPLIES`; website chat behavior
   remains unchanged. `/healthz` reports the enabled email inbox count.
5. Verify a synthetic incoming email becomes an open case assigned to a confirmed
   support agent. Confirm the reply in Chatwoot and the recipient mail server's
   delivery event. Preserve real pending conversations.

Use a separate route, team, bot and verified sender for another company. An inbox
not explicitly listed receives no automatic email response from this bridge.

## Response policy

- One automated public reply per conversation. Later messages remain for humans.
- If a human has already replied, the bot does not interrupt. The state is checked
  again after retrieval/model execution, including newer incoming messages.
- Auto replies, missing native email metadata, no-reply senders and marketing
  messages do not receive bot replies. Private notes never become public replies.
- Identity, account changes, blocked access, financial and other sensitive cases
  receive a fixed acknowledgement, never a claimed operational resolution.
- Qdrant and FalkorDB retrieve only account-scoped approved knowledge for email.
  The reranker is mandatory, even with one candidate. A relevance failure or an
  unavailable service falls back to the acknowledgement.
- Solar Pro 4 selects a document ID. Its generated prose is never sent. The reply
  contains the approved source text with a fixed receipt and handoff footer.
- Messages are attributed to the configured AgentBot. The human owner is selected
  from confirmed team members with role `agent`, preferring online members.
- Cases remain open, labeled `correo-recibido` and `pendiente-soporte`, with a
  private audit note and `email_support_human_review_required=true`.
- Email acknowledgements and closed email threads are not automatically promoted
  to approved knowledge. Agents can publish reviewed reusable solutions using the
  existing private `#kb` command. Never teach from an AI receipt or an unreviewed
  customer assertion.

## Knowledge and persistence

Approved sources are account-scoped `chatwoot_kb_note` documents and curated
`chatwoot_help_center` documents, plus their FalkorDB knowledge-node counterparts.
When curating published FAQ, store plain text and a stable document ID in the
existing MemoryStore. Do not import private customer transcripts as global FAQ.
Changes to published FAQ must also update the curated memory entry before the
agent can use the new content.

The bridge runs as one worker. It serializes each conversation and stores durable
message markers/custom attributes in Chatwoot. If a reply succeeds but the handoff
write fails, a retry completes the handoff without resending the email. Do not
scale this service to multiple independent replicas without a distributed claim.

To disable automation, remove the route and restart the bridge. Native inbox mail
reception and manual agent replies continue to work.
