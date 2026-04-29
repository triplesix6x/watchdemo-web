import uuid

from sqlalchemy import select, or_
from sqlalchemy.orm import joinedload

from APP.constants import UserRole
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.user import UserModel


class UserRepository(SQLAlchemyRepository[UserModel]):
    model = UserModel

    async def get_by_id(self, user_id: uuid.UUID, for_update: bool = False) -> UserModel | None:
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(UserModel.id == user_id)
        )
        if for_update:
            query = query.with_for_update()
        return await self._execute_one_or_none(query)

    async def get_by_id_basic(self, user_id: uuid.UUID) -> UserModel | None:
        query = select(UserModel).where(UserModel.id == user_id)
        return await self._execute_one_or_none(query)

    async def get_by_email(self, email: str) -> UserModel | None:
        query = select(UserModel).where(UserModel.email == email.lower())
        return await self._execute_one_or_none(query)

    async def get_by_username(self, username: str) -> UserModel | None:
        query = select(UserModel).where(UserModel.username == username.lower())
        return await self._execute_one_or_none(query)

    async def get_by_login(self, login: str) -> UserModel | None:
        login_lower = login.lower()
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(or_(UserModel.email == login_lower, UserModel.username == login_lower))
        )
        return await self._execute_one_or_none(query)

    async def create(
        self,
        email: str,
        username: str,
        password_hash: str,
        role: UserRole = UserRole.USER,
    ) -> UserModel:
        user = UserModel(
            email=email.lower(),
            username=username.lower(),
            password_hash=password_hash,
            role=role.value,
        )
        self.session.add(user)
        await self.session.flush()
        await self.session.refresh(user)
        return user

    async def update_password(self, user_id: uuid.UUID, password_hash: str) -> None:
        query = select(UserModel).where(UserModel.id == user_id).with_for_update()
        user = await self._execute_one_or_none(query)
        if user:
            user.password_hash = password_hash
            await self.session.flush()

    async def mark_verified(self, user_id: uuid.UUID) -> None:
        query = select(UserModel).where(UserModel.id == user_id).with_for_update()
        user = await self._execute_one_or_none(query)
        if user:
            user.is_verified = True
            await self.session.flush()
