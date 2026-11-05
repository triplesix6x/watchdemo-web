"""Regression: authentication can cache ORM state before an account lock wait."""
from sqlalchemy import select

from APP.constants import SubscriptionTier
from APP.services.quota_service import QuotaService
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.repositories.quota_repo import QuotaRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from test_migration_history import schema  # noqa: F401; opt-in QA fixture
from test_quota_service import NOW, SID, add_user, database, subscription
import uuid


def test_access_refreshes_subscription_loaded_before_account_lock(schema):
    async def run(sm):
        user, library = await add_user(sm), uuid.uuid4()
        await subscription(sm, user, "plus")
        async with sm() as session, session.begin():
            cached = await session.scalar(select(SubscriptionModel).where(SubscriptionModel.user_id == user))
            assert cached.tier == "plus"
            # Another transaction completes revocation while this request still
            # holds the eager-loaded authentication identity in its ORM map.
            await subscription(sm, user, "basic")
            assert cached.tier == "plus"
            access = await QuotaService(QuotaRepository(session), lambda: NOW).access(user, SID, library)
            assert access.tier == SubscriptionTier.BASIC
            assert cached.tier == "basic"
    database(schema, run)


def test_subscription_read_after_lock_refreshes_authentication_identity(schema):
    async def run(sm):
        user = await add_user(sm)
        await subscription(sm, user, "plus")
        async with sm() as session, session.begin():
            cached = await session.scalar(select(SubscriptionModel).where(SubscriptionModel.user_id == user))
            await subscription(sm, user, "pro")
            repo = SubscriptionRepository(session)
            await repo.lock_account(user)
            current = await repo.get_by_user_id(user)
            assert current.tier == SubscriptionTier.PRO
            assert cached.tier == "pro"
    database(schema, run)
