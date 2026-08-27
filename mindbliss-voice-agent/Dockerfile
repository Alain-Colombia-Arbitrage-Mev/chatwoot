FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY voice_agent ./voice_agent

RUN pip install --upgrade pip && pip install .

EXPOSE 9110 9111

CMD ["uvicorn", "voice_agent.gateway:app", "--host", "0.0.0.0", "--port", "9110"]
