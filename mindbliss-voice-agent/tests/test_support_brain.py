from __future__ import annotations

from voice_agent.support_brain import (
    build_voice_support_prompt,
    is_greeting,
    is_support_request,
    latest_user_text,
    sanitize_voice_answer,
)


def test_latest_user_text_extracts_last_user_message() -> None:
    assert (
        latest_user_text(
            [
                {"role": "user", "content": "hola"},
                {"role": "assistant", "content": "respuesta"},
                {"role": "user", "content": [{"type": "text", "text": "No llega mi OTP"}]},
            ]
        )
        == "No llega mi OTP"
    )


def test_voice_filter_allows_support_requests() -> None:
    assert is_support_request("No puedo validar mi codigo OTP del telefono")
    assert is_support_request("El pago salio fallido y necesito ayuda")
    assert is_support_request("No veo mi posicion en el arbol binario")


def test_voice_filter_blocks_non_support_requests() -> None:
    assert not is_support_request("Tenemos una propuesta comercial de publicidad")
    assert not is_support_request("Quiero una alianza de marketing")


def test_voice_greeting_is_allowed_as_entrypoint() -> None:
    assert is_greeting("hola")
    assert is_greeting("buenas tardes, necesito ayuda")


def test_voice_prompt_and_answer_are_voice_safe() -> None:
    prompt = build_voice_support_prompt("No veo mis referidos")
    assert "Mensaje hablado del usuario" in prompt
    assert sanitize_voice_answer("**Respuesta** con `markdown`") == "Respuesta con markdown"
