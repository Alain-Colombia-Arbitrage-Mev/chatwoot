from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any

import httpx
from loguru import logger
from pipecat.frames.frames import (
    Frame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    TextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from .config import Settings

SUPPORT_KEYWORDS = {
    "otp",
    "codigo",
    "validar",
    "verificar",
    "telefono",
    "login",
    "entrar",
    "acceso",
    "password",
    "contrasena",
    "pago",
    "pagos",
    "compra",
    "tarjeta",
    "cargo",
    "rechazado",
    "fallido",
    "reembolso",
    "chargeback",
    "devolucion",
    "arbol",
    "binario",
    "referido",
    "referidos",
    "posicion",
    "patrocinador",
    "comision",
    "rango",
    "cuenta",
    "perfil",
    "baneado",
    "bloqueado",
    "blacklist",
    "usuario",
    "email",
    "retiro",
    "retirar",
    "wallet",
    "billetera",
    "saldo",
}

NON_SUPPORT_KEYWORDS = {
    "publicidad",
    "promocion",
    "seo",
    "propuesta comercial",
    "newsletter",
    "alianza",
}

GREETING_WORDS = {"hola", "buenas", "buenos dias", "buenas tardes", "buenas noches"}

VOICE_SYSTEM_HINT = """
Responde para una llamada de voz de soporte de Mindbliss Power.
Usa espanol claro, corto y accionable. No prometas pagos, reembolsos,
activaciones, cambios de arbol ni cambios de cuenta. No pidas contrasenas,
codigos OTP completos, tarjetas ni claves. Si requiere validar identidad,
pagos, arbol binario o estado de cuenta, escala a un agente humano.
"""


@dataclass(frozen=True)
class SupportBrainResult:
    answer: str
    escalate: bool = False


class SupportBrainResponder(FrameProcessor):
    def __init__(self, settings: Settings) -> None:
        super().__init__(name="mindbliss-support-brain")
        self._settings = settings

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if not isinstance(frame, LLMContextFrame) or direction != FrameDirection.DOWNSTREAM:
            await self.push_frame(frame, direction)
            return

        question = latest_user_text(frame.context.get_messages())
        if not question:
            return

        answer = await self._answer(question)
        frame.context.add_message({"role": "assistant", "content": answer.answer})
        await self.say(answer.answer)

    async def say(self, text: str) -> None:
        await self.push_frame(LLMFullResponseStartFrame())
        await self.push_frame(TextFrame(text))
        await self.push_frame(LLMFullResponseEndFrame())

    async def _answer(self, question: str) -> SupportBrainResult:
        if is_greeting(question):
            return SupportBrainResult(
                "Hola, soy soporte de Mindbliss Power. Cuentame si necesitas ayuda con OTP, "
                "telefono, pagos, reembolsos, arbol binario, referidos, retiros o tu cuenta."
            )

        if not is_support_request(question):
            return SupportBrainResult(
                "Solo puedo atender solicitudes de soporte de Mindbliss Power. "
                "Puedo ayudarte con OTP, telefono, pagos, arbol binario, referidos, retiros o cuenta.",
                escalate=True,
            )

        if not self._settings.vp_support_ai_url or not self._settings.vp_support_ai_token:
            return SupportBrainResult(
                "No puedo consultar la memoria de soporte en este momento. "
                "Voy a escalar tu caso para revision humana.",
                escalate=True,
            )

        prompt = build_voice_support_prompt(question)
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    f"{self._settings.vp_support_ai_url}/api/support/chat",
                    json={"message": prompt},
                    headers={
                        "Content-Type": "application/json",
                        "X-VP-Service-Token": self._settings.vp_support_ai_token,
                        "X-VP-User-Email": "voice-support@mindblisspower.local",
                    },
                )
            response.raise_for_status()
            payload = response.json()
            return SupportBrainResult(
                answer=sanitize_voice_answer(payload.get("answer")),
                escalate=bool(payload.get("escalate")),
            )
        except Exception as error:
            logger.warning("support brain request failed: {}", error)
            return SupportBrainResult(
                "No pude consultar la memoria de soporte ahora. "
                "Voy a dejar este caso para revision humana.",
                escalate=True,
            )


def latest_user_text(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return clean_text(content)
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    parts.append(part["text"])
            return clean_text(" ".join(parts))
    return ""


def is_support_request(text: str) -> bool:
    normalized = normalize(text)
    if not normalized:
        return False
    if any(word in normalized for word in NON_SUPPORT_KEYWORDS):
        return any(word in normalized for word in SUPPORT_KEYWORDS)
    return any(word in normalized for word in SUPPORT_KEYWORDS)


def is_greeting(text: str) -> bool:
    normalized = normalize(text)
    return normalized in GREETING_WORDS or any(normalized.startswith(f"{word} ") for word in GREETING_WORDS)


def build_voice_support_prompt(question: str) -> str:
    return clean_text(f"{VOICE_SYSTEM_HINT}\n\nMensaje hablado del usuario:\n{question}")


def sanitize_voice_answer(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return "Necesito escalar tu caso a un agente humano para revisarlo correctamente."
    text = re.sub(r"[*_`#>]+", "", text)
    return text[:700]


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize(value: Any) -> str:
    text = clean_text(value).lower()
    text = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
