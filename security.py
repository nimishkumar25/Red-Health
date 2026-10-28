"""
RED Emergency Connect - Zero-Trust Security & HIPAA Compliance Engine
Provides PII/PHI scrubbing & tokenization, AES-256 GCM encryption at rest,
signed JWT generation/validation with RBAC, and HMAC request signature checks.
"""

import re
import os
import time
import base64
import hmac
import hashlib
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

import jwt
from fastapi import HTTPException, Security, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.models import UserRole

# Secret Keys (In production, these come from secure environment key vaults / HSM)
JWT_SECRET_KEY = os.environ.get("RED_JWT_SECRET", "red-emergency-connect-hyper-secure-secret-key-32b")
HMAC_SECRET_KEY = os.environ.get("RED_HMAC_SECRET", "red-hmac-integrity-signature-secret-key").encode()
AES_MASTER_KEY = AESGCM.generate_key(bit_length=256)  # 256-bit key for AES-GCM

security_scheme = HTTPBearer()

# --- 1. PII / PHI Redaction & Tokenization Engine ---

PII_PATTERNS = [
    # SSN pattern
    (r"\b\d{3}-\d{2}-\d{4}\b", "[REDACTED_SSN]"),
    # Phone numbers
    (r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b", "[REDACTED_PHONE]"),
    # Email addresses
    (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "[REDACTED_EMAIL]"),
    # Medical Record Number (MRN) (e.g., MRN-12345678)
    (r"\bMRN-?\d{6,10}\b", "[REDACTED_MRN]"),
    # Common full names indicator phrases (e.g. "My name is John Doe" or "Patient Jane Smith")
    (r"(?i)\b(my name is|patient is|caller is|this is)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)\b", r"\1 [REDACTED_NAME]"),
    # Date of Birth (DOB) pattern
    (r"\b(?:DOB|born on|date of birth)[:\s]+(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b", "[REDACTED_DOB]"),
]


def scrub_pii_phi(text: str) -> str:
    """
    Scrubs personally identifiable and protected health info from strings
    before storing or logging, producing tokenized HIPAA-compliant output.
    """
    if not text:
        return text

    scrubbed = text
    for pattern, replacement in PII_PATTERNS:
        scrubbed = re.sub(pattern, replacement, scrubbed)

    return scrubbed


# --- 2. AES-256-GCM Payload Encryption At Rest ---

class AESCipher:
    def __init__(self, key: bytes = AES_MASTER_KEY):
        self.aesgcm = AESGCM(key)

    def encrypt(self, data: str) -> str:
        """Encrypts plaintext using AES-256-GCM with a fresh 96-bit nonce."""
        nonce = os.urandom(12)
        ciphertext = self.aesgcm.encrypt(nonce, data.encode('utf-8'), None)
        combined = nonce + ciphertext
        return base64.b64encode(combined).decode('utf-8')

    def decrypt(self, encrypted_b64: str) -> str:
        """Decrypts AES-256-GCM ciphertext."""
        data = base64.b64decode(encrypted_b64.encode('utf-8'))
        nonce = data[:12]
        ciphertext = data[12:]
        decrypted_bytes = self.aesgcm.decrypt(nonce, ciphertext, None)
        return decrypted_bytes.decode('utf-8')


aes_cipher = AESCipher()


# --- 3. JWT & RBAC Management ---

def create_access_token(user_id: str, role: UserRole, expires_delta_minutes: int = 120) -> str:
    """Generates a cryptographically signed JWT with embedded Role-Based Access Claims."""
    expire = datetime.utcnow() + timedelta(minutes=expires_delta_minutes)
    payload = {
        "sub": user_id,
        "role": role.value,
        "iat": datetime.utcnow(),
        "exp": expire,
        "iss": "red-emergency-connect-auth"
    }
    encoded_jwt = jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")
    return encoded_jwt


def decode_access_token(token: str) -> Dict[str, Any]:
    """Validates and decodes JWT token claims."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"], issuer="red-emergency-connect-auth")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid security token authentication payload",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user_claims(credentials: HTTPAuthorizationCredentials = Security(security_scheme)) -> Dict[str, Any]:
    return decode_access_token(credentials.credentials)


class RoleChecker:
    def __init__(self, allowed_roles: List[UserRole]):
        self.allowed_roles = [r.value for r in allowed_roles]

    def __call__(self, claims: Dict[str, Any] = Depends(get_current_user_claims)) -> Dict[str, Any]:
        user_role = claims.get("role")
        if user_role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user_role}' lacks permission for this action. Allowed: {self.allowed_roles}"
            )
        return claims


# --- 4. HMAC-SHA256 Request Integrity Verifier ---

def generate_request_signature(payload_str: str, timestamp: str) -> str:
    """Computes an HMAC-SHA256 signature for payload verification."""
    message = f"{timestamp}:{payload_str}".encode('utf-8')
    signature = hmac.new(HMAC_SECRET_KEY, message, hashlib.sha256).hexdigest()
    return signature


def verify_request_signature(payload_str: str, timestamp: str, signature: str) -> bool:
    """Verifies whether an incoming request payload has been tampered with in transit."""
    expected_sig = generate_request_signature(payload_str, timestamp)
    return hmac.compare_digest(expected_sig, signature)
