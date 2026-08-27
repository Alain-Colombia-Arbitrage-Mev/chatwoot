# Mindbliss Voice Agent

Self-hosted Pipecat voice bridge for the support EC2.

## Public routes

Configure nginx on `soporte.mindblisspower.com` to proxy:

```nginx
location /voice/ {
  access_log off;
  proxy_pass http://127.0.0.1:9110;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /voice/twilio/ws {
  access_log off;
  rewrite ^/voice/twilio/ws(.*)$ /ws$1 break;
  proxy_pass http://127.0.0.1:9111;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
}
```

Use this Twilio Voice webhook URL for inbound phone calls:

```text
https://soporte.mindblisspower.com/voice/twilio/inbound?token=<VOICE_WEBHOOK_TOKEN>
```

For Twilio WhatsApp Business Calling, set the sender Voice Request URL to the same endpoint.
For Meta WhatsApp Cloud API Calling, set the callback URL to:

```text
https://soporte.mindblisspower.com/voice/whatsapp
```

## Runtime

The gateway asks the private Pipecat runner for a one-time WebSocket URL and returns TwiML
with `wss://soporte.mindblisspower.com/voice/twilio/ws/...`. The runner is configured with
`PIPECAT_WEBSOCKET_AUTH=token`; do not expose runner `/start` publicly.

Voice answers go through the private Mindbliss support brain at
`VP_SUPPORT_AI_URL=/api/support/chat`, so calls use the same Qdrant, FalkorDB and reranker
memory path as Chatwoot support. The voice filter only answers support topics.

## Health

```bash
curl -fsS http://127.0.0.1:9110/healthz
curl -fsS http://127.0.0.1:9110/readyz
curl -fsS http://127.0.0.1:9111/status
```

`/readyz` redacts secrets and reports whether Twilio, WhatsApp, OpenRouter, Qdrant and
FalkorDB URLs are configured.
