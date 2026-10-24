"""crash_groups and crash_reports

Revision ID: 0003_crash_reports
Revises: 0002_locale_changelog
Create Date: 2026-10-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0003_crash_reports'
down_revision: Union[str, Sequence[str], None] = '0002_locale_changelog'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('crash_groups',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('fingerprint', sa.Text(), nullable=False),
    sa.Column('error_code', sa.String(length=32), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='new', nullable=False),
    sa.Column('resolved_in_version', sa.String(length=64), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('first_seen', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_seen', sa.DateTime(timezone=True), nullable=False),
    sa.Column('report_count', sa.Integer(), server_default='1', nullable=False),
    sa.Column('last_app_version', sa.String(length=64), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('new', 'in_progress', 'resolved')", name=op.f('ck_crash_groups_status')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_crash_groups')),
    sa.UniqueConstraint('fingerprint', name=op.f('uq_crash_groups_fingerprint'))
    )
    op.create_index(op.f('ix_crash_groups_error_code'), 'crash_groups', ['error_code'], unique=False)
    op.create_index('ix_crash_groups_status_last_seen', 'crash_groups', ['status', 'last_seen'], unique=False)
    op.create_table('crash_reports',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('report_id', sa.Uuid(), nullable=False),
    sa.Column('group_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('install_id', sa.Uuid(), nullable=False),
    sa.Column('app_version', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('error_code', sa.String(length=32), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ip_hash', sa.String(length=64), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('symbolicated', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['group_id'], ['crash_groups.id'], name=op.f('fk_crash_reports_group_id_crash_groups'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_crash_reports_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_crash_reports')),
    sa.UniqueConstraint('report_id', name=op.f('uq_crash_reports_report_id'))
    )
    op.create_index('ix_crash_reports_group_id_received_at', 'crash_reports', ['group_id', 'received_at'], unique=False)
    op.create_index(op.f('ix_crash_reports_received_at'), 'crash_reports', ['received_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_crash_reports_received_at'), table_name='crash_reports')
    op.drop_index('ix_crash_reports_group_id_received_at', table_name='crash_reports')
    op.drop_table('crash_reports')
    op.drop_index('ix_crash_groups_status_last_seen', table_name='crash_groups')
    op.drop_index(op.f('ix_crash_groups_error_code'), table_name='crash_groups')
    op.drop_table('crash_groups')
