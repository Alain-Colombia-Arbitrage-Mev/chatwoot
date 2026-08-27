from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from .config import Settings, get_settings
from .security import verify_static_token, verify_twilio_signature, verify_whatsapp_signature
from .twiml import connect_stream_twiml, reject_twiml

app = FastAPI(title="Mindbliss Voice Gateway", version="0.1.0")

E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "mindbliss-voice-gateway"}


@app.get("/readyz")
async def readyz() -> JSONResponse:
    settings = get_settings()
    runner = await runner_status(settings)
    status = "ok" if runner.get("status") in {"ready", "ok", "running", "healthy"} else "degraded"
    return JSONResponse(
        {
            "status": status,
            "targets": settings.safe_targets(),
            "twilio": {
                "configured": settings.twilio_ready,
                "phone_dial_ready": settings.phone_dial_ready,
                "whatsapp_twilio_ready": settings.whatsapp_twilio_ready,
            },
            "whatsapp_cloud": {
                "enabled": settings.whatsapp_calls_enabled,
                "configured": settings.whatsapp_cloud_ready,
            },
            "ai": {
                "openrouter_configured": settings.ai_ready,
                "llm_model": settings.voice_llm_model,
                "stt_model": settings.voice_stt_model,
                "tts_model": settings.voice_tts_model,
            },
            "pipecat": runner,
        },
        status_code=200 if status == "ok" else 503,
    )


@app.api_route("/voice/twilio/inbound", methods=["GET", "POST"])
async def twilio_inbound(request: Request) -> Response:
    settings = get_settings()
    params = await request_params(request)
    await require_twilio_or_static_token(request, params, settings)

    channel = "whatsapp" if _is_whatsapp_endpoint(params.get("From"), params.get("To")) else "phone"
    try:
        ws_url = await create_pipecat_ws_url(
            settings,
            {
                "channel": channel,
                "direction": "inbound",
                "from": params.get("From", ""),
                "to": params.get("To", ""),
                "call_sid": params.get("CallSid", ""),
            },
        )
    except Exception:
        return xml_response(reject_twiml("Soporte Mindbliss no puede tomar la llamada en este momento."))

    return xml_response(
        connect_stream_twiml(
            ws_url,
            {
                "channel": channel,
                "direction": "inbound",
                "call_sid": params.get("CallSid", ""),
            },
        )
    )


@app.post("/voice/twilio/dial")
async def twilio_dial(request: Request) -> JSONResponse:
    settings = get_settings()
    require_admin(request, settings)
    body = await request.json()
    channel = str(body.get("channel") or "phone").lower()
    to_number = normalize_phone(body.get("to"))
    if channel not in {"phone", "whatsapp"}:
        raise HTTPException(status_code=400, detail="invalid_channel")
    if channel == "whatsapp" and body.get("consent") is not True:
        raise HTTPException(status_code=400, detail="whatsapp_call_requires_prior_consent")

    if channel == "phone":
        from_number = settings.twilio_from_number
        to_value = to_number
        if not settings.phone_dial_ready:
            raise HTTPException(status_code=503, detail="twilio_phone_not_configured")
    else:
        from_number = settings.twilio_whatsapp_sender
        to_value = f"whatsapp:{to_number}"
        if not settings.whatsapp_twilio_ready:
            raise HTTPException(status_code=503, detail="twilio_whatsapp_not_configured")

    ws_url = await create_pipecat_ws_url(
        settings,
        {
            "channel": channel,
            "direction": "outbound",
            "to": to_number,
            "reason": str(body.get("reason") or "support")[:120],
        },
    )
    twiml = connect_stream_twiml(ws_url, {"channel": channel, "direction": "outbound"})
    result = await create_twilio_call(settings, to_value=to_value, from_value=from_number, twiml=twiml)
    return JSONResponse({"status": "queued", "sid": result.get("sid"), "channel": channel})


@app.get("/voice/whatsapp")
async def whatsapp_verify(request: Request) -> PlainTextResponse:
    settings = get_settings()
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge", "")
    if mode == "subscribe" and verify_static_token(token, settings.whatsapp_webhook_verification_token):
        return PlainTextResponse(challenge)
    raise HTTPException(status_code=403, detail="invalid_whatsapp_verify_token")


@app.post("/voice/whatsapp")
async def whatsapp_webhook(request: Request) -> JSONResponse:
    settings = get_settings()
    raw_body = await request.body()
    signature = request.headers.get("x-hub-signature-256")
    if settings.whatsapp_app_secret and not verify_whatsapp_signature(
        raw_body=raw_body, signature=signature, app_secret=settings.whatsapp_app_secret
    ):
        raise HTTPException(status_code=403, detail="invalid_whatsapp_signature")
    if not settings.whatsapp_cloud_ready:
        return JSONResponse({"status": "disabled", "reason": "whatsapp_cloud_not_configured"}, 503)

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{settings.pipecat_runner_url}/whatsapp",
            content=raw_body,
            headers=_forward_headers(request),
        )
    return JSONResponse(_json_or_status(response), status_code=response.status_code)


