"""Dev runner for the support bot: long polling instead of the webhook.

    cd web && python -m APP.telegram_poll

Telegram refuses getUpdates while a webhook is set (409), so this cannot run against a
bot whose production webhook is live; it never touches the webhook itself.
"""

import asyncio

from APP.logger import AppLogger
from APP.services.telegram_bot import ALLOWED_UPDATES, handle_update
from SPI.db_adapter.db import db
from SPI.telegram_adapter.bot_api import TelegramError, get_bot

logger = AppLogger.get_logger()


async def main() -> None:
    bot = get_bot()
    if bot is None:
        raise SystemExit("TELEGRAM_BOT_TOKEN is not set")
    me = await bot.call("getMe")
    logger.info(f"polling as @{me['username']}")
    offset = None
    try:
        while True:
            try:
                updates = await bot.call(
                    "getUpdates", {"offset": offset, "timeout": 50, "allowed_updates": ALLOWED_UPDATES}
                )
            except TelegramError as e:
                if e.status == 409:
                    raise SystemExit("a webhook is set for this bot; polling would fight it") from None
                logger.warning(f"getUpdates failed: {e}")
                await asyncio.sleep(5)
                continue
            for update in updates:
                offset = update["update_id"] + 1
                try:
                    async with db.session_factory() as session, session.begin():
                        await handle_update(session, bot, update)
                except Exception:
                    logger.exception(f"update {update['update_id']} failed")
    finally:
        await bot.aclose()
        await db.dispose()


if __name__ == "__main__":
    asyncio.run(main())
