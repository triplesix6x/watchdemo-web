#!/usr/bin/env bash
# Resource-bounded dependency installation. Context is only the requirements file.
set -euo pipefail
cd "$(dirname "$0")/../.."
name="watchdemo-local-image-build-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker pull python:3.14-slim
docker run --name "$name" --memory=768m --memory-swap=768m --cpus=0.75 --pids-limit=128 \
  -e PYTHONDONTWRITEBYTECODE=1 -e PYTHONUNBUFFERED=1 -w /app \
  --mount "type=bind,src=$PWD/docs/local/requirements.txt,dst=/tmp/local-requirements.txt,readonly" \
  python:3.14-slim pip install --disable-pip-version-check --no-cache-dir -r /tmp/local-requirements.txt
docker commit "$name" watchdemo-local-backend:dev
