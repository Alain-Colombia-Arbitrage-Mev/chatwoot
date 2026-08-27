from __future__ import annotations

import base64
import hashlib
import hmac

import pytest
from fastapi.testclient import TestClient

from voice_agent.config import get_settings
from voice_agent.gateway import app, public_ws_url
from voice_agent.security import verify_twilio_signature, verify_whatsapp_signature


def setup_function() -> None:
    get_settings.cache_clear()


def test_public_ws_url_requires_runner_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_REQUIRE_RUNNER_WS_TOKEN", "true")
    settings = get_settings()

    with pytest.raises(RuntimeError, match="pipecat_ws_token_missing"):
        public_ws_url("ws://mindbliss-voice-pipecat:9111/ws", settings)


def test_public_ws_url_maps_tokenized_runner_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_TWILIO_WS_PUBLIC_URL", "wss://soporte.mindblisspower.com/voice/twilio/ws")
    settings = get_settings()

    url = public_ws_url("ws://mindbliss-voice-pipecat:9111/ws/signed-token", settings)

    assert url == "wss://soporte.mindblisspower.com/voice/twilio/ws/signed-token"


def test_twilio_signature_validation() -> None:
    public_url = "https://soporte.mindblisspower.com/voice/twilio/inbound"
    params = {"CallSid": "CA123", "From": "+573001112233"}
    payload = public_url + "CallSidCA123From+573001112233"
    signature = base64.b64encode(hmac.new(b"secret", payload.encode(), hashlib.sha1).digest()).decode()

    assert verify_twilio_signature(
        public_url=public_url,
        params=params,
        signature=signature,
        auth_token="secret",
    )


def test_whatsapp_signature_validation() -> None:
    raw = b'{"object":"whatsapp_business_account"}'
    digest = hmac.new(b"app-secret", raw, hashlib.sha256).hexdigest()

    assert verify_whatsapp_signature(
        raw_body=raw,
        signature=f"sha256={digest}",
        app_secret="app-secret",
    )


def test_healthz(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_WEBHOOK_TOKEN", "test")
    client = TestClient(app)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_whatsapp_verify(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WHATSAPP_WEBHOOK_VERIFICATION_TOKEN", "verify-token")
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.get(
        "/voice/whatsapp",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "verify-token",
            "hub.challenge": "abc123",
        },
    )

    assert response.status_code == 200
    assert response.text == "abc123"
