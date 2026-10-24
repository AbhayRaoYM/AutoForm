from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from bson import ObjectId
from fastapi import HTTPException

from backend.database.mongodb import get_database
from backend.repositories.patient_profiles import initialize_patient_profile
from backend.security.audit_logger import log_security_event
from backend.security.encryption import encrypt_text
from backend.security.hmac_utils import normalize_phone_number, tokenise
from backend.services.token_service import (
    blacklist_token,
    create_token_pair,
)
from backend.settings import get_settings

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 15


def create_access_token(
    user_id: str | ObjectId,
    role: str = "patient",
    expires_minutes: int = 15,
) -> str:
    """Generates a standalone access token (backwards compatibility)."""
    settings = get_settings()
    secret = settings.jwt_secret_key or "development-secret-change-me"
    algorithm = settings.jwt_algorithm or "HS256"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    payload = {"sub": str(user_id), "role": str(role or "patient"), "type": "access", "exp": expires_at}
    return jwt.encode(payload, secret, algorithm=algorithm)


PASSWORD_REGEX = re.compile(
    r"^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$"
)


def register_user(
    phone: str,
    password: str,
    consent_given: bool = False,
    ip_address: str | None = None,
) -> ObjectId:
    if not phone or not password:
        raise ValueError("Phone and password are required")

    if not PASSWORD_REGEX.match(password):
        missing = []
        if len(password) < 8:
            missing.append("8+ characters")
        if not re.search(r"[A-Z]", password):
            missing.append("1 uppercase letter")
        if not re.search(r"\d", password):
            missing.append("1 number")
        if not re.search(r"[!@#$%^&*]", password):
            missing.append("1 symbol (!@#$%^&*)")
        raise ValueError(f"Password needs: {', '.join(missing)}")

    normalized_phone = normalize_phone_number(phone)
    if not normalized_phone:
        raise ValueError("Enter a valid 10-digit phone number")
    phone_hash = tokenise(normalized_phone)
    database = get_database()

    if database.users.find_one({"phone_hash": phone_hash}):
        log_security_event(
            action="REGISTRATION_FAILED_DUPLICATE",
            details={"phone_hash": phone_hash},
            ip_address=ip_address,
            status="FAILURE",
        )
        raise ValueError("A user with this phone number already exists")

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    now = datetime.now(timezone.utc)
    user_record = {
        "phone_hash": phone_hash,
        "phone_enc": encrypt_text(normalized_phone),
        "password_hash": password_hash,
        "role": "patient",
        "consent_given": bool(consent_given),
        "consent_timestamp": now,
        "is_active": True,
        "failed_login_attempts": 0,
        "locked_until": None,
        "last_login_at": None,
        "created_at": now,
        "updated_at": now,
    }
    user_record["_id"] = ObjectId()
    result = database.users.insert_one(user_record)
    user_id = result.inserted_id or user_record["_id"]

    try:
        initialize_patient_profile(user_id, normalized_phone)
    except Exception:
        database.users.delete_one({"_id": user_id})
        raise

    log_security_event(
        action="USER_REGISTERED",
        user_id=user_id,
        details={"role": "patient", "consent_given": consent_given},
        ip_address=ip_address,
        status="SUCCESS",
    )
    return user_id


