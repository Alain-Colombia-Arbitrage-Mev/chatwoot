from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlsplit


def _truthy(value: str | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _clean(value: str | None) -> str:
    return (value or "").strip().strip('"').strip("'")


@dataclass(frozen=True)
class Settings:
    env: str
    public_base_url: str
    gateway_port: int
    pipecat_runner_url: str
    twilio_ws_public_url: str
    require_runner_ws_token: bool
    webhook_token: str
    admin_token: str
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_from_number: str
    twilio_whatsapp_sender: str
    whatsapp_calls_enabled: bool
    whatsapp_token: str
    whatsapp_phone_number_id: str
    whatsapp_app_secret: str
    whatsapp_webhook_verification_token: str
    openrouter_api_key: str
    voice_llm_model: str
    voice_stt_model: str
    voice_tts_model: str
    voice_tts_voice: str
    voice_openai_compat_base_url: str
    voice_language: str
    qdrant_url: str
    falkordb_url: str
    vp_support_ai_url: str
    vp_support_ai_token: str

    @property
    def twilio_ready(self) -> bool:
        return bool(self.twilio_account_sid and self.twilio_auth_token)

    @property
    def phone_dial_ready(self) -> bool:
        return self.twilio_ready and bool(self.twilio_from_number)

    @property
    def whatsapp_twilio_ready(self) -> bool:
        return self.twilio_ready and bool(self.twilio_whatsapp_sender)

    @property
    def whatsapp_cloud_ready(self) -> bool:
        return bool(
            self.whatsapp_calls_enabled
            and self.whatsapp_token
            and self.whatsapp_phone_number_id
            and self.whatsapp_app_secret
            and self.whatsapp_webhook_verification_token
        )

    @property
    def ai_ready(self) -> bool:
        return bool(self.openrouter_api_key)

    def safe_targets(self) -> dict[str, str]:
        return {
            "public_base_url": _safe_url(self.public_base_url),
            "pipecat_runner_url": _safe_url(self.pipecat_runner_url),
            "twilio_ws_public_url": _safe_url(self.twilio_ws_public_url),
            "qdrant_url": _safe_url(self.qdrant_url),
            "falkordb_url": _safe_url(self.falkordb_url),
            "vp_support_ai_url": _safe_url(self.vp_support_ai_url),
            "openrouter_base_url": _safe_url(self.voice_openai_compat_base_url),
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    public_base_url = _clean(os.getenv("PUBLIC_BASE_URL")) or "https://soporte.mindblisspower.com"
    return Settings(
        env=_clean(os.getenv("ENV")) or "production",
        public_base_url=public_base_url.rstrip("/"),
        gateway_port=int(_clean(os.getenv("VOICE_GATEWAY_PORT")) or "9110"),
        pipecat_runner_url=(
            _clean(os.getenv("PIPECAT_RUNNER_URL")) or "http://mindbliss-voice-pipecat:9111"
        ).rstrip("/"),
        twilio_ws_public_url=(
            _clean(os.getenv("VOICE_TWILIO_WS_PUBLIC_URL"))
            or f"{public_base_url.rstrip('/').replace('https://', 'wss://')}/voice/twilio/ws"
        ).rstrip("/"),
        require_runner_ws_token=_truthy(os.getenv("VOICE_REQUIRE_RUNNER_WS_TOKEN"), True),
        webhook_token=_clean(os.getenv("VOICE_WEBHOOK_TOKEN")),
        admin_token=_clean(os.getenv("VOICE_ADMIN_TOKEN")),
        twilio_account_sid=_clean(os.getenv("TWILIO_ACCOUNT_SID")),
        twilio_auth_token=_clean(os.getenv("TWILIO_AUTH_TOKEN")),
        twilio_from_number=_clean(os.getenv("TWILIO_FROM_NUMBER")),
        twilio_whatsapp_sender=_clean(os.getenv("TWILIO_WHATSAPP_SENDER")),
        whatsapp_calls_enabled=_truthy(os.getenv("WHATSAPP_CALLS_ENABLED"), False),
        whatsapp_token=_clean(os.getenv("WHATSAPP_TOKEN")),
        whatsapp_phone_number_id=_clean(os.getenv("WHATSAPP_PHONE_NUMBER_ID")),
        whatsapp_app_secret=_clean(os.getenv("WHATSAPP_APP_SECRET")),
        whatsapp_webhook_verification_token=_clean(
            os.getenv("WHATSAPP_WEBHOOK_VERIFICATION_TOKEN")
        ),
        openrouter_api_key=_clean(os.getenv("OPENROUTER_API_KEY")),
        voice_llm_model=_clean(os.getenv("VOICE_LLM_MODEL")) or "openai/gpt-4o-mini",
        voice_stt_model=_clean(os.getenv("VOICE_STT_MODEL")) or "openai/whisper-1",
        voice_tts_model=_clean(os.getenv("VOICE_TTS_MODEL")) or "openai/gpt-4o-mini-tts",
        voice_tts_voice=_clean(os.getenv("VOICE_TTS_VOICE")) or "nova",
        voice_openai_compat_base_url=(
            _clean(os.getenv("VOICE_OPENAI_COMPAT_BASE_URL")) or "https://openrouter.ai/api/v1"
        ).rstrip("/"),
        voice_language=_clean(os.getenv("VOICE_LANGUAGE")) or "es",
        qdrant_url=(_clean(os.getenv("QDRANT_URL")) or "http://mindbrain-qdrant:6333").rstrip("/"),
        falkordb_url=_clean(os.getenv("FALKORDB_URL")),
        vp_support_ai_url=(
            _clean(os.getenv("VP_SUPPORT_AI_URL")) or "http://mindbrain-vp-support:9096"
        ).rstrip("/"),
        vp_support_ai_token=_clean(os.getenv("VP_SUPPORT_AI_TOKEN")),
    )


def _safe_url(value: str) -> str:
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
    except ValueError:
        return ""
    if not parsed.scheme or not parsed.hostname:
        return ""
    host = parsed.hostname
    if parsed.port:
        host = f"{host}:{parsed.port}"
    return f"{parsed.scheme}://{host}{parsed.path if parsed.path != '/' else ''}"
