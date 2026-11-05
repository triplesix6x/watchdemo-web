import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from schemas import EmailMessage, EmailMessageType, LegalRevisionData  # noqa: E402


def legal_payload():
    return {
        "type": "legal_revision_updated",
        "notification_id": "8a2dcff6-1471-4e8b-bd3a-58873537a310",
        "created_at": "2026-11-03T12:00:00+00:00",
        "to_email": "qa@example.invalid",
        "to_name": "QA",
        "locale": "en",
        "data": {
            "document_title": "Условия использования",
            "document_revision": "v1",
            "effective_date": "2026-11-03",
            "document_url": "http://localhost:5173/en/legal/terms/v1",
        },
    }


def test_legal_envelope_has_aware_utc_timestamp_and_typed_data():
    message = EmailMessage.model_validate(legal_payload())
    assert message.created_at == datetime(2026, 11, 3, 12, tzinfo=timezone.utc)
    assert isinstance(message.data, LegalRevisionData)
    assert str(message.notification_id) == legal_payload()["notification_id"]
    assert EmailMessage.model_validate_json(message.model_dump_json()) == message


@pytest.mark.parametrize("field", list(legal_payload()))
def test_legal_requires_every_envelope_field(field):
    payload = legal_payload()
    del payload[field]
    with pytest.raises(ValidationError):
        EmailMessage.model_validate(payload)


@pytest.mark.parametrize("field,value", [
    ("created_at", None), ("created_at", 1793707200), ("created_at", "1793707200"),
    ("created_at", "2026-11-03T12:00:00"), ("created_at", "2026-11-03T12:00:00+03:00"),
    ("notification_id", "not-a-uuid"), ("locale", "de"), ("locale", None),
    ("to_email", ""), ("to_email", "qa@example.invalid\nsecret"),
])
def test_legal_rejects_invalid_metadata(field, value):
    with pytest.raises(ValidationError):
        EmailMessage.model_validate({**legal_payload(), field: value})


@pytest.mark.parametrize("field,value", [
    ("document_title", ""), ("document_revision", "v1\nsecret"),
    ("effective_date", "2026-02-30"), ("effective_date", "20261103"),
    ("document_url", "javascript:alert(1)"), ("document_url", "https://user:secret@example.invalid"),
    ("extra", "unexpected"),
])
def test_legal_rejects_invalid_document_data(field, value):
    payload = legal_payload()
    payload["data"][field] = value
    with pytest.raises(ValidationError):
        EmailMessage.model_validate(payload)


def test_legal_rejects_extra_envelope_data():
    with pytest.raises(ValidationError):
        EmailMessage.model_validate({**legal_payload(), "ip": "127.0.0.1"})


@pytest.mark.parametrize("kind", [kind for kind in EmailMessageType if kind != EmailMessageType.LEGAL_REVISION_UPDATED])
def test_old_job_without_notification_metadata_is_compatible(kind):
    message = EmailMessage.model_validate({"type": kind, "to_email": "qa@example.invalid",
                                          "to_name": "QA", "data": {}})
    assert message.locale == "ru"
    assert message.notification_id is None
    assert message.created_at is None
