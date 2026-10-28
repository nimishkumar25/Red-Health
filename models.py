"""
RED Emergency Connect - Data Models & Strict Pydantic Schemas
Strict payload validation adhering to Zero-Trust and HIPAA compliance guidelines.
"""

from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator, ConfigDict
from datetime import datetime


class UserRole(str, Enum):
    USER = "User"
    DISPATCHER = "Dispatcher"
    HOSPITAL_ADMIN = "Hospital Admin"
    PARAMEDIC = "Paramedic"


class SeverityLevel(str, Enum):
    CRITICAL = "Critical"
    HIGH = "High"
    MODERATE = "Moderate"
    LOW = "Low"


class EmergencyType(str, Enum):
    CARDIAC = "Cardiac"
    TRAUMA = "Trauma"
    RESPIRATORY = "Respiratory"
    NEUROLOGICAL = "Neurological"
    BURN = "Burn"
    GENERAL_MEDICAL = "General Medical"
    UNKNOWN = "Unknown"


class IncidentState(str, Enum):
    TRIGGERED = "Triggered"
    TRIAGED = "Triaged"
    DISPATCHED = "Dispatched"
    TRANSIT = "Transit"
    ADMITTED = "Admitted"


class Location(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude degree")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude degree")
    address: Optional[str] = Field(None, max_length=255, description="Street address if available")

    model_config = ConfigDict(extra="forbid")


# --- Voice Triage Schemas ---

class VoiceTriageRequest(BaseModel):
    audio_transcript: Optional[str] = Field(None, description="Audio transcript string")
    audio_base64: Optional[str] = Field(None, description="Base64 encoded audio blob")
    location: Location = Field(..., description="Emergency incident location")
    reported_by: Optional[str] = Field("Anonymous Caller", max_length=100)

    model_config = ConfigDict(extra="forbid")

    @field_validator("audio_transcript")
    @classmethod
    def validate_transcript_or_audio(cls, v, info):
        # Must have at least audio_transcript or audio_base64
        return v


class VoiceTriageResponse(BaseModel):
    triage_id: str
    emergency_type: EmergencyType
    severity_level: SeverityLevel
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    patient_age_est: Optional[int] = Field(None, ge=0, le=120)
    oxygen_needed: bool
    icu_required: bool
    trauma_type: Optional[str] = None
    extracted_symptoms: List[str] = Field(default_factory=list)
    scrubbed_summary: str = Field(..., description="PII/PHI scrubbed transcript summary")
    failsafe_triggered: bool = False
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    model_config = ConfigDict(extra="forbid")


# --- Hospital Matching Schemas ---

class RequiredCapabilities(BaseModel):
    icu_required: bool = False
    trauma_center: bool = False
    burn_unit: bool = False
    cardiac_cath_lab: bool = False
    pediatric_care: bool = False

    model_config = ConfigDict(extra="forbid")


class HospitalMatchRequest(BaseModel):
    incident_id: str
    location: Location
    capabilities: RequiredCapabilities
    max_radius_km: float = Field(30.0, gt=0, le=200.0)

    model_config = ConfigDict(extra="forbid")


class HospitalCapabilities(BaseModel):
    icu_available: int = Field(0, ge=0)
    trauma_center_level: Optional[int] = Field(None, ge=1, le=4)
    burn_unit: bool = False
    cardiac_cath_lab: bool = False
    ventilators_free: int = Field(0, ge=0)
    er_beds_available: int = Field(0, ge=0)


class HospitalNode(BaseModel):
    hospital_id: str
    name: str
    location: Location
    capabilities: HospitalCapabilities
    reported_capacity: int
    verified_capacity: int
    trust_score: float = Field(..., ge=0.0, le=1.0, description="Readiness and Trust index")
    distance_km: float
    estimated_eta_minutes: float


class HospitalMatchResult(BaseModel):
    incident_id: str
    matched_hospitals: List[HospitalNode]
    recommended_hospital: Optional[HospitalNode] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# --- Dispatch & Routing Schemas ---

class DispatchRequest(BaseModel):
    incident_id: str
    triage_id: str
    target_hospital_id: str
    override_reason: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class AmbulanceUnit(BaseModel):
    unit_id: str
    call_sign: str
    location: Location
    status: str  # "Idle", "En Route", "On Scene", "In Transit", "Completed"
    eta_minutes: float
    current_incident_id: Optional[str] = None


class DispatchResponse(BaseModel):
    dispatch_id: str
    incident_id: str
    assigned_unit: AmbulanceUnit
    destination_hospital: HospitalNode
    incident_state: IncidentState
    route_coordinates: List[Location]
    audit_hash: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# --- Telemetry & Audit Schemas ---

class TelemetryUpdate(BaseModel):
    unit_id: str
    incident_id: str
    location: Location
    speed_kmh: float = Field(..., ge=0.0)
    incident_state: IncidentState
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    model_config = ConfigDict(extra="forbid")


class HospitalCapacityUpdate(BaseModel):
    hospital_id: str
    icu_beds_free: int = Field(..., ge=0)
    er_beds_free: int = Field(..., ge=0)
    ventilators_free: int = Field(..., ge=0)
    verification_source: str

    model_config = ConfigDict(extra="forbid")


class AuditBlock(BaseModel):
    index: int
    timestamp: str
    event_type: str
    actor: str
    payload_hash: str
    previous_hash: str
    block_hash: str
    data_summary: str
