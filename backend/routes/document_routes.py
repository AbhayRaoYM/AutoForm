from __future__ import annotations

from pathlib import Path

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.auth import get_authenticated_user_id
from backend.dependencies import get_extraction_service
from backend.document_extraction.gemini_service import GeminiExtractionService
from backend.document_extraction.schemas import ExtractionResponse
from backend.security.audit_logger import log_security_event
from backend.services.document_service import persist_extraction
from backend.utils.secure_files import temporary_upload_file

router = APIRouter(
    prefix="/api/documents",
    tags=["documents"],
)

ALLOWED_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


class ConsentRequest(BaseModel):
    consent_given: bool
    extraction: dict


@router.post(
    "/extract",
    response_model=ExtractionResponse,
)
async def extract_document(
    request: Request,
    file: UploadFile = File(...),
    service: GeminiExtractionService = Depends(
        get_extraction_service
    ),
    user_id: ObjectId = Depends(get_authenticated_user_id),
) -> ExtractionResponse:
    client_ip = request.client.host if request.client else None
    filename = file.filename or "document"
    suffix = Path(filename).suffix.lower()

    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type: "
                f"{suffix or 'unknown'}. "
                "Allowed: pdf, jpg, jpeg, png"
            ),
        )

    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(
                status_code=400,
                detail="Uploaded file is empty",
            )

        with temporary_upload_file(contents, suffix=suffix) as temp_path:
            result = service.extract_document(
                temp_path,
                ALLOWED_EXTENSIONS[suffix],
            )

        log_security_event(
            action="DOCUMENT_EXTRACT",
            user_id=user_id,
            details={"filename_ext": suffix, "doc_type": result.document_type},
            ip_address=client_ip,
            status="SUCCESS",
        )

        response_data = result.model_dump(mode="json")
        return JSONResponse(content=response_data)

    except HTTPException:
        raise
    except Exception as exc:
        log_security_event(
            action="DOCUMENT_EXTRACT_FAILED",
            user_id=user_id,
            details={"error": str(exc)},
            ip_address=client_ip,
            status="FAILURE",
        )
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc


def convert_extraction_for_persistence(
    extraction: dict,
) -> dict:
    if not isinstance(extraction, dict):
        raise ValueError("Extraction must be an object.")

    document_type = extraction.get("document_type")
    if not document_type:
        raise ValueError("Missing document_type in extraction.")

    document_type = str(document_type).strip().lower()

    allowed_document_types = {
        "aadhaar",
        "pan_card",
        "passport",
        "driving_licence",
        "voter_id",
        "birth_certificate",
        "health_insurance_card",
        "form_scan",
        "other",
    }

    if document_type not in allowed_document_types:
        raise ValueError(
            f"Unsupported document_type: {document_type}"
        )

    overall_confidence = extraction.get(
        "overall_confidence",
        extraction.get("confidence_score", 0.0),
    )

    try:
        confidence_score = float(overall_confidence)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "overall_confidence must be numeric."
        ) from exc

    extracted_fields = extraction.get(
        "extracted_fields",
        {},
    )

    if not isinstance(extracted_fields, dict):
        raise ValueError(
            "extracted_fields must be an object."
        )

    result = {
        "document_type": document_type,
        "confidence_score": confidence_score,
        "confidence_reason": extraction.get("confidence_reason", []),
    }

    for field_name, field_data in extracted_fields.items():
        if isinstance(field_data, dict):
            value = field_data.get("value")
        else:
            value = field_data

        result[field_name] = {
            "value": value,
        }

    return result


@router.post("/consent")
async def save_after_consent(
    request: Request,
    payload: ConsentRequest,
    user_id: ObjectId = Depends(get_authenticated_user_id),
):
    client_ip = request.client.host if request.client else None

    if payload.consent_given is not True:
        raise HTTPException(
            status_code=400,
            detail="Explicit consent is required before saving.",
        )

    if not payload.extraction:
        raise HTTPException(
            status_code=400,
            detail="No extracted information was provided.",
        )

    try:
        persistence_data = convert_extraction_for_persistence(
            payload.extraction
        )

        persist_extraction(
            user_id,
            persistence_data,
        )

        log_security_event(
            action="DOCUMENT_CONSENT_PERSISTED",
            user_id=user_id,
            details={"doc_type": persistence_data.get("document_type")},
            ip_address=client_ip,
            status="SUCCESS",
        )

        return {
            "success": True,
            "message": "Extracted information saved successfully into encrypted profile.",
        }

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        log_security_event(
            action="DOCUMENT_CONSENT_FAILED",
            user_id=user_id,
            details={"error": str(exc)},
            ip_address=client_ip,
            status="FAILURE",
        )
        raise HTTPException(
            status_code=500,
            detail="Unable to save extracted information.",
        ) from exc
