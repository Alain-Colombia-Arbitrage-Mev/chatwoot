from __future__ import annotations

import os

from dotenv import load_dotenv
from loguru import logger

from .config import get_settings
from .support_brain import SupportBrainResponder

load_dotenv(override=True)


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


async def run_bot(transport, runner_args, testing: bool = False) -> None:
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import (
        LLMContextAggregatorPair,
        LLMUserAggregatorParams,
    )
    from pipecat.workers.runner import WorkerRunner

    api_key = _env("OPENROUTER_API_KEY") or _env("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY or OPENAI_API_KEY is required for voice calls")

    stt = build_stt(api_key)
    tts = build_tts(api_key)
    support_brain = SupportBrainResponder(get_settings())

    context = LLMContext()
    user_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    ).user()

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            support_brain,
            tts,
            transport.output(),
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        idle_timeout_secs=getattr(runner_args, "pipeline_idle_timeout_secs", None),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        logger.info("voice client connected")
        await support_brain.say(
            "Hola, soy soporte de Mindbliss Power. Cuentame en que puedo ayudarte."
        )

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        logger.info("voice client disconnected")
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=getattr(runner_args, "handle_sigint", False), force_gc=True)
    await runner.add_workers(worker)
    await runner.run()


def build_stt(openai_compatible_key: str):
    provider = _env("VOICE_STT_PROVIDER", "openai").lower()
    if provider == "deepgram":
        from pipecat.services.deepgram.stt import DeepgramSTTService

        api_key = _env("DEEPGRAM_API_KEY")
        if not api_key:
            raise RuntimeError("DEEPGRAM_API_KEY is required when VOICE_STT_PROVIDER=deepgram")
        return DeepgramSTTService(api_key=api_key)

    from pipecat.services.openai.stt import OpenAISTTService

    return OpenAISTTService(
        api_key=openai_compatible_key,
        base_url=_env("VOICE_OPENAI_COMPAT_BASE_URL", "https://openrouter.ai/api/v1"),
        settings=OpenAISTTService.Settings(
            model=_env("VOICE_STT_MODEL", "openai/whisper-1"),
            language=_env("VOICE_LANGUAGE", "es"),
            prompt="Mindbliss Power, OTP, telefono, arbol binario, referidos, pagos, reembolsos.",
        ),
    )


def build_tts(openai_compatible_key: str):
    provider = _env("VOICE_TTS_PROVIDER", "openai").lower()
    if provider == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        api_key = _env("CARTESIA_API_KEY")
        if not api_key:
            raise RuntimeError("CARTESIA_API_KEY is required when VOICE_TTS_PROVIDER=cartesia")
        return CartesiaTTSService(
            api_key=api_key,
            settings=CartesiaTTSService.Settings(
                voice=_env("VOICE_TTS_VOICE", "71a7ad14-091c-4e8e-a314-022ece01c121"),
            ),
        )

    from pipecat.services.openai.tts import OpenAITTSService

    return OpenAITTSService(
        api_key=openai_compatible_key,
        base_url=_env("VOICE_OPENAI_COMPAT_BASE_URL", "https://openrouter.ai/api/v1"),
        settings=OpenAITTSService.Settings(
            model=_env("VOICE_TTS_MODEL", "openai/gpt-4o-mini-tts"),
            voice=_env("VOICE_TTS_VOICE", "nova"),
            language=_env("VOICE_LANGUAGE", "es"),
            instructions="Voz de soporte profesional, amable, concisa y clara para usuarios en Colombia.",
            speed=1.02,
        ),
    )


async def bot(runner_args):
    from pipecat.runner.utils import create_transport
    from pipecat.transports.base_transport import TransportParams
    from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams

    transport_params = {
        "twilio": lambda: FastAPIWebsocketParams(audio_in_enabled=True, audio_out_enabled=True),
        "websocket": lambda: FastAPIWebsocketParams(audio_in_enabled=True, audio_out_enabled=True),
        "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    }
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
