from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Callable

import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.database.mongodb import get_database
from backend.services.token_service import is_jti_blacklisted
from backend.settings import get_settings

security = HTTPBearer(auto_error=False)


async def get_authenticated_user_id(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> ObjectId:
    if credentials is None:
        request.state.user_id = None
        request.state.user_role = None
        raise HTTPException(status_code=401, detail="Authentication is required")

    token = credentials.credentials

    settings = get_settings()
    secret = settings.jwt_secret_key or "development-secret-change-me"
    algorithm = settings.jwt_algorithm or "HS256"
    try:
        payload = jwt.decode(token, secret, algorithms=[algorithm])
    except (jwt.InvalidTokenError, TypeError, ValueError) as exc:
        request.state.user_id = None
        request.state.user_role = None
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    jti = payload.get("jti")
    if jti and is_jti_blacklisted(jti):
        request.state.user_id = None
        request.state.user_role = None
        raise HTTPException(status_code=401, detail="Token has been revoked")

    user_id = payload.get("sub") or payload.get("user_id")
    if not user_id:
        request.state.user_id = None
        request.state.user_role = None
        raise HTTPException(status_code=401, detail="Token payload is missing user identity")

    try:
        user_obj_id = ObjectId(str(user_id))
    except Exception as exc:
        request.state.user_id = None
        request.state.user_role = None
        raise HTTPException(status_code=401, detail="Invalid user identity in token") from exc

    user_role = payload.get("role", "patient")

    sid = payload.get("sid")
    if sid:
        try:
            database = get_database()
            user_doc = database.users.find_one(
                {"_id": user_obj_id},
                {"active_session_id": 1, "is_active": 1, "session_expires_at": 1},
            )
            if user_doc:
                active_sid = user_doc.get("active_session_id")
                if active_sid and active_sid != sid:
                    request.state.user_id = None
                    request.state.user_role = None
                    raise HTTPException(
                        status_code=401,
                        detail={
                            "error": "SESSION_SUPERSEDED",
                            "message": "You have been signed out because this account session is no longer active.",
                        },
                    )
                else:
                    # Heartbeat: refresh active session validity window while user is active
                    now = datetime.now(timezone.utc)
                    database.users.update_one(
                        {"_id": user_obj_id},
                        {
                            "$set": {
                                "active_session_id": sid,
                                "session_expires_at": now + timedelta(minutes=15),
                            }
                        },
                    )
        except HTTPException:
            raise
        except Exception:
            pass

    request.state.user_id = user_obj_id
    request.state.user_role = user_role
    request.state.auth_token = token
    return user_obj_id


def require_role(allowed_roles: list[str]) -> Callable:
    """Dependency that enforces Role-Based Access Control (RBAC)."""
    async def role_checker(
        request: Request,
        user_id: ObjectId = Depends(get_authenticated_user_id),
    ) -> ObjectId:
        role = getattr(request.state, "user_role", "patient")
        if role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Access forbidden: Insufficient privileges. Required one of {allowed_roles}, got '{role}'",
            )
        return user_id

    return role_checker
