"""Converge the April schema with the former May baseline.

Revision ID: 907b2d179318
Revises: a1b2c3d4e5f6
Create Date: 2026-05-01 17:39:05.179109

The former standalone baseline recreated the April tables. Keep its revision ID
so databases already stamped there can upgrade unchanged. New and April-era
installations now traverse one chain; only audit_logs.details differs between
the schemas. Existing SQL NULL details become an empty object before NOT NULL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '907b2d179318'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade April installations without recreating existing tables."""
    op.execute("UPDATE audit_logs SET details = '{}'::json WHERE details IS NULL")
    op.alter_column('audit_logs', 'details', existing_type=sa.JSON(), nullable=False)


def downgrade() -> None:
    """Restore the April schema; normalized empty objects remain intact."""
    op.alter_column('audit_logs', 'details', existing_type=sa.JSON(), nullable=True)
