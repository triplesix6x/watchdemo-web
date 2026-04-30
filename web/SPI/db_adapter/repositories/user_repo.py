import uuid

from sqlalchemy import or_, select
from sqlalchemy.orm import joinedload

from APP.constants import SubscriptionTier, UserRole
from APP.entities.subscription import SubscriptionEntity
from APP.entities.user import UserEntity
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.models.user import UserModel


class UserRepository(SQLAlchemyRepository[UserModel]):
    model = UserModel

    def to_entity(self, user: UserModel) -> UserEntity:
        sub_entity = None
        if user.subscription:
            sub_entity = self._sub_to_entity(user.subscription)
        return UserEntity(
            id=user.id,
            email=user.email,
            username=user.username,
            role=UserRole(user.role),
            is_verified=user.is_verified,
            is_active=user.is_active,
            created_at=user.created_at,
            updated_at=user.updated_at,
            subscription=sub_entity,
        )

    @staticmethod
    def _sub_to_entity(sub: SubscriptionModel) -> SubscriptionEntity:
        return SubscriptionEntity(
            id=sub.id,
            user_id=sub.user_id,
            tier=SubscriptionTier(sub.tier),
            started_at=sub.started_at,
            expires_at=sub.expires_at,
            granted_by=sub.granted_by,
            is_active=sub.is_active,
            created_at=sub.created_at,
            updated_at=sub.updated_at,
        )

    async def get_by_id(self, user_id: uuid.UUID, for_update: bool = False) -> UserEntity | None:
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(UserModel.id == user_id)
        )
        if for_update:
            query = query.with_for_update()
        user = await self._execute_one_or_none(query)
        return self.to_entity(user) if user else None

    async def get_by_id_basic(self, user_id: uuid.UUID) -> UserEntity | None:
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(UserModel.id == user_id)
        )
        user = await self._execute_one_or_none(query)
        return self.to_entity(user) if user else None

    async def get_by_email(self, email: str) -> UserEntity | None:
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(UserModel.email == email.lower())
        )
        user = await self._execute_one_or_none(query)
        return self.to_entity(user) if user else None

    async def get_by_username(self, username: str) -> UserEntity | None:
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(UserModel.username == username.lower())
        )
        user = await self._execute_one_or_none(query)
        return self.to_entity(user) if user else None

    async def get_by_login(self, login: str) -> UserModel | None:
        """Returns raw model — auth needs password_hash for credential verification."""
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
    ) -> UserEntity:
        user = UserModel(
            email=email.lower(),
            username=username.lower(),
            password_hash=password_hash,
            role=role.value,
        )
        self.session.add(user)
        await self.session.flush()
        await self.session.refresh(user)
        user.subscription = None
        return self.to_entity(user)

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

    async def update_role(self, user_id: uuid.UUID, role: UserRole) -> None:
        query = select(UserModel).where(UserModel.id == user_id).with_for_update()
        user = await self._execute_one_or_none(query)
        if user:
            user.role = role.value
            await self.session.flush()
