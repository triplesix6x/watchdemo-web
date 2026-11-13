"""Social records share the request's SQLAlchemy transaction with accounts/sessions."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from SPI.db_adapter.models.social import DesktopSocialHandoffModel, SocialIdentityModel, SocialTransactionModel


class SocialRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def transaction(self, state_hash: str) -> SocialTransactionModel | None:
        return await self.session.scalar(select(SocialTransactionModel).where(
            SocialTransactionModel.state_hash == state_hash).with_for_update())

    async def desktop_launch(self, launch_hash: str) -> DesktopSocialHandoffModel | None:
        return await self.session.scalar(select(DesktopSocialHandoffModel).where(
            DesktopSocialHandoffModel.launch_hash == launch_hash).with_for_update())

    async def desktop_challenge(self, challenge_hash: str) -> DesktopSocialHandoffModel | None:
        return await self.session.scalar(select(DesktopSocialHandoffModel).where(
            DesktopSocialHandoffModel.challenge_hash == challenge_hash).with_for_update())

    async def desktop_transaction(self, desktop_id: uuid.UUID) -> SocialTransactionModel | None:
        return await self.session.scalar(select(SocialTransactionModel).where(
            SocialTransactionModel.desktop_id == desktop_id).with_for_update())

    async def identity(self, provider: str, subject: str) -> SocialIdentityModel | None:
        return await self.session.scalar(select(SocialIdentityModel).where(
            SocialIdentityModel.provider == provider, SocialIdentityModel.subject == subject))

    async def linked(self, user_id: uuid.UUID) -> list[SocialIdentityModel]:
        return list((await self.session.scalars(select(SocialIdentityModel).where(
            SocialIdentityModel.user_id == user_id))).all())

    async def add_identity(self, user_id: uuid.UUID, provider: str, subject: str) -> None:
        self.session.add(SocialIdentityModel(user_id=user_id, provider=provider, subject=subject))
        await self.session.flush()
