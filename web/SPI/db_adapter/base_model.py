import uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, declared_attr
from sqlalchemy import MetaData, func, Uuid
from datetime import datetime
from APP.config import settings
import re

class Base(DeclarativeBase):
    __abstract__ = True

    metadata = MetaData(
        naming_convention=settings.postgres.naming_conventions)

    @declared_attr.directive
    def __tablename__(cls) -> str:
        name = re.sub(r'Model$', '', cls.__name__)
        name = re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()
        return f"{name}s"

    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
        onupdate=func.now()
    )