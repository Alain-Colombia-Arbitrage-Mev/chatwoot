# Company support operations

## Isolation contract

- A Chatwoot Account is a company boundary, not a department. Create separate
  accounts for separate companies, with their own users, teams, inboxes and portal.
- Invite support staff with AccountUser role `agent` and ordinary User type.
  Never grant SuperAdmin to support agents. Invitees must accept their own email
  invitation and set their password; do not bypass confirmation.
- Add only agents belonging to the inbox account. Inbox member create/update
  endpoints reject foreign users, and inbox create/update rejects foreign portals.
- A team's agents and a conversation's assignee must belong to its account.
  Escalation emails select confirmed responsible agents from the same account.
- The login page is shared. Email conversation URLs contain the account ID and
  conversation display ID. The login redirect preserves that destination only
  when the authenticated user has active membership in the target account.
  Plain agent login opens the company's support ticket board.
- Public widget tokens identify their own inbox. Link a portal only to a widget
  and inboxes belonging to that company. Do not reuse widgets between companies.
- Configure a sender and receipt route for each company. Never reuse Mindbliss
  SMTP credentials for another sender: the IAM policy restricts the From address.

## Mindbliss deployment

Current company account: 2. Chat inbox: 2. API ticket inbox: 1. Email inbox: 3.
Portal: 1 (`mindbliss`), published Spanish FAQ at
`https://soporte.mindblisspower.com/hc/mindbliss/es`.
The support and sales teams remain separate within this company. The email inbox
is staffed by the support team. Existing pending cases must not be deleted.

Account 3 (`agent2`) was empty during the audit. It must remain unprovisioned until
its business identity, support domain and authorized agents are supplied.

### Outbound mail

- Sender: `Mindbliss Power <soporte@mindblisspower.com>`.
- SES SMTP: `email-smtp.us-east-1.amazonaws.com`, port 587, LOGIN and STARTTLS,
  peer certificate verification enabled.
- Credentials: AWS Secrets Manager `vicionpower/prod/chatwoot-smtp`, never Git.
- Runtime file: `/opt/chatwoot/source/.env`, root-owned, mode 0600.
- Delivery events: SES configuration set `entregas`, CloudWatch log group
  `/aws/lambda/mbp-ses-event-logger`. Delivery means acceptance by the recipient
  mail server, not that the agent has read the message or accepted the invitation.
- Assignment email preferences must be enabled per user and account. Escalation
  notifications require confirmed agents; invitations must be accepted first.

### Inbound mail

Set these variables in the runtime environment for both Rails and Sidekiq:

```dotenv
RAILS_INBOUND_EMAIL_SERVICE=ses
ACTION_MAILBOX_SES_SNS_TOPIC=arn:aws:sns:us-east-1:522814703714:chatwoot-support-inbound
MAILER_INBOUND_EMAIL_DOMAIN=reply.mindblisspower.com
AWS_REGION=us-east-1
```

- Account support_email: `Mindbliss Power <soporte@mindblisspower.com>`.
- Account domain: `reply.mindblisspower.com`.
- SES receipt set: `INBOUND_MAIL`; rule: `chatwoot-mindbliss-support`.
- Exact recipient scopes: `soporte@mindblisspower.com` and the dedicated
  `reply.mindblisspower.com` subdomain. The rule precedes the Mindbliss WorkMail
  rule and stops only matching receipts. Preserve all unrelated WorkMail rules.
- S3 raw mail bucket: `mindbliss-chatwoot-inbound-522814703714`, prefix `mindbliss/`.
  Public access blocked, server-side encryption, TLS required, 14-day raw-mail
  retention. Chatwoot stores processed content separately.
- SNS HTTPS endpoint:
  `https://soporte.mindblisspower.com/rails/action_mailbox/ses/inbound_emails`.
  Confirm the subscription before enabling the SES receipt rule. Use the native
  signed SES/SNS integration; do not disable signature or topic validation.
- Instance role policy `ChatwootSupportIngressRead` permits only raw object reads
  under this prefix and subscription confirmation on this topic.
- MX for `reply.mindblisspower.com` points to
  `10 inbound-smtp.us-east-1.amazonaws.com`.

## Release and acceptance checks

1. Run focused AuthHelper and route Vitest specs and controller isolation specs.
2. Keep custom files in `docker/mindbliss-chatwoot.Dockerfile`; edits to source
   alone do not modify the upstream base image. Deploy the tracked branch using
   `Mindbliss Chatwoot Deploy`, and verify `/api` reports healthy data and queues.
3. Verify another company's inbox access is denied, foreign members receive 422,
   and foreign FAQ assignments receive 404 without changing existing records.
4. Open a conversation email link while logged out. After login, confirm it opens
   the same company's conversation. A foreign account link must never grant access.
5. Confirm invitation delivery, then have agents accept the invitation themselves.
   Test an assignment or escalation with a confirmed responsible agent and inspect
   delivery events. Do not report invitations as proof of assignment delivery.
6. Send a clearly marked technical email to the support address. Verify the
   resulting conversation belongs only to that company's email inbox. Resolve the
   synthetic test case after checking it; leave real pending conversations intact.
7. Verify FAQ articles and chat render together in the public help center.

For an inbound rollback, disable only `chatwoot-mindbliss-support` in SES. Preserve
the previous runtime environment backup and all WorkMail rules. Never delete real
conversations or raw mail as part of a deployment rollback.
