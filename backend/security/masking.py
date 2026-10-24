from __future__ import annotations

import re


def mask_aadhaar(aadhaar: str | None) -> str:
    """Masks a 12-digit Aadhaar number to 'XXXX-XXXX-1234' format."""
    if not aadhaar:
        return ""
    digits = re.sub(r"\D", "", str(aadhaar).strip())
    if len(digits) == 12:
        return f"XXXX-XXXX-{digits[-4:]}"
    if len(digits) >= 4:
        return f"XXXX-XXXX-{digits[-4:]}"
    return "XXXX-XXXX-XXXX"


def mask_pan(pan: str | None) -> str:
    """Masks a PAN card number to 'XXXXX1234X' format."""
    if not pan:
        return ""
    raw = str(pan).strip().upper()
    if len(raw) == 10:
        return f"XXXXX{raw[5:9]}{raw[9]}"
    if len(raw) >= 4:
        return f"{'X' * (len(raw) - 4)}{raw[-4:]}"
    return "XXXXXXXXXX"


def mask_phone(phone: str | None) -> str:
    """Masks a phone number to 'XXXXXX1234' format."""
    if not phone:
        return ""
    digits = re.sub(r"\D", "", str(phone).strip())
    if len(digits) >= 4:
        return f"{'X' * max(0, len(digits) - 4)}{digits[-4:]}"
    return "XXXXXXXXXX"


def mask_generic_id(value: str | None, visible_end_chars: int = 4) -> str:
    """Masks generic identifier numbers preserving only the trailing characters."""
    if not value:
        return ""
    raw = str(value).strip()
    if len(raw) <= visible_end_chars:
        return "X" * len(raw)
    return f"{'X' * (len(raw) - visible_end_chars)}{raw[-visible_end_chars:]}"


def mask_profile_data(data: dict) -> dict:
    """Returns a shallow copy of profile dictionary with sensitive identifiers masked."""
    masked = dict(data)
    if "aadhaar_number" in masked and masked["aadhaar_number"]:
        masked["aadhaar_number_masked"] = mask_aadhaar(masked["aadhaar_number"])
    if "pan_number" in masked and masked["pan_number"]:
        masked["pan_number_masked"] = mask_pan(masked["pan_number"])
    if "phone" in masked and masked["phone"]:
        masked["phone_masked"] = mask_phone(masked["phone"])
    if "voter_id" in masked and masked["voter_id"]:
        masked["voter_id_masked"] = mask_generic_id(masked["voter_id"])
    if "passport_number" in masked and masked["passport_number"]:
        masked["passport_number_masked"] = mask_generic_id(masked["passport_number"])
    if "driving_licence_number" in masked and masked["driving_licence_number"]:
        masked["driving_licence_number_masked"] = mask_generic_id(masked["driving_licence_number"])
    return masked
