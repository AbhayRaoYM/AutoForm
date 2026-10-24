from __future__ import annotations

from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict

from backend.auth import get_authenticated_user_id
from backend.repositories.profile_repository import ProfileRepository
from backend.security.audit_logger import log_security_event
from backend.security.masking import (
    mask_aadhaar,
    mask_generic_id,
    mask_pan,
    mask_phone,
)

router = APIRouter(
    prefix="/api/profile",
    tags=["profile"],
)

profile_repo = ProfileRepository()


class ProfileResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    user_id: str

    name: str = ""
    first_name: str = ""
    middle_name: str = ""
    last_name: str = ""

    dob: str = ""
    gender: str = ""
    year_of_birth: str = ""
    blood_group: str = ""
    nationality: str = ""

    address: str = ""
    house_number: str = ""
    street: str = ""
    locality: str = ""
    city: str = ""
    state: str = ""
    pincode: str = ""

    phone: str = ""
    phone_masked: str = ""
    email: str = ""
    guardian_name: str = ""
    place_of_birth: str = ""

    aadhaar_number: str = ""
    aadhaar_number_masked: str = ""
    pan_number: str = ""
    pan_number_masked: str = ""
    voter_id: str = ""
    voter_id_masked: str = ""
    passport_number: str = ""
    passport_number_masked: str = ""
    driving_licence_number: str = ""
    driving_licence_number_masked: str = ""
    birth_registration_number: str = ""

    health_insurance: str = ""
    insurance_details: str = ""


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None

    dob: Optional[str] = None
    gender: Optional[str] = None
    year_of_birth: Optional[str] = None
    blood_group: Optional[str] = None
    nationality: Optional[str] = None

    address: Optional[str] = None
    house_number: Optional[str] = None
    street: Optional[str] = None
    locality: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None

    phone: Optional[str] = None
    email: Optional[str] = None
    guardian_name: Optional[str] = None
    place_of_birth: Optional[str] = None

    aadhaar_number: Optional[str] = None
    pan_number: Optional[str] = None
    voter_id: Optional[str] = None
    passport_number: Optional[str] = None
    driving_licence_number: Optional[str] = None
    birth_registration_number: Optional[str] = None

    health_insurance: Optional[str] = None
    insurance_details: Optional[str] = None


def _handle_repository_error(exc: Exception):
    message = str(exc)

    if "not found" in message.lower():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=message,
        ) from exc

    if "cannot be empty" in message.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message,
        ) from exc

    if "unsupported profile field" in message.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message,
        ) from exc

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Unable to modify your profile.",
    ) from exc


def _with_masks(profile: dict | object) -> dict:
    if not isinstance(profile, dict):
        if hasattr(profile, "__dict__"):
            data = dict(profile.__dict__)
        else:
            data = dict(profile)
    else:
        data = dict(profile)

    data["aadhaar_number_masked"] = mask_aadhaar(data.get("aadhaar_number"))
    data["pan_number_masked"] = mask_pan(data.get("pan_number"))
    data["phone_masked"] = mask_phone(data.get("phone"))
    data["voter_id_masked"] = mask_generic_id(data.get("voter_id"))
    data["passport_number_masked"] = mask_generic_id(data.get("passport_number"))
    data["driving_licence_number_masked"] = mask_generic_id(data.get("driving_licence_number"))
    return data


@router.get(
    "/",
    response_model=ProfileResponse,
)
async def get_profile(
    request: Request,
    user_id: ObjectId = Depends(get_authenticated_user_id),
):
    client_ip = request.client.host if request.client else None
    try:
        raw_profile = profile_repo.get_by_user_id(user_id)
        log_security_event(
            action="PROFILE_VIEW",
            user_id=user_id,
            details={"purpose": "view_identity_vault"},
            ip_address=client_ip,
            status="SUCCESS",
        )
        return _with_masks(raw_profile)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load your profile.",
        ) from exc


@router.put(
    "/",
    response_model=ProfileResponse,
)
async def update_profile(
    payload: ProfileUpdate,
    request: Request,
    user_id: ObjectId = Depends(get_authenticated_user_id),
):
    client_ip = request.client.host if request.client else None
    update_data = payload.model_dump(exclude_unset=True)

    if not update_data:
        try:
            return _with_masks(profile_repo.get_by_user_id(user_id))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(exc),
            ) from exc

    try:
        updated = profile_repo.update_by_user_id(
            user_id=user_id,
            profile_data=update_data,
        )
        log_security_event(
            action="PROFILE_UPDATE",
            user_id=user_id,
            details={"updated_fields": list(update_data.keys())},
            ip_address=client_ip,
            status="SUCCESS",
        )
        return _with_masks(updated)
    except Exception as exc:
        _handle_repository_error(exc)


@router.delete(
    "/{field_name}",
    response_model=ProfileResponse,
)
async def delete_profile_field(
    field_name: str,
    request: Request,
    user_id: ObjectId = Depends(get_authenticated_user_id),
):
    client_ip = request.client.host if request.client else None
    try:
        res = profile_repo.delete_field(
            user_id=user_id,
            field_name=field_name,
        )
        log_security_event(
            action="PROFILE_FIELD_DELETE",
            user_id=user_id,
            details={"field_name": field_name},
            ip_address=client_ip,
            status="SUCCESS",
        )
        return _with_masks(res)
    except Exception as exc:
        _handle_repository_error(exc)


@router.delete(
    "/",
)
async def delete_entire_profile(
    request: Request,
    user_id: ObjectId = Depends(get_authenticated_user_id),
):
    client_ip = request.client.host if request.client else None
    try:
        profile_repo.delete_profile(user_id)
        log_security_event(
            action="PROFILE_DELETE_ALL",
            user_id=user_id,
            ip_address=client_ip,
            status="SUCCESS",
        )
        return {
            "status": "success",
            "message": "Identity profile deleted successfully.",
        }
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to delete your profile.",
        ) from exc
