import os
import sys
from pathlib import Path

# Settings() читает окружение при импорте; БД, Redis и RabbitMQ тестам не нужны.
os.environ.setdefault("POSTGRES__HOST", "localhost")
os.environ.setdefault("POSTGRES__PORT", "5432")
os.environ.setdefault("POSTGRES__USER", "test")
os.environ.setdefault("POSTGRES__PASSWORD", "test")
os.environ.setdefault("POSTGRES__DATABASE", "test")
os.environ.setdefault("JWT__SECRET", "test-secret-test-secret-test-secret")
os.environ.setdefault("RABBITMQ__HOST", "localhost")
os.environ.setdefault("RABBITMQ__USER", "test")
os.environ.setdefault("RABBITMQ__PASSWORD", "test")
os.environ.setdefault("RESEND__API", "re_test")
os.environ.setdefault("APP__FRONTEND_URL", "https://watchdemo.pro")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
