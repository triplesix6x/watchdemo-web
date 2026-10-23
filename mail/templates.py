"""Письма WatchDemo: RU/EN тексты и общий макет в стиле приложения.

Макет на таблицах с inline-стилями: почтовые клиенты режут `<style>` и
flex. Цвета взяты из токенов приложения (ink-950, ink-900, ink-50, ink-400,
brand-600). У каждого письма есть текстовая часть для клиентов без HTML.
"""

from html import escape

LOGO_URL = "https://watchdemo.pro/brand/logo-64.png"
TELEGRAM_URL = "https://t.me/watchdemopro"

_GROUND = "#0d0f13"
_ISLAND = "#13161b"
_LINE = "#22262e"
_TEXT = "#f1f3f6"
_MUTED = "#8a909c"
_BUTTON = "#2f6fd2"
_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

# Для каждого письма: тема, заголовок, текст, подпись кнопки, ключ ссылки
# в `data`, примечание внизу. В текстах подставляются `{name}` и поля `data`.
TEMPLATES: dict[str, dict[str, dict[str, str]]] = {
    "verify_email": {
        "ru": {
            "subject": "Подтвердите почту в WatchDemo",
            "title": "Подтвердите почту",
            "body": "Привет, {name}! Нажмите кнопку, чтобы подтвердить адрес и войти "
                    "в WatchDemo. Ссылка действует {expires_in_hours} ч.",
            "button": "Подтвердить почту",
            "url_key": "verification_url",
            "note": "Если вы не регистрировались в WatchDemo, просто удалите это письмо.",
        },
        "en": {
            "subject": "Confirm your email for WatchDemo",
            "title": "Confirm your email",
            "body": "Hi {name}. Confirm your address to sign in to WatchDemo. "
                    "The link works for {expires_in_hours} hours.",
            "button": "Confirm email",
            "url_key": "verification_url",
            "note": "If you didn't sign up for WatchDemo, you can delete this email.",
        },
    },
    "reset_password": {
        "ru": {
            "subject": "Сброс пароля WatchDemo",
            "title": "Сбросьте пароль",
            "body": "Привет, {name}! Мы получили запрос на сброс пароля. "
                    "Ссылка действует {expires_in_minutes} мин.",
            "button": "Сбросить пароль",
            "url_key": "reset_url",
            "note": "Если вы не просили сброс, ничего не делайте: пароль останется прежним.",
        },
        "en": {
            "subject": "Reset your WatchDemo password",
            "title": "Reset your password",
            "body": "Hi {name}. We got a request to reset your password. "
                    "The link works for {expires_in_minutes} minutes.",
            "button": "Reset password",
            "url_key": "reset_url",
            "note": "If you didn't ask for this, do nothing and your password stays the same.",
        },
    },
    "welcome": {
        "ru": {
            "subject": "Добро пожаловать в WatchDemo",
            "title": "Аккаунт готов",
            "body": "Привет, {name}! Почта подтверждена. Скачайте приложение, "
                    "войдите и откройте первую демку.",
            "button": "Скачать WatchDemo",
            "url_key": "download_url",
            "note": "Новости и обновления в Telegram: " + TELEGRAM_URL,
        },
        "en": {
            "subject": "Welcome to WatchDemo",
            "title": "Your account is ready",
            "body": "Hi {name}. Your email is confirmed. Download the app, "
                    "sign in and open your first demo.",
            "button": "Download WatchDemo",
            "url_key": "download_url",
            "note": "News and updates on Telegram: " + TELEGRAM_URL,
        },
    },
    "email_change_confirm": {
        "ru": {
            "subject": "Подтвердите новую почту WatchDemo",
            "title": "Подтвердите новый адрес",
            "body": "Привет, {name}! Этот адрес указали как новую почту аккаунта "
                    "WatchDemo. Ссылка действует {expires_in_hours} ч.",
            "button": "Подтвердить адрес",
            "url_key": "confirm_url",
            "note": "Если вы ничего не меняли, удалите письмо: почта аккаунта не изменится.",
        },
        "en": {
            "subject": "Confirm your new WatchDemo email",
            "title": "Confirm your new address",
            "body": "Hi {name}. This address was entered as the new email for a "
                    "WatchDemo account. The link works for {expires_in_hours} hours.",
            "button": "Confirm address",
            "url_key": "confirm_url",
            "note": "If you didn't change anything, delete this email and the account email stays the same.",
        },
    },
    "email_change_notice": {
        "ru": {
            "subject": "Запрошена смена почты WatchDemo",
            "title": "Запрошена смена почты",
            "body": "Привет, {name}! Для вашего аккаунта запросили смену почты на "
                    "{new_email}. Адрес изменится только после перехода по ссылке "
                    "из письма на новый адрес.",
            "button": "Открыть безопасность",
            "url_key": "security_url",
            "note": "Если это были не вы, смените пароль и завершите другие сеансы.",
        },
        "en": {
            "subject": "WatchDemo email change requested",
            "title": "Email change requested",
            "body": "Hi {name}. Someone asked to change your account email to "
                    "{new_email}. It changes only after the link sent to the new "
                    "address is opened.",
            "button": "Open security settings",
            "url_key": "security_url",
            "note": "If this wasn't you, change your password and sign out other devices.",
        },
    },
    "password_changed": {
        "ru": {
            "subject": "Пароль WatchDemo изменён",
            "title": "Пароль изменён",
            "body": "Привет, {name}! Пароль от аккаунта WatchDemo только что изменили.",
            "button": "Открыть безопасность",
            "url_key": "security_url",
            "note": "Если это были не вы, сбросьте пароль на странице входа "
                    "и завершите другие сеансы.",
        },
        "en": {
            "subject": "Your WatchDemo password was changed",
            "title": "Password changed",
            "body": "Hi {name}. The password for your WatchDemo account was just changed.",
            "button": "Open security settings",
            "url_key": "security_url",
            "note": "If this wasn't you, reset your password from the sign-in page "
                    "and sign out other devices.",
        },
    },
}

