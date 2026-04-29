from API.views.auth.schemas import UserResponse, SubscriptionResponse

def build_user_response(user) -> UserResponse:
    sub = None
    if user.subscription:
        s = user.subscription
        sub = SubscriptionResponse(
            tier=s.tier,
            effective_tier=s.effective_tier,
            expires_at=s.expires_at,
            is_expired=s.is_expired,
        )
    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_verified=user.is_verified,
        subscription=sub,
    )
