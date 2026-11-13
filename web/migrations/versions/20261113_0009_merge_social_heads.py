"""Merge the deployed empty revision with the social-auth migration chain.

Revision ID: 0009_merge_social_heads
Revises: 0008_maintenance_notice, 19d9deeb5239

The empty revision was created and applied on the server before social auth.
Preserve its identity so existing databases and clean installs share one head.
This merge changes Alembic version bookkeeping only, not application schema.
"""

revision = "0009_merge_social_heads"
down_revision = ("0008_maintenance_notice", "19d9deeb5239")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
