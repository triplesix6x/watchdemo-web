import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from schemas import EmailMessageType  # noqa: E402
from templates import LOGO_URL, TEMPLATES, render  # noqa: E402

DATA = {
    "verification_url": "https://watchdemo.pro/verify-email?token=abc",
    "reset_url": "https://watchdemo.pro/reset-password?token=abc",
    "confirm_url": "https://watchdemo.pro/confirm-email-change?token=abc",
    "download_url": "https://watchdemo.pro/en/download",
    "security_url": "https://watchdemo.pro/account/security",
    "expires_in_hours": 24,
    "expires_in_minutes": 60,
    "new_email": "new@watchdemo.pro",
}


def test_every_message_type_has_both_languages():
    assert set(TEMPLATES) == {t.value for t in EmailMessageType}
    assert all(set(v) == {"ru", "en"} for v in TEMPLATES.values())


@pytest.mark.parametrize("msg_type", sorted(TEMPLATES))
@pytest.mark.parametrize("locale", ["ru", "en"])
def test_render(msg_type, locale):
    subject, html, text = render(msg_type, locale, "player<1>", DATA)
    url = DATA[TEMPLATES[msg_type][locale]["url_key"]]
    assert url in text and url in html
    assert LOGO_URL in html
    assert "player&lt;1&gt;" in html and "<1>" not in html
    assert "#0d0f13" in html and "#2f6fd2" in html
    for s in (subject, html, text):
        assert "—" not in s, "no em dashes in copy"


def test_unknown_locale_falls_back_to_russian():
    assert render("welcome", "de", "p", DATA)[0] == TEMPLATES["welcome"]["ru"]["subject"]
