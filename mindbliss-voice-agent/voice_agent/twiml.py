from __future__ import annotations

from html import escape


def connect_stream_twiml(ws_url: str, parameters: dict[str, str] | None = None) -> str:
    params_xml = ""
    for key, value in sorted((parameters or {}).items()):
        if value:
            params_xml += f'<Parameter name="{escape(key)}" value="{escape(str(value))}" />'
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        "<Connect>"
        f'<Stream url="{escape(ws_url)}">{params_xml}</Stream>'
        "</Connect>"
        "</Response>"
    )


def reject_twiml(message: str) -> str:
    clean = escape(message[:240])
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Say language="es-CO">{clean}</Say>'
        "</Response>"
    )
