import logging
import sys

# Root handler, so aiogram's own "Start polling" and update errors reach `docker compose logs bot`.
logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger("bot")
