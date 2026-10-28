"""
RED Emergency Connect - Voice Triage & AI Feature Extraction Engine
Analyzes voice transcripts or audio input to extract structured clinical features.
Enforces deterministic fail-safe defaults: if ambiguity or low confidence is detected,
automatically defaults to CRITICAL severity and requests full ICU / Trauma resources.
"""

import uuid
import re
from typing import Dict, Any, Tuple, List
from backend.models import (
    VoiceTriageRequest,
    VoiceTriageResponse,
    EmergencyType,
    SeverityLevel,
)
from backend.security import scrub_pii_phi


# Clinical taxonomy and symptom triggers
SYMPTOM_LEXICON = {
    EmergencyType.CARDIAC: [
        "chest pain", "cardiac arrest", "heart attack", "left arm pain", "crushing chest",
        "shortness of breath", "unresponsive", "pulse faint", "palpitations", "defibrillator"
    ],
    EmergencyType.TRAUMA: [
        "car crash", "accident", "gunshot", "stab", "fracture", "uncontrolled bleeding",
        "fall from height", "head injury", "amputation", "severe trauma", "collision"
    ],
    EmergencyType.RESPIRATORY: [
        "cannot breathe", "choking", "asphyxiation", "asthma attack", "blue lips",
        "cyanosis", "severe wheezing", "stridor", "gasping"
    ],
    EmergencyType.NEUROLOGICAL: [
        "stroke", "seizure", "facial droop", "slurred speech", "numbness",
        "unconscious", "headache sudden", "paralysis", "loss of consciousness"
    ],
    EmergencyType.BURN: [
        "fire", "chemical burn", "explosion", "scald", "third degree burn", "charred skin"
    ]
}

HIGH_RISK_KEYWORDS = [
    "unresponsive", "cardiac arrest", "not breathing", "severe bleeding", "unconscious",
    "gunshot", "blue lips", "gasping", "head trauma", "crushing pain", "massive hemorrhage"
]


def extract_age(text: str) -> Tuple[int, bool]:
    """Attempts to extract patient age from transcript text."""
    age_matches = re.findall(r"\b(\d{1,3})\s*(?:year[s]?\s*old|yo|yr[s]?\s*old)\b", text, re.IGNORECASE)
    if age_matches:
        try:
            age = int(age_matches[0])
            if 0 <= age <= 120:
                return age, True
        except ValueError:
            pass
    return 45, False  # Default estimated age if unspecified


def analyze_transcript(transcript: str) -> Tuple[EmergencyType, SeverityLevel, float, bool, bool, str, List[str], bool]:
    """
    Parses natural language emergency audio transcripts.
    Returns:
      (emergency_type, severity_level, confidence, oxygen_needed, icu_required, trauma_type, symptoms, failsafe_triggered)
    """
    if not transcript or len(transcript.strip()) < 5:
        # Extreme ambiguity or empty audio payload -> FAIL-SAFE MANDATE ACTIVATED
        return (
            EmergencyType.CARDIAC,
            SeverityLevel.CRITICAL,
            0.50,
            True,
            True,
            "Unspecified Critical Event",
            ["Ambiguous Audio Payload - Fail-Safe Protocol Engaged"],
            True
        )

    text_lower = transcript.lower()
    detected_symptoms = []
    category_scores: Dict[EmergencyType, int] = {cat: 0 for cat in EmergencyType}

    # Match lexicon
    for cat, terms in SYMPTOM_LEXICON.items():
        for term in terms:
            if term in text_lower:
                category_scores[cat] += 2
                detected_symptoms.append(term)

    # High-risk term bonus
    high_risk_detected = any(k in text_lower for k in HIGH_RISK_KEYWORDS)

    # Determine highest matching category
    best_cat = max(category_scores, key=category_scores.get)
    max_score = category_scores[best_cat]

    # Calculate AI confidence score
    if max_score >= 4:
        confidence = 0.95
    elif max_score >= 2:
        confidence = 0.82
    elif high_risk_detected:
        confidence = 0.78
    else:
        confidence = 0.45  # Low confidence triggers fail-safe!

    # Fail-safe evaluation logic
    failsafe_triggered = False
    if confidence < 0.70 or max_score == 0:
        failsafe_triggered = True
        severity = SeverityLevel.CRITICAL
        best_cat = EmergencyType.TRAUMA if "trauma" in text_lower or "blood" in text_lower else EmergencyType.CARDIAC
        oxygen_needed = True
        icu_required = True
        trauma_type = "Unspecified High-Risk Trauma"
    else:
        # Standard Clinical Rule Engine
        if high_risk_detected or "critical" in text_lower or "unresponsive" in text_lower:
            severity = SeverityLevel.CRITICAL
            icu_required = True
            oxygen_needed = True
        elif "severe" in text_lower or "fracture" in text_lower or max_score >= 3:
            severity = SeverityLevel.HIGH
            icu_required = "icu" in text_lower or best_cat == EmergencyType.CARDIAC
            oxygen_needed = "breath" in text_lower or "oxygen" in text_lower or best_cat == EmergencyType.RESPIRATORY
        else:
            severity = SeverityLevel.MODERATE
            icu_required = False
            oxygen_needed = "breath" in text_lower

        trauma_type = "Blunt Force / Penetrating" if best_cat == EmergencyType.TRAUMA else "N/A"

    return best_cat, severity, confidence, oxygen_needed, icu_required, trauma_type, detected_symptoms, failsafe_triggered


class VoiceTriageEngine:
    @staticmethod
    def process_voice_triage(request: VoiceTriageRequest) -> VoiceTriageResponse:
        """Processes an incoming voice triage request with PII scrubbing & fail-safe guarantees."""
        raw_text = request.audio_transcript or "Audio stream payload uploaded without transcript text"

        # 1. PII/PHI Scrubbing
        scrubbed_text = scrub_pii_phi(raw_text)

        # 2. Extract patient age
        est_age, _ = extract_age(raw_text)

        # 3. Perform natural language clinical parsing & fail-safe check
        (
            em_type,
            sev_level,
            confidence,
            oxy_needed,
            icu_req,
            trauma_type,
            symptoms,
            failsafe
        ) = analyze_transcript(raw_text)

        triage_id = f"TRG-{uuid.uuid4().hex[:8].upper()}"

        return VoiceTriageResponse(
            triage_id=triage_id,
            emergency_type=em_type,
            severity_level=sev_level,
            confidence_score=confidence,
            patient_age_est=est_age,
            oxygen_needed=oxy_needed,
            icu_required=icu_req,
            trauma_type=trauma_type,
            extracted_symptoms=symptoms,
            scrubbed_summary=scrubbed_text,
            failsafe_triggered=failsafe
        )
