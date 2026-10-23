"""releases table and users.is_beta_tester

Первая ревизия в проекте: до неё схема наливалась метаданными напрямую,
поэтому здесь нет baseline существующих таблиц — только то, что нужно
апдейтеру. Если позже понадобится автогенерация, `alembic stamp head`
после применения этой ревизии зафиксирует текущее состояние.

Revision ID: 0001_releases_beta
Revises:
Create Date: 2026-09-01
"""

import sqlalchemy as sa
from alembic import op

revision = "0001_releases_beta"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "releases",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column(
            "channel",
            sa.String(length=16),
            nullable=False,
            server_default="stable",
        ),
        sa.Column(
            "target",
            sa.String(length=32),
            nullable=False,
            server_default="windows",
        ),
        sa.Column(
            "arch",
            sa.String(length=32),
            nullable=False,
            server_default="x86_64",
        ),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("signature", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_by", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_releases"),
        sa.UniqueConstraint(
            "version", "target", "arch", name="uq_releases_version_target_arch"
        ),
    )
    op.create_index("ix_releases_version", "releases", ["version"])
    op.create_index("ix_releases_channel", "releases", ["channel"])
    op.create_index("ix_releases_target", "releases", ["target"])
    op.create_index("ix_releases_arch", "releases", ["arch"])

    op.add_column(
        "users",
        sa.Column(
            "is_beta_tester",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Дефолт нужен только чтобы залить колонку на непустой таблице; дальше
    # значение проставляет приложение.
    op.alter_column("users", "is_beta_tester", server_default=None)
    op.create_index("ix_users_is_beta_tester", "users", ["is_beta_tester"])


def downgrade() -> None:
    op.drop_index("ix_users_is_beta_tester", table_name="users")
    op.drop_column("users", "is_beta_tester")

    op.drop_index("ix_releases_arch", table_name="releases")
    op.drop_index("ix_releases_target", table_name="releases")
    op.drop_index("ix_releases_channel", table_name="releases")
    op.drop_index("ix_releases_version", table_name="releases")
    op.drop_table("releases")