_FALLBACK = {
    "ru": "Если кнопка не работает, откройте ссылку:",
    "en": "If the button doesn't work, open this link:",
}


def _layout(title: str, body: str, button: str, url: str, note: str, fallback: str) -> str:
    """Собирает HTML письма. Все аргументы уже экранированы."""
    button_html = ""
    if url:
        button_html = f"""
          <tr><td style="padding:8px 32px 0 32px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td bgcolor="{_BUTTON}" style="border-radius:12px">
                <a href="{url}" style="display:inline-block;padding:13px 24px;font-family:{_FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px">{button}</a>
              </td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:20px 32px 0 32px;font-family:{_FONT};font-size:13px;line-height:1.5;color:{_MUTED}">
            {fallback}<br><a href="{url}" style="color:{_MUTED};word-break:break-all">{url}</a>
          </td></tr>"""
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>{title}</title></head>
<body style="margin:0;padding:0;background:{_GROUND}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{_GROUND}" style="background:{_GROUND}">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
      <tr><td style="padding:0 4px 20px 4px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle"><img src="{LOGO_URL}" width="28" height="28" alt="WatchDemo" style="display:block;border:0"></td>
          <td style="vertical-align:middle;padding-left:10px;font-family:{_FONT};font-size:16px;font-weight:600;color:{_TEXT}">WatchDemo</td>
        </tr></table>
      </td></tr>
      <tr><td bgcolor="{_ISLAND}" style="background:{_ISLAND};border:1px solid {_LINE};border-radius:12px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:32px 32px 0 32px;font-family:{_FONT};font-size:22px;line-height:1.3;font-weight:600;color:{_TEXT}">{title}</td></tr>
          <tr><td style="padding:12px 32px 16px 32px;font-family:{_FONT};font-size:15px;line-height:1.55;color:{_TEXT}">{body}</td></tr>{button_html}
          <tr><td style="padding:24px 32px 32px 32px;font-family:{_FONT};font-size:13px;line-height:1.5;color:{_MUTED}">{note}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 4px 0 4px;font-family:{_FONT};font-size:12px;color:{_MUTED}">
        <a href="https://watchdemo.pro" style="color:{_MUTED};text-decoration:none">watchdemo.pro</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


def render(msg_type: str, locale: str, name: str, data: dict) -> tuple[str, str, str]:
    """Готовит письмо.

    Args:
        msg_type: Тип письма, ключ `TEMPLATES`.
        locale: `ru` или `en`; неизвестный язык даёт русское письмо.
        name: Имя получателя.
        data: Ссылки и параметры из сообщения очереди.

    Returns:
        Тройка (тема, HTML, текст).

    Raises:
        KeyError: Неизвестный тип письма или в `data` нет нужного поля.
    """
    lang = locale if locale in ("ru", "en") else "ru"
    t = TEMPLATES[msg_type][lang]
    fields = {"name": name, **data}
    body = t["body"].format(**fields)
    url = data.get(t["url_key"], "")

    html = _layout(
        title=escape(t["title"]),
        body=escape(body),
        button=escape(t["button"]),
        url=escape(url, quote=True),
        note=escape(t["note"]),
        fallback=escape(_FALLBACK[lang]),
    )
    parts = [t["title"], body]
    if url:
        parts.append(f"{t['button']}: {url}")
    parts += [t["note"], "WatchDemo, https://watchdemo.pro"]
    return t["subject"], html, "\n\n".join(parts) + "\n"
