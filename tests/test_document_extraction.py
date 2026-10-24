from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from bson import Binary, ObjectId
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import app
from backend.document_extraction.gemini_service import GeminiExtractionService
from backend.repositories.patient_profiles import build_profile_update
from backend.repositories.source_documents import redact_sensitive_extraction
from backend.security.masking import (
    mask_aadhaar,
    mask_generic_id,
    mask_pan,
    mask_phone,
    mask_profile_data,
)
from backend.services.auth_service import login_user, register_user
from backend.services.token_service import (
    blacklist_token,
    create_token_pair,
    verify_refresh_token,
)
from backend.utils.secure_files import temporary_upload_file


@pytest.fixture
def service() -> GeminiExtractionService:
    settings = SimpleNamespace(
        gemini_api_key="test-key",
        gemini_model="gemini-2.5-flash",
        gemini_api_version="v1alpha",
        upload_dir=Path("/tmp/test_uploads"),
        results_dir=Path("/tmp/test_results"),
    )
    return GeminiExtractionService(settings)


def _make_payload(document_type: str, field_name: str, value: str, confidence: float = 0.99):
    return {
        "status": "success",
        "document_type": document_type,
        "overall_confidence": confidence,
        "extracted_fields": {
            field_name: {"value": value, "confidence": confidence},
        },
    }


def test_aadhaar_response_normalization(service):
    result = service._normalize_payload(_make_payload("aadhaar", "full_name", "Muthukumaran L"))
    assert result["status"] == "success"
    assert result["document_type"] == "aadhaar"
    assert result["extracted_fields"]["full_name"]["value"] == "Muthukumaran L"
    assert result["extracted_fields"]["full_name"]["confidence"] == 0.99


def test_pan_response_normalization(service):
    result = service._normalize_payload(_make_payload("pan_card", "pan_number", "ABCDE1234F"))
    assert result["status"] == "success"
    assert result["document_type"] == "pan_card"
    assert result["extracted_fields"]["pan_number"]["value"] == "ABCDE1234F"


def test_passport_response_normalization(service):
    result = service._normalize_payload(_make_payload("passport", "passport_number", "P1234567"))
    assert result["status"] == "success"
    assert result["document_type"] == "passport"
    assert result["extracted_fields"]["passport_number"]["value"] == "P1234567"


def test_driving_licence_response_normalization(service):
    result = service._normalize_payload(_make_payload("driving_licence", "driving_licence_number", "DL-123456"))
    assert result["status"] == "success"
    assert result["document_type"] == "driving_licence"
    assert result["extracted_fields"]["driving_licence_number"]["value"] == "DL-123456"


def test_voter_id_response_normalization(service):
    result = service._normalize_payload(_make_payload("voter_id", "epic_number", "AB1234567"))
    assert result["status"] == "success"
    assert result["document_type"] == "voter_id"
    assert result["extracted_fields"]["epic_number"]["value"] == "AB1234567"


def test_birth_certificate_response_normalization(service):
    result = service._normalize_payload(_make_payload("birth_certificate", "child_full_name", "Ananya S"))
    assert result["status"] == "success"
    assert result["document_type"] == "birth_certificate"
    assert result["extracted_fields"]["child_full_name"]["value"] == "Ananya S"


def test_health_insurance_card_response_normalization(service):
    result = service._normalize_payload(_make_payload("health_insurance_card", "policy_number", "POL-998877"))
    assert result["status"] == "success"
    assert result["document_type"] == "health_insurance_card"
    assert result["extracted_fields"]["policy_number"]["value"] == "POL-998877"


def test_unknown_document_handling(service):
    result = service._normalize_payload({
        "status": "success",
        "document_type": "unknown",
        "overall_confidence": 0.0,
        "extracted_fields": {},
    })
    assert result["status"] == "error"
    assert result["document_type"] == "unknown"
    assert result["extracted_fields"] == {}


def test_invalid_malformed_extraction_response(service):
    with pytest.raises(ValueError):
        service._normalize_payload({
            "status": "success",
            "document_type": "aadhaar",
            "overall_confidence": 0.8,
            "extracted_fields": "not-a-dict",
        })


