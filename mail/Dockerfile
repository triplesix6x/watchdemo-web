FROM python:3.14.3
WORKDIR /app

SHELL ["/bin/bash", "-c"]

ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    make wget curl && \
    pip install poetry && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml poetry.lock* ./

RUN poetry config virtualenvs.create false \
    && poetry install --compile --no-root

COPY . .

CMD ["python", "main.py"]
