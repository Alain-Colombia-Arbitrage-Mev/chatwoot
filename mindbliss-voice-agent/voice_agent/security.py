from __future__ import annotations

import base64
import hashlib
import hmac
from collections.abc import Mapping


def constant_time_equal(left: str, right: str) -> bool:
    return hmac.compare_digest((left or "").encode(), (right or "").encode())


def verify_static_token(provided: str | None, expected: str) -> bool:
    return bool(expected and provided and constant_time_equal(provided, expected))


def verify_twilio_signature(
    *,
    public_url: str,
    params: Mapping[str, str],
    signature: str | None,
    auth_token: str,
) -> bool:
    if not public_url or not signature or not auth_token:
        return False
    payload = public_url + "".join(f"{key}{params[key]}" for key in sorted(params))
    digest = hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()
    expected = base64.b64encode(digest).decode()
    return constant_time_equal(expected, signature)


def verify_whatsapp_signature(*, raw_body: bytes, signature: str | None, app_secret: str) -> bool:
    if not raw_body or not signature or not app_secret:
        return False
    if not signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return constant_time_equal(expected, signature)