def test_missing_fields_are_null_and_zero_confidence(service):
    payload = {
        "status": "success",
        "document_type": "aadhaar",
        "overall_confidence": 0.91,
        "extracted_fields": {
            "full_name": {"value": "Muthu", "confidence": 0.95},
            "date_of_birth": None,
        },
    }
    result = service._normalize_payload(payload)
    assert result["extracted_fields"]["full_name"]["value"] == "Muthu"
    assert result["extracted_fields"]["date_of_birth"]["value"] is None
    assert result["extracted_fields"]["date_of_birth"]["confidence"] == 0.0


def test_field_level_and_overall_confidence(service):
    result = service._normalize_payload({
        "status": "success",
        "document_type": "pan_card",
        "overall_confidence": 0.87,
        "extracted_fields": {
            "full_name": {"value": "Asha K", "confidence": 0.92},
            "father_name": {"value": "Kumar", "confidence": 0.78},
            "date_of_birth": {"value": "04/05/1990", "confidence": 0.88},
            "pan_number": {"value": "ABCDE1234F", "confidence": 0.97},
        },
    })
    assert result["overall_confidence"] == 0.87
    assert result["extracted_fields"]["pan_number"]["confidence"] == 0.97
    assert result["extracted_fields"]["father_name"]["confidence"] == 0.78


def test_patient_profile_update_encrypts_and_tokens_identifiers():
    fields = {
        "full_name": {"value": "Ananya Sharma", "confidence": 0.99},
        "date_of_birth": {"value": "12/06/1999", "confidence": 0.98},
        "address": {"value": "24 Main Street", "confidence": 0.93},
        "father_name": {"value": "Ravi Sharma", "confidence": 0.9},
        "place_of_birth": {"value": "Chennai", "confidence": 0.92},
        "gender": {"value": "FEMALE", "confidence": 0.99},
        "aadhaar_number": {"value": "123456789012", "confidence": 0.98},
        "pan_number": {"value": "ABCDE1234F", "confidence": 0.99},
        "epic_number": {"value": "ZBC3635570", "confidence": 0.98},
        "driving_licence_number": {"value": "DL123456", "confidence": 0.97},
        "passport_number": {"value": "P1234567", "confidence": 0.96},
        "registration_number": {"value": "BR-1001", "confidence": 0.95},
        "member_id": {"value": "MEM-7788", "confidence": 0.94},
    }

    result = build_profile_update(fields, SimpleNamespace(id=ObjectId()))

    assert isinstance(result["name_enc"], Binary)
    assert isinstance(result["dob_enc"], Binary)
    assert isinstance(result["address_enc"], Binary)
    assert isinstance(result["guardian_name_enc"], Binary)
    assert isinstance(result["place_of_birth_enc"], Binary)
    assert isinstance(result["aadhaar_enc"], Binary)
    assert isinstance(result["pan_enc"], Binary)
    assert isinstance(result["voter_id_enc"], Binary)
    assert isinstance(result["driving_licence_enc"], Binary)
    assert isinstance(result["passport_enc"], Binary)
    assert isinstance(result["birth_reg_enc"], Binary)
    assert isinstance(result["health_insurance_enc"], Binary)
    assert result["aadhaar_token"]
    assert result["pan_token"]
    assert result["voter_id_token"]
    assert result["driving_licence_token"]
    assert result["passport_token"]
    assert result["birth_reg_token"]
    assert result["health_insurance_token"]
    assert result["gender"] == "FEMALE"


def test_source_document_redaction_hides_plaintext_sensitive_identifiers():
    payload = {
        "document_type": "aadhaar",
        "overall_confidence": 0.97,
        "extracted_fields": {
            "full_name": {"value": "Ananya Sharma", "confidence": 0.99},
            "aadhaar_number": {"value": "123456789012", "confidence": 0.98},
            "address": {"value": "24 Main Street", "confidence": 0.93},
        },
    }

    sanitized = redact_sensitive_extraction(payload)

    assert sanitized["extracted_fields"]["full_name"]["value"] == "Ananya Sharma"
    assert sanitized["extracted_fields"]["aadhaar_number"]["value"] is None
    assert sanitized["extracted_fields"]["address"]["value"] == "24 Main Street"


