"""@watchdemopro_bot: long polling for inbound updates and the `telegram_out` consumer for
staff replies, in one process. Either one stopping stops the bot, so docker restarts it."""

import asyncio
from contextlib import suppress

from aiogram import Bot, Dispatcher

from config import settings
from consumer import run_consumer
from handlers import router
from logger import logger
from web_client import WebClient


async def main() -> None:
    bot = Bot(settings.telegram_bot_token)
    web = WebClient(settings.web_url, settings.internal_api_token)
    dp = Dispatcher()
    dp.include_router(router)
    try:
        # This design never sets a webhook, and getUpdates answers 409 while one is set.
        # Say so and stop instead of deleting it: someone set it on purpose.
        if (await bot.get_webhook_info()).url:
            raise SystemExit("a webhook is set for this bot; run deleteWebhook (docs/DEPLOY.md), then restart")
        tasks = {
            asyncio.create_task(dp.start_polling(bot, web=web), name="polling"),
            asyncio.create_task(run_consumer(bot, web), name="consumer"),
        }
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        for task in done:
            logger.info(f"[bot] {task.get_name()} stopped")
            task.result()
    finally:
        await web.close()
        await bot.session.close()


if __name__ == "__main__":
    logger.info("[bot] starting")
    asyncio.run(main())
