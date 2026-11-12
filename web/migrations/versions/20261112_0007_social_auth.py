"""Nullable credentials and persistent single-use social authentication."""
from alembic import op
import sqlalchemy as sa

revision = "0007_social_auth"
down_revision = "0006_subscription_sync"
branch_labels = None
depends_on = None


def timestamps():
    return [sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now())]


def upgrade():
    op.alter_column("users", "email", existing_type=sa.String(255), nullable=True)
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=True)
    op.create_table("social_identities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.UniqueConstraint("provider", "subject", name="uq_social_identity_subject"),
        sa.UniqueConstraint("user_id", "provider", name="uq_social_identity_user_provider"),
        *timestamps())
    op.create_index("ix_social_identities_user_id", "social_identities", ["user_id"])
    op.create_table("social_transactions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("state_hash", sa.String(64), unique=True, nullable=False),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("intent", sa.String(16), nullable=False),
        sa.Column("stage", sa.String(24), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("sessions.id", ondelete="CASCADE")),
        sa.Column("verifier", sa.String(128)),
        sa.Column("callback", sa.String(2048), nullable=False),
        sa.Column("subject", sa.String(255)),
        sa.Column("nonce", sa.String(255), unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        *timestamps())


def downgrade():
    # Refuse rather than invent credentials or destroy social-only accounts.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM users WHERE email IS NULL OR password_hash IS NULL")):
        raise RuntimeError("Cannot downgrade while accounts have optional credentials")
    op.drop_table("social_transactions")
    op.drop_table("social_identities")
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=False)
    op.alter_column("users", "email", existing_type=sa.String(255), nullable=False)