def login_user(
    phone: str,
    password: str,
    ip_address: str | None = None,
) -> dict[str, Any] | str:
    if not phone or not password:
        raise HTTPException(status_code=401, detail="Phone and password are required")

    normalized_phone = normalize_phone_number(phone)
    if not normalized_phone:
        raise HTTPException(
            status_code=401,
            detail="Invalid phone or password",
        )
    phone_hash = tokenise(normalized_phone)
    database = get_database()
    user = database.users.find_one({"phone_hash": phone_hash})
    if user is None:
        log_security_event(
            action="LOGIN_FAILED_NOT_FOUND",
            ip_address=ip_address,
            status="FAILURE",
        )
        raise HTTPException(status_code=401, detail="Invalid phone or password")

    user_id = user.get("_id")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid phone or password")

    now = datetime.now(timezone.utc)

    # 1. Check account lockout state
    locked_until = user.get("locked_until")
    if locked_until:
        if isinstance(locked_until, datetime):
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
        if locked_until > now:
            remaining_seconds = max(1, int((locked_until - now).total_seconds()))
            remaining_mins = max(1, (remaining_seconds + 59) // 60)
            log_security_event(
                action="LOGIN_BLOCKED_LOCKED",
                user_id=user_id,
                details={"remaining_seconds": remaining_seconds},
                ip_address=ip_address,
                status="FAILURE",
            )
            raise HTTPException(
                status_code=423,
                detail={
                    "message": f"Account temporarily locked due to multiple failed login attempts. Try again in {remaining_mins} minutes.",
                    "locked": True,
                    "remaining_seconds": remaining_seconds,
                },
            )

    stored_hash = user.get("password_hash")
    if not isinstance(stored_hash, str):
        raise HTTPException(status_code=401, detail="Invalid phone or password")

    # 2. Validate password
    is_valid = bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
    if not is_valid:
        failed_count = int(user.get("failed_login_attempts", 0)) + 1
        update_doc: dict[str, Any] = {"failed_login_attempts": failed_count, "updated_at": now}

        if failed_count >= MAX_FAILED_ATTEMPTS:
            lockout_expiry = now + timedelta(minutes=LOCKOUT_DURATION_MINUTES)
            update_doc["locked_until"] = lockout_expiry
            database.users.update_one({"_id": user_id}, {"$set": update_doc})

            log_security_event(
                action="ACCOUNT_LOCKED",
                user_id=user_id,
                details={"failed_attempts": failed_count, "lockout_minutes": LOCKOUT_DURATION_MINUTES},
                ip_address=ip_address,
                status="FAILURE",
            )
            raise HTTPException(
                status_code=423,
                detail={
                    "message": f"Too many failed attempts. Account locked for {LOCKOUT_DURATION_MINUTES} minutes.",
                    "locked": True,
                    "remaining_seconds": LOCKOUT_DURATION_MINUTES * 60,
                },
            )

        database.users.update_one({"_id": user_id}, {"$set": update_doc})
        attempts_left = max(0, MAX_FAILED_ATTEMPTS - failed_count)

        log_security_event(
            action="LOGIN_FAILED_PASSWORD",
            user_id=user_id,
            details={"failed_attempts": failed_count, "attempts_left": attempts_left},
            ip_address=ip_address,
            status="FAILURE",
        )
        raise HTTPException(
            status_code=401,
            detail={
                "message": "Invalid phone or password",
                "attempts_left": attempts_left,
                "failed_attempts": failed_count,
            },
        )

    # 3. Strict Concurrent Login Prevention (First-Login-Wins Lock)
    active_sid = user.get("active_session_id")
    session_expires_at = user.get("session_expires_at")

    is_session_active = False
    if active_sid:
        if session_expires_at is None:
            is_session_active = True
        elif isinstance(session_expires_at, datetime):
            if session_expires_at.tzinfo is None:
                session_expires_at = session_expires_at.replace(tzinfo=timezone.utc)
            if session_expires_at > now:
                is_session_active = True

    if is_session_active:
        log_security_event(
            action="LOGIN_BLOCKED_ACTIVE_SESSION",
            user_id=user_id,
            details={"reason": "Login blocked because account is currently active on another device or platform"},
            ip_address=ip_address,
            status="FAILURE",
        )
        raise HTTPException(
            status_code=409,
            detail={
                "error": "CONCURRENT_SESSION_BLOCKED",
                "message": "This account is currently active on another device or platform. Please sign out from that device first or wait for session inactivity.",
            },
        )

    # 4. Successful authentication - claim the active session lock
    new_session_id = str(uuid.uuid4())
    session_expires = now + timedelta(minutes=15)

    database.users.update_one(
        {"_id": user_id},
        {
            "$set": {
                "failed_login_attempts": 0,
                "locked_until": None,
                "last_login_at": now,
                "active_session_id": new_session_id,
                "session_expires_at": session_expires,
                "updated_at": now,
            }
        },
    )

    role = user.get("role", "patient")

    log_security_event(
        action="LOGIN_SUCCESS",
        user_id=user_id,
        details={"role": role, "session_id": new_session_id},
        ip_address=ip_address,
        status="SUCCESS",
    )

    return create_token_pair(user_id, role=role, session_id=new_session_id)


def logout_user(
    token: str | None,
    user_id: ObjectId | str | None = None,
    ip_address: str | None = None,
) -> bool:
    """Revokes the current token via blacklisting, frees the active session lock, and records an audit log entry."""
    success = False
    if token:
        success = blacklist_token(token)

    if user_id:
        try:
            database = get_database()
            database.users.update_one(
                {"_id": ObjectId(str(user_id))},
                {"$set": {"active_session_id": None, "session_expires_at": None}},
            )
        except Exception:
            pass

    log_security_event(
        action="LOGOUT",
        user_id=user_id,
        ip_address=ip_address,
        status="SUCCESS" if success else "PARTIAL",
    )
    return success
