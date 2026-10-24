import asyncio

from aiogram import Dispatcher
from aiogram.types import Update

from conftest import FakeTelegram, FakeWeb, fake_bot
from handlers import router

dp = Dispatcher()
dp.include_router(router)

JPEG = b"\xff\xd8\xff\xe0" + b"\1" * 100
IVAN = {"id": 4242, "is_bot": False, "first_name": "Ivan", "username": "ivan_cs", "language_code": "ru"}


def update(uid, mid, edited=False, sender=IVAN, chat_type="private", **msg):
    message = {"message_id": mid, "from": sender, "chat": {"id": sender["id"], "type": chat_type}, "date": 0, **msg}
    return {"update_id": uid, "edited_message" if edited else "message": message}


def feed(tg, web, *updates):
    bot = fake_bot(tg)

    async def go():
        for u in updates:
            await dp.feed_update(bot, Update.model_validate(u, context={"bot": bot}), web=web)

    asyncio.run(go())


def said(tg):
    return [(name, p.get("text", "")[:20]) for name, p in tg.calls if name not in ("getMe",)]


def test_start_greets_with_help_button_and_opens_no_ticket():
    tg, web = FakeTelegram(), FakeWeb()
    feed(tg, web, update(1, 10, text="/start"))
    en = {**IVAN, "language_code": "en-GB"}
    feed(tg, web, update(2, 11, sender=en, text="/start"))
    assert web.calls == [("contact", 4242, "ru"), ("contact", 4242, "en")]
    starts = [p for name, p in tg.calls if name == "sendMessage"]
    assert starts[0]["text"].startswith("Здравствуйте! Это поддержка WatchDemo.")
    assert starts[0]["reply_markup"]["inline_keyboard"][0][0] == {"text": "Открыть «Помощь»", "url": "https://watchdemo.pro/help"}
    assert starts[1]["reply_markup"]["inline_keyboard"][0][0] == {"text": "Open Help", "url": "https://watchdemo.pro/en/help"}


def test_text_is_routed_and_only_a_new_ticket_is_acknowledged():
    tg, web = FakeTelegram(), FakeWeb(new_ticket=True)
    feed(tg, web, update(1, 11, text="F8 does nothing"))
    web.new_ticket = False
    feed(tg, web, update(2, 12, text="and F7"))
    assert web.calls == [("message", 11, "F8 does nothing", None), ("message", 12, "and F7", None)]
    assert said(tg) == [("sendMessage", "Сообщение получили. ")]


def test_photo_sends_the_largest_size_with_its_caption():
    tg, web = FakeTelegram(files={"BIG": JPEG}), FakeWeb(new_ticket=False)
    photo = [{"file_id": "SMALL", "file_unique_id": "s", "file_size": 10, "width": 90, "height": 90},
             {"file_id": "BIG", "file_unique_id": "b", "file_size": len(JPEG), "width": 1280, "height": 720}]
    feed(tg, web, update(1, 12, photo=photo, caption=" screen "))
    assert web.calls == [("message", 12, "screen", JPEG)]
    assert said(tg) == [("getFile", ""), ("download", "")]


def test_image_document_is_an_image_other_documents_are_refused():
    tg, web = FakeTelegram(files={"DOC": JPEG}), FakeWeb(new_ticket=True)
    feed(tg, web, update(1, 13, document={"file_id": "DOC", "file_unique_id": "d", "mime_type": "image/jpeg", "file_size": len(JPEG)}))
    feed(tg, web, update(2, 14, document={"file_id": "PDF", "file_unique_id": "p", "mime_type": "application/pdf"}))
    feed(tg, web, update(3, 15, sticker={"file_id": "x", "file_unique_id": "x", "type": "regular", "width": 1, "height": 1, "is_animated": False, "is_video": False}))
    assert web.calls == [("message", 13, "", JPEG), ("contact", 4242, "ru"), ("contact", 4242, "ru")]
    assert said(tg) == [
        ("getFile", ""),
        ("download", ""),
        ("sendMessage", "Сообщение получили. "),
        ("sendMessage", "Поддержка принимает "),
        ("sendMessage", "Поддержка принимает "),
    ]


def test_oversized_photo_is_refused_before_download():
    tg, web = FakeTelegram(), FakeWeb()
    feed(tg, web, update(1, 16, photo=[{"file_id": "HUGE", "file_unique_id": "h", "file_size": 11 * 2**20, "width": 9, "height": 9}]))
    assert web.calls == [("contact", 4242, "ru")]
    assert said(tg) == [("sendMessage", "Картинка больше 10 М")]


def test_photo_fetch_failure_asks_to_resend():
    bad_gateway = (502, {"ok": False, "error_code": 502, "description": "Bad Gateway"})
    tg, web = FakeTelegram(script={"getFile": [bad_gateway]}), FakeWeb()
    feed(tg, web, update(1, 30, photo=[{"file_id": "P", "file_unique_id": "p", "file_size": 10, "width": 9, "height": 9}]))
    assert web.calls == [("contact", 4242, "ru")]
    assert said(tg) == [("getFile", ""), ("sendMessage", "Не получилось забрат")]


def test_image_web_refuses_gets_the_matching_reply():
    for code, reply in [("support_image_invalid", "Поддержка принимает "), ("support_image_too_large", "Картинка больше 10 М")]:
        tg, web = FakeTelegram(files={"P": JPEG}), FakeWeb(message_error=code)
        feed(tg, web, update(1, 31, photo=[{"file_id": "P", "file_unique_id": "p", "file_size": 10, "width": 9, "height": 9}]))
        assert web.calls == [("message", 31, "", JPEG), ("contact", 4242, "ru")]
        assert said(tg)[-1] == ("sendMessage", reply)


def test_edits_update_the_body():
    tg, web = FakeTelegram(), FakeWeb()
    feed(tg, web, update(1, 11, edited=True, text="F8 and F7 do nothing", edit_date=1))
    feed(tg, web, update(2, 12, edited=True, photo=[{"file_id": "P", "file_unique_id": "p", "width": 9, "height": 9}], caption="new caption", edit_date=1))
    assert web.calls == [("edit", 11, "F8 and F7 do nothing"), ("edit", 12, "new caption")]
    assert said(tg) == []


def test_groups_and_bots_are_ignored():
    tg, web = FakeTelegram(), FakeWeb()
    feed(tg, web, update(1, 1, chat_type="group", text="hi"))
    feed(tg, web, update(2, 2, sender={**IVAN, "is_bot": True}, text="hi"))
    assert web.calls == [] and said(tg) == []
