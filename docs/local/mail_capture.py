"""Local-only RabbitMQ sink. Never imports Resend or delivers mail/Telegram.

Messages remain in memory for this process lifetime; GET / returns captured JSON.
"""
import asyncio
import json
import os
from collections import deque

import aio_pika
from fastapi import FastAPI
import uvicorn

messages = deque(maxlen=200)
app = FastAPI()


@app.get("/")
def inbox():
    return list(messages)


async def main():
    connection = await aio_pika.connect_robust(os.environ["LOCAL_AMQP_URL"])
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=1)
    for name in ("email", "telegram_out"):
        queue = await channel.declare_queue(name, durable=True)

        async def capture(message, queue_name=name):
            async with message.process():
                messages.append({"queue": queue_name, "message": json.loads(message.body)})

        await queue.consume(capture)
    try:
        await uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=8025)).serve()
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(main())