@pytest.mark.parametrize(
    ("raw_value", "expected"),
    [
        ("Male", "MALE"),
        ("male", "MALE"),
        ("M", "MALE"),
        ("Female", "FEMALE"),
        ("female", "FEMALE"),
        ("F", "FEMALE"),
        ("Other", "OTHER"),
        ("other", "OTHER"),
        ("Not specified", "Not specified"),
    ],
)
def test_gender_values_are_normalized_for_patient_profile(raw_value, expected):
    fields = {"gender": {"value": raw_value, "confidence": 0.99}}
    result = build_profile_update(fields, SimpleNamespace(id=ObjectId()))
    assert result["gender"] == expected


def test_missing_gender_value_does_not_update_profile():
    fields = {"gender": {"value": None, "confidence": 0.0}}
    result = build_profile_update(fields, SimpleNamespace(id=ObjectId()))
    assert "gender" not in result


# =========================================================================
# SECURITY FEATURE TESTS: Masking, Lockout, Token Blacklist, Headers
# =========================================================================

def test_aadhaar_and_sensitive_masking_utility():
    assert mask_aadhaar("123456789012") == "XXXX-XXXX-9012"
    assert mask_aadhaar("1234 5678 9012") == "XXXX-XXXX-9012"
    assert mask_aadhaar("") == ""

    assert mask_pan("ABCDE1234F") == "XXXXX1234F"
    assert mask_phone("+919876543210") == "XXXXXX3210"
    assert mask_generic_id("ZBC1234567") == "XXXXXX4567"

    profile = {
        "aadhaar_number": "123456789012",
        "pan_number": "ABCDE1234F",
        "phone": "9876543210",
        "voter_id": "ABC1234567",
    }
    masked = mask_profile_data(profile)
    assert masked["aadhaar_number_masked"] == "XXXX-XXXX-9012"
    assert masked["pan_number_masked"] == "XXXXX1234F"
    assert masked["phone_masked"] == "XXXXXX3210"


def test_secure_temporary_file_cleanup():
    dummy_data = b"confidential document contents"
    file_path = None
    with temporary_upload_file(dummy_data, suffix=".pdf") as path:
        file_path = path
        assert file_path.exists()
        assert file_path.read_bytes() == dummy_data

    # File must be guaranteed deleted outside the context
    assert not file_path.exists()


def test_token_pair_and_revocation(monkeypatch):
    test_secret = "12345678901234567890123456789012"
    monkeypatch.setattr("backend.services.token_service.get_settings", lambda: SimpleNamespace(jwt_secret_key=test_secret, jwt_algorithm="HS256"))

    class FakeBlacklistCollection:
        def __init__(self):
            self.store = {}

        def find_one(self, query):
            jti = query.get("jti")
            return self.store.get(jti)

        def update_one(self, query, update, upsert=False):
            jti = query.get("jti")
            self.store[jti] = update.get("$set", {})
            return SimpleNamespace(matched_count=1)

    fake_blacklist = FakeBlacklistCollection()
    fake_db = SimpleNamespace(token_blacklist=fake_blacklist)
    monkeypatch.setattr("backend.services.token_service.get_database", lambda: fake_db)

    user_id = ObjectId()
    tokens = create_token_pair(user_id)
    assert "access_token" in tokens
    assert "refresh_token" in tokens

    # Verify refresh token
    payload = verify_refresh_token(tokens["refresh_token"])
    assert payload["sub"] == str(user_id)
    assert payload["type"] == "refresh"

    # Revoke / Blacklist token
    revoked = blacklist_token(tokens["refresh_token"])
    assert revoked is True

    # After revocation, verifying refresh token should raise
    with pytest.raises(ValueError, match="revoked"):
        verify_refresh_token(tokens["refresh_token"])


