import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Parent must supply isolated Settings before importing this module; see RUNBOOK.
import email_service  # noqa: E402
from schemas import EmailMessage  # noqa: E402


def payload(kind="legal_revision_updated", locale="ru"):
    if kind == "legal_revision_updated":
        return {
            "type": kind, "notification_id": "8a2dcff6-1471-4e8b-bd3a-58873537a310",
            "created_at": "2026-11-03T12:00:00+00:00",
            "to_email": "qa@example.invalid", "to_name": "QA <unsafe>", "locale": locale,
            "data": {"document_title": "Условия", "document_revision": "v1",
                     "effective_date": "2026-11-03",
                     "document_url": "http://localhost:5173/en/legal/terms/v1"},
        }
    return {"type": kind, "to_email": "qa@example.invalid", "to_name": "QA <unsafe>",
            "locale": locale, "data": {"verification_url": "http://localhost:5173/verify-email?token=fake",
                                       "expires_in_hours": 24}}


@pytest.mark.parametrize("locale", ["ru", "en"])
def test_legal_send_passes_stable_resend_idempotency_options(monkeypatch, caplog, locale):
    calls = []

    def fake_send(params, options):
        calls.append((params, options))
        return {"id": "fake-provider-id"}

    monkeypatch.setattr(email_service.resend.Emails, "send", fake_send)
    message = EmailMessage.model_validate(payload(locale=locale))
    asyncio.run(email_service.send_email(message))
    asyncio.run(email_service.send_email(message))
    assert len(calls) == 2
    assert calls[0] == calls[1]
    params, options = calls[0]
    assert options == {"idempotency_key": "legal-notice/8a2dcff6-1471-4e8b-bd3a-58873537a310"}
    assert params["to"] == ["qa@example.invalid"]
    assert params["subject"] and params["text"] and params["html"]
    assert "QA &lt;unsafe&gt;" in params["html"]
    assert "http://localhost:5173/en/legal/terms/v1" in params["text"]
    assert "qa@example.invalid" not in caplog.text


def test_legacy_send_needs_no_notification_metadata_and_logs_no_token(monkeypatch, caplog):
    calls = []

    def fake_send(params, options):
        calls.append((params, options))

    monkeypatch.setattr(email_service.resend.Emails, "send", fake_send)
    # An unsupported legacy locale renders/logs only the fallback language.
    message = EmailMessage.model_validate(payload("verify_email", "qa@example.invalid token=secret"))
    asyncio.run(email_service.send_email(message))
    params, options = calls[0]
    assert options is None
    assert "token=fake" in params["text"]
    assert "qa@example.invalid" not in caplog.text
    assert "token=secret" not in caplog.text
    assert "token=fake" not in caplog.text


def test_provider_failure_is_not_misreported_as_success(monkeypatch, caplog):
    def fake_send(params, options):
        raise RuntimeError("fake provider failure")

    monkeypatch.setattr(email_service.resend.Emails, "send", fake_send)
    with pytest.raises(RuntimeError, match="fake provider failure"):
        asyncio.run(email_service.send_email(EmailMessage.model_validate(payload())))
    assert "event=email_submitted" not in caplog.text
