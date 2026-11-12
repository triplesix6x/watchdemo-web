"""Persist the singleton informational site notice.

Revision ID: 0008_maintenance_notice
Revises: 0007_social_auth
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_maintenance_notice"
down_revision = "0007_social_auth"
branch_labels = None
depends_on = None


def upgrade():
    table = op.create_table(
        "maintenance_notices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("text_ru", sa.String(500), nullable=False, server_default=""),
        sa.Column("text_en", sa.String(500), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("id = 1", name="maintenance_notice_singleton"),
        sa.CheckConstraint("NOT enabled OR length(trim(text_ru)) > 0", name="maintenance_notice_russian"),
    )
    op.bulk_insert(table, [{"id": 1, "enabled": False, "text_ru": "", "text_en": ""}])


def downgrade():
    op.drop_table("maintenance_notices")
