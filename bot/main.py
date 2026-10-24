"""@watchdemopro_bot: long polling for inbound updates and the `telegram_out` consumer for
staff replies, in one process. Either one stopping stops the bot, so docker restarts it."""

import asyncio

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
            # One update at a time, in order: a photo still downloading must not let the
            # text after it, or its own edit, reach web first.
            asyncio.create_task(dp.start_polling(bot, web=web, handle_as_tasks=False), name="polling"),
            asyncio.create_task(run_consumer(bot, web), name="consumer"),
        }
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            # Also when main() itself is cancelled: no request may outlive the sessions below.
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        for task in done:
            logger.info(f"[bot] {task.get_name()} stopped")
            task.result()
    finally:
        await web.close()
        await bot.session.close()


if __name__ == "__main__":
    logger.info("[bot] starting")
    asyncio.run(main())