def test_account_lockout_after_consecutive_failed_logins(monkeypatch):
    class FakeUsersCollection:
        def __init__(self):
            self.users = {}

        def find_one(self, query):
            phone_hash = query.get("phone_hash")
            return self.users.get(phone_hash)

        def insert_one(self, doc):
            doc["_id"] = ObjectId()
            self.users[doc["phone_hash"]] = doc
            return SimpleNamespace(inserted_id=doc["_id"])

        def update_one(self, query, update):
            for user in self.users.values():
                if user["_id"] == query.get("_id"):
                    user.update(update.get("$set", {}))

    class FakeAuditCollection:
        def __init__(self):
            self.events = []

        def insert_one(self, doc):
            self.events.append(doc)

        def find(self, *args, **kwargs):
            return SimpleNamespace(sort=lambda *a: SimpleNamespace(limit=lambda *b: self.events))

    fake_users = FakeUsersCollection()
    fake_audit = FakeAuditCollection()
    fake_db = SimpleNamespace(users=fake_users, audit_logs=fake_audit, token_blacklist=SimpleNamespace(find_one=lambda q: None, update_one=lambda *a, **k: None))

    test_settings = SimpleNamespace(
        jwt_secret_key="12345678901234567890123456789012",
        jwt_algorithm="HS256",
        hmac_salt_secret="secret-salt-12345",
        local_aes_secret_key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    )

    monkeypatch.setattr("backend.services.auth_service.get_database", lambda: fake_db)
    monkeypatch.setattr("backend.services.auth_service.get_settings", lambda: test_settings)
    monkeypatch.setattr("backend.services.token_service.get_database", lambda: fake_db)
    monkeypatch.setattr("backend.services.token_service.get_settings", lambda: test_settings)
    monkeypatch.setattr("backend.security.hmac_utils.get_settings", lambda: test_settings)
    monkeypatch.setattr("backend.security.encryption.get_settings", lambda: test_settings)
    monkeypatch.setattr("backend.security.audit_logger.get_database", lambda: fake_db)

    # Register user
    user_id = register_user("+919123456789", "correct-password-123", True)
    assert user_id is not None

    # Fail login 4 times (under threshold of 5)
    for i in range(4):
        with pytest.raises(HTTPException) as exc_info:
            login_user("+919123456789", "wrong-password")
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail["attempts_left"] == 4 - i

    # 5th failed attempt -> Must trigger HTTP 423 Locked
    with pytest.raises(HTTPException) as exc_info:
        login_user("+919123456789", "wrong-password")
    assert exc_info.value.status_code == 423
    assert exc_info.value.detail["locked"] is True
    assert exc_info.value.detail["remaining_seconds"] > 0

    # Any subsequent attempt while locked must immediately return HTTP 423
    with pytest.raises(HTTPException) as exc_info:
        login_user("+919123456789", "correct-password-123")
    assert exc_info.value.status_code == 423


def test_security_headers_middleware_present():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert "Strict-Transport-Security" in response.headers
    assert "Content-Security-Policy" in response.headers


def test_auth_and_admin_routes_are_exposed():
    client = TestClient(app)
    schema = client.get("/openapi.json")
    assert schema.status_code == 200
    paths = schema.json()["paths"]
    assert "/api/auth/register" in paths
    assert "/api/auth/login" in paths
    assert "/api/auth/refresh" in paths
    assert "/api/auth/logout" in paths
    assert "/api/auth/security/activity" in paths
    assert "/api/documents/extract" in paths
    assert "/api/profile/" in paths
    assert "/api/admin/stats" in paths
    assert "/api/admin/users" in paths
    assert "/api/admin/users/{target_user_id}/unlock" in paths
    assert "/api/admin/users/{target_user_id}/role" in paths
    assert "/api/admin/audit-logs" in paths


def test_rbac_token_role_claim_and_admin_guard():
    admin_id = ObjectId()
    patient_id = ObjectId()

    # Generate token pairs with respective roles
    admin_tokens = create_token_pair(admin_id, role="admin")
    patient_tokens = create_token_pair(patient_id, role="patient")

    assert admin_tokens["role"] == "admin"
    assert patient_tokens["role"] == "patient"

    client = TestClient(app)

    # 1. Unauthenticated request -> HTTP 401
    res_no_auth = client.get("/api/admin/stats")
    assert res_no_auth.status_code == 401

    # 2. Patient role accessing admin route -> HTTP 403 Forbidden
    res_patient = client.get(
        "/api/admin/stats",
        headers={"Authorization": f"Bearer {patient_tokens['access_token']}"},
    )
    assert res_patient.status_code == 403
    assert "permission" in res_patient.json()["detail"].lower()

    # 3. Admin role accessing admin route -> Passes guard (HTTP 200)
    res_admin = client.get(
        "/api/admin/stats",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )
    assert res_admin.status_code == 200
    stats = res_admin.json()
    assert "total_users" in stats
    assert "locked_users" in stats
