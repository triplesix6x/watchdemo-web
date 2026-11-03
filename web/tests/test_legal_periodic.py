"""The outbox drains bounded transactions without waiting five minutes per batch."""
import asyncio
from contextlib import asynccontextmanager

from APP import periodic


def test_outbox_drains_consumed_batches_and_commits_each(monkeypatch):
    commits = []
    calls = []
    # Consumed rows include suppressed recipients, even when none are published.
    batches = iter([100, 100, 7])

    class Session:
        @asynccontextmanager
        async def begin(self):
            yield
            commits.append(self)

    @asynccontextmanager
    async def factory():
        yield Session()

    async def publish(session, publisher):
        calls.append(session)
        return next(batches)

    monkeypatch.setattr(periodic, "publish_pending_notifications", publish)
    asyncio.run(periodic.publish_legal_outbox(factory, object()))
    assert len(calls) == 3
    assert len({id(session) for session in calls}) == 3
    assert commits == calls
