from __future__ import annotations

import os
import sys


def main() -> None:
    from pipecat.runner.run import main as runner_main

    args = [
        sys.argv[0],
        "--host",
        os.getenv("PIPECAT_HOST", "0.0.0.0"),
        "--port",
        os.getenv("PIPECAT_PORT", "9111"),
    ]
    transport = (os.getenv("PIPECAT_TRANSPORT") or "").strip()
    if transport:
        args.extend(["--transport", transport])
    proxy = (os.getenv("PIPECAT_PROXY_HOST") or "").strip()
    if proxy:
        args.extend(["--proxy", proxy])
    ws_auth = (os.getenv("PIPECAT_WEBSOCKET_AUTH") or "token").strip()
    if ws_auth:
        args.extend(["--ws-auth", ws_auth])
    if (os.getenv("WHATSAPP_CALLS_ENABLED") or "").strip().lower() in {"1", "true", "yes", "on"}:
        args.append("--whatsapp")

    sys.argv = args
    runner_main()


if __name__ == "__main__":
    main()
