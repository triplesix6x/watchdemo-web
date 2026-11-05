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
    "new_email": "new@example.invalid",
    "document_title": "Условия <script>alert(1)</script>",
    "document_revision": "2026-11-03-v1",
    "effective_date": "2026-11-03",
    "document_url": "https://watchdemo.pro/legal/terms/2026-11-03-v1",
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
    assert subject and html and text
    for part in (subject, html, text):
        assert "—" not in part, "no em dashes in copy"
    assert '<table role="presentation"' in html
    assert "<script>" not in html
    if msg_type == "legal_revision_updated":
        assert "&lt;script&gt;" in html
        assert DATA["document_title"] in text
        if locale == "en":
            assert "in Russian" in text


def test_unknown_locale_falls_back_to_russian():
    assert render("welcome", "de", "p", DATA)[0] == TEMPLATES["welcome"]["ru"]["subject"]


@pytest.mark.parametrize("msg_type", sorted(TEMPLATES))
@pytest.mark.parametrize("locale", ["ru", "en"])
def test_links_and_untrusted_values_are_html_escaped(msg_type, locale):
    url_key = TEMPLATES[msg_type][locale]["url_key"]
    url = 'http://localhost:5173/en/legal/terms/v1?a=1&b="value"'
    data = {**DATA, url_key: url, "new_email": '<img src=x onerror="boom">'}
    _, html, text = render(msg_type, locale, '<img src=x onerror="boom">', data)
    assert '<img src=x onerror=' not in html
    assert '&lt;img src=x onerror=&quot;boom&quot;&gt;' in html
    assert 'href="http://localhost:5173/en/legal/terms/v1?a=1&amp;b=&quot;value&quot;"' in html
    assert url in text


@pytest.mark.parametrize("msg_type", sorted(TEMPLATES))
@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,boom", "//evil.invalid/a",
                                  "https://user:pass@example.invalid/a", "https://example.invalid/\nsecret",
                                  "https://example.invalid/\tsecret", "https://example.invalid/\\evil",
                                  "https://example.invalid:99999/a", "https://", ""])
def test_unsafe_links_are_rejected(msg_type, url):
    key = TEMPLATES[msg_type]["ru"]["url_key"]
    with pytest.raises(ValueError, match="invalid email URL"):
        render(msg_type, "ru", "QA", {**DATA, key: url})


def test_welcome_has_no_news_promotion():
    for locale in ("ru", "en"):
        _, html, text = render("welcome", locale, "QA", DATA)
        assert "t.me" not in html + text


@pytest.mark.parametrize("msg_type", sorted(TEMPLATES))
@pytest.mark.parametrize("locale", ["ru", "en"])
def test_local_preview_uses_actual_localized_route_shapes(msg_type, locale):
    key = TEMPLATES[msg_type][locale]["url_key"]
    path = DATA[key].removeprefix("https://watchdemo.pro").removeprefix("/en")
    url = "http://localhost:5173" + ("/en" if locale == "en" else "") + path
    _, html, text = render(msg_type, locale, "QA", {**DATA, key: url})
    assert f'href="{url}"' in html
    assert url in text