async def request_params(request: Request) -> dict[str, str]:
    if request.method == "GET":
        return dict(request.query_params)
    raw = await request.body()
    parsed = parse_qs(raw.decode("utf-8"), keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


async def require_twilio_or_static_token(
    request: Request, params: dict[str, str], settings: Settings
) -> None:
    public_url = f"{settings.public_base_url}{request.url.path}"
    if request.url.query:
        public_url = f"{public_url}?{request.url.query}"
    signature = request.headers.get("x-twilio-signature")
    signed_params = params if request.method == "POST" else {}
    if verify_twilio_signature(
        public_url=public_url,
        params=signed_params,
        signature=signature,
        auth_token=settings.twilio_auth_token,
    ):
        return

    provided = request.query_params.get("token") or request.headers.get("x-mindbliss-voice-token")
    if verify_static_token(provided, settings.webhook_token):
        return

    raise HTTPException(status_code=403, detail="invalid_voice_webhook_token")


def require_admin(request: Request, settings: Settings) -> None:
    auth = request.headers.get("authorization", "")
    bearer = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    provided = bearer or request.headers.get("x-mindbliss-voice-token")
    if not verify_static_token(provided, settings.admin_token):
        raise HTTPException(status_code=401, detail="invalid_voice_admin_token")


async def create_pipecat_ws_url(settings: Settings, body: dict[str, Any]) -> str:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{settings.pipecat_runner_url}/start",
            json={"transport": "twilio", "body": body},
        )
    if response.status_code >= 400:
        raise RuntimeError("pipecat_start_failed")
    data = response.json()
    raw_ws_url = data.get("wsUrl") or data.get("ws_url")
    if not raw_ws_url:
        raise RuntimeError("pipecat_ws_missing")
    raw_ws_url = attach_runner_token(raw_ws_url, data.get("token"))
    return public_ws_url(raw_ws_url, settings)


def attach_runner_token(raw_ws_url: str, token: Any) -> str:
    if not token:
        return raw_ws_url
    parsed = urlsplit(raw_ws_url)
    if parsed.path.rstrip("/") == "/ws" and not parsed.query:
        return f"{raw_ws_url.rstrip('/')}/{token}"
    return raw_ws_url


def public_ws_url(raw_ws_url: str, settings: Settings) -> str:
    parsed = urlsplit(raw_ws_url)
    suffix = parsed.path
    if suffix == "/ws":
        suffix = ""
    elif suffix.startswith("/ws/"):
        suffix = suffix[3:]
    elif suffix.startswith("/ws"):
        suffix = suffix[3:]
    else:
        suffix = ""

    if settings.require_runner_ws_token and not suffix and not parsed.query:
        raise RuntimeError("pipecat_ws_token_missing")

    url = settings.twilio_ws_public_url.rstrip("/") + suffix
    if parsed.query:
        url = f"{url}?{parsed.query}"
    return url


async def create_twilio_call(
    settings: Settings, *, to_value: str, from_value: str, twiml: str
) -> dict[str, Any]:
    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Calls.json"
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            url,
            data={"To": to_value, "From": from_value, "Twiml": twiml},
            auth=(settings.twilio_account_sid, settings.twilio_auth_token),
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="twilio_call_create_failed")
    return response.json()


async def runner_status(settings: Settings) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{settings.pipecat_runner_url}/status")
        if response.status_code >= 400:
            return {"status": "error", "http_status": response.status_code}
        return response.json()
    except Exception:
        return {"status": "error"}


def normalize_phone(value: Any) -> str:
    raw = str(value or "").strip()
    if not E164_RE.match(raw):
        raise HTTPException(status_code=400, detail="invalid_e164_phone")
    return raw


def xml_response(xml: str) -> Response:
    return Response(content=xml, media_type="application/xml")


def _is_whatsapp_endpoint(*values: str | None) -> bool:
    return any(str(value or "").lower().startswith("whatsapp:") for value in values)


def _forward_headers(request: Request) -> dict[str, str]:
    allowed = {"content-type", "x-hub-signature-256", "user-agent"}
    return {key: value for key, value in request.headers.items() if key.lower() in allowed}


def _json_or_status(response: httpx.Response) -> dict[str, Any]:
    try:
        return response.json()
    except ValueError:
        return {"status": "proxied", "http_status": response.status_code}
