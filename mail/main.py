import asyncio

from consumer import run_consumer
from logger import AppLogger

logger = AppLogger.get_logger()


if __name__ == "__main__":
    logger.info("[mailer] starting")
    asyncio.run(run_consumer())
