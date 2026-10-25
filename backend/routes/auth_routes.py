from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.auth import get_authenticated_user_id
from backend.database.mongodb import get_database
from backend.security.audit_logger import get_user_security_activity, log_security_event
from backend.services.auth_service import login_user, logout_user, register_user
from backend.services.token_service import (
    blacklist_token,
    create_token_pair,
    verify_refresh_token,
)

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    phone: str
    password: str
    consent_given: bool = False


class LoginRequest(BaseModel):
    phone: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class PageVisitRequest(BaseModel):
    page: str


@router.post("/register", status_code=201)
@limiter.limit("3/minute")
async def register(request: Request, payload: RegisterRequest) -> dict[str, str]:
    client_ip = request.client.host if request.client else None
    try:
        user_id = register_user(
            payload.phone,
            payload.password,
            payload.consent_given,
            ip_address=client_ip,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"user_id": str(user_id), "message": "User registered successfully"}


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest) -> dict[str, object]:
    client_ip = request.client.host if request.client else None
    try:
        result = login_user(payload.phone, payload.password, ip_address=client_ip)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    if isinstance(result, str):
        return {"access_token": result, "token_type": "bearer"}
    return result


@router.post("/refresh")
@limiter.limit("10/minute")
async def refresh_tokens(request: Request, payload: RefreshRequest) -> dict[str, object]:
    try:
        token_data = verify_refresh_token(payload.refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user_id = token_data.get("sub")
    role = token_data.get("role", "patient")
    sid = token_data.get("sid")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    if sid:
        database = get_database()
        user_doc = database.users.find_one({"_id": ObjectId(str(user_id))}, {"active_session_id": 1})
        if user_doc:
            active_sid = user_doc.get("active_session_id")
            if active_sid and active_sid != sid:
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error": "SESSION_SUPERSEDED",
                        "message": "You have been signed out because this account was logged in from another device or browser.",
                    },
                )

    # Invalidate old refresh token (token rotation)
    blacklist_token(payload.refresh_token)

    # Issue fresh token pair preserving the active session_id
    return create_token_pair(user_id, role=role, session_id=sid)


@router.post("/logout")
async def logout(
    request: Request,
    user_id: ObjectId = Depends(get_authenticated_user_id),
) -> dict[str, str]:
    client_ip = request.client.host if request.client else None
    auth_token = getattr(request.state, "auth_token", None)
    logout_user(auth_token, user_id=user_id, ip_address=client_ip)
    return {"message": "Logged out successfully and session revoked"}


@router.get("/security/activity")
async def security_activity(
    limit: int = 100,
    user_id: ObjectId = Depends(get_authenticated_user_id),
) -> dict[str, object]:
    return get_user_security_activity(user_id, limit=limit)


@router.post("/security/log-visit")
async def log_page_visit(
    request: Request,
    payload: PageVisitRequest,
    user_id: ObjectId = Depends(get_authenticated_user_id),
) -> dict[str, str]:
    client_ip = request.client.host if request.client else None
    page_key = payload.page.strip().lower()
    action_map = {
        "dashboard": "DASHBOARD_VIEW",
        "documents": "DOCUMENTS_PAGE_VIEW",
        "upload": "DOCUMENTS_PAGE_VIEW",
        "autofill": "FORMS_PAGE_VIEW",
        "forms": "FORMS_PAGE_VIEW",
        "profile": "PROFILE_VIEW",
        "activity": "SECURITY_ACTIVITY_VIEW",
        "admin": "ADMIN_CONSOLE_VIEW",
    }
    action = action_map.get(page_key, f"{page_key.upper()}_PAGE_VIEW")
    log_security_event(
        action=action,
        user_id=user_id,
        details={"page": page_key},
        ip_address=client_ip,
        status="SUCCESS",
    )
    return {"status": "ok", "action": action}
