"""
RED Emergency Connect - Geospatial Hospital Matcher & Readiness Index Engine
Uses Haversine spatial calculation and multi-capability filtering (ICU, Trauma, Burn, Cardiac)
to compute a dynamic "Trust & Readiness Index" for healthcare dispatch recommendation.
"""

import math
from typing import List, Optional
from backend.models import (
    HospitalMatchRequest,
    HospitalMatchResult,
    HospitalNode,
    HospitalCapabilities,
    Location,
)

# Mock Hospital Infrastructure Registry (Metropolitan Center Coordinates)
MOCK_HOSPITALS = [
    HospitalNode(
        hospital_id="HOSP-001",
        name="St. Jude Level-1 Trauma & Heart Center",
        location=Location(latitude=12.9716, longitude=77.5946, address="100 Metro Health Expressway"),
        capabilities=HospitalCapabilities(
            icu_available=14,
            trauma_center_level=1,
            burn_unit=True,
            cardiac_cath_lab=True,
            ventilators_free=10,
            er_beds_available=28
        ),
        reported_capacity=45,
        verified_capacity=42,
        trust_score=0.96,
        distance_km=0.0,
        estimated_eta_minutes=0.0
    ),
    HospitalNode(
        hospital_id="HOSP-002",
        name="City Memorial Emergency Hospital",
        location=Location(latitude=12.9352, longitude=77.6245, address="45 Koramangala Outer Ring Rd"),
        capabilities=HospitalCapabilities(
            icu_available=4,
            trauma_center_level=2,
            burn_unit=False,
            cardiac_cath_lab=True,
            ventilators_free=3,
            er_beds_available=12
        ),
        reported_capacity=20,
        verified_capacity=18,
        trust_score=0.88,
        distance_km=0.0,
        estimated_eta_minutes=0.0
    ),
    HospitalNode(
        hospital_id="HOSP-003",
        name="Apollo Emergency & Burn Institute",
        location=Location(latitude=12.9166, longitude=77.5996, address="154 Bannerghatta Main Rd"),
        capabilities=HospitalCapabilities(
            icu_available=18,
            trauma_center_level=1,
            burn_unit=True,
            cardiac_cath_lab=True,
            ventilators_free=15,
            er_beds_available=35
        ),
        reported_capacity=60,
        verified_capacity=59,
        trust_score=0.98,
        distance_km=0.0,
        estimated_eta_minutes=0.0
    ),
    HospitalNode(
        hospital_id="HOSP-004",
        name="Eastside Community Medical Center",
        location=Location(latitude=12.9784, longitude=77.6408, address="88 Indiranagar 100ft Rd"),
        capabilities=HospitalCapabilities(
            icu_available=1,
            trauma_center_level=3,
            burn_unit=False,
            cardiac_cath_lab=False,
            ventilators_free=1,
            er_beds_available=5
        ),
        reported_capacity=15,
        verified_capacity=10,
        trust_score=0.72,
        distance_km=0.0,
        estimated_eta_minutes=0.0
    ),
    HospitalNode(
        hospital_id="HOSP-005",
        name="Northside General & Pulmonary Care",
        location=Location(latitude=13.0358, longitude=77.5970, address="12 Hebbal Flyover Boulevard"),
        capabilities=HospitalCapabilities(
            icu_available=8,
            trauma_center_level=2,
            burn_unit=False,
            cardiac_cath_lab=True,
            ventilators_free=7,
            er_beds_available=20
        ),
        reported_capacity=30,
        verified_capacity=28,
        trust_score=0.91,
        distance_km=0.0,
        estimated_eta_minutes=0.0
    )
]


def haversine_distance(loc1: Location, loc2: Location) -> float:
    """Calculates Haversine distance in kilometers between two GPS points."""
    R = 6371.0  # Earth radius in kilometers

    lat1_rad = math.radians(loc1.latitude)
    lon1_rad = math.radians(loc1.longitude)
    lat2_rad = math.radians(loc2.latitude)
    lon2_rad = math.radians(loc2.longitude)

    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad

    a = math.sin(dlat / 2.0) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

    return R * c


def compute_trust_and_readiness_index(hospital: HospitalNode, required_icu: bool) -> float:
    """
    Computes dynamic Trust & Readiness Index (0.0 to 1.0)
    Factor 1: Reported vs Verified telemetry audit ratio (40%)
    Factor 2: Free ICU & Ventilator availability buffer (35%)
    Factor 3: Emergency response staffing readiness (25%)
    """
    reported = max(hospital.reported_capacity, 1)
    verified_ratio = min(hospital.verified_capacity / reported, 1.0)

    icu_avail = hospital.capabilities.icu_available
    icu_score = min(icu_avail / 10.0, 1.0) if required_icu else min(icu_avail / 5.0, 1.0)

    er_beds = hospital.capabilities.er_beds_available
    er_score = min(er_beds / 20.0, 1.0)

    raw_trust = (0.40 * verified_ratio) + (0.35 * icu_score) + (0.25 * er_score)
    return round(max(0.0, min(1.0, raw_trust)), 3)


class HospitalMatcher:
    @staticmethod
    def match_hospitals(request: HospitalMatchRequest) -> HospitalMatchResult:
        matched: List[HospitalNode] = []

        for base_hosp in MOCK_HOSPITALS:
            caps = base_hosp.capabilities
            reqs = request.capabilities

            # 1. Capability Filtering
            if reqs.icu_required and caps.icu_available <= 0:
                continue
            if reqs.trauma_center and (caps.trauma_center_level is None or caps.trauma_center_level > 2):
                continue
            if reqs.burn_unit and not caps.burn_unit:
                continue
            if reqs.cardiac_cath_lab and not caps.cardiac_cath_lab:
                continue

            # 2. Distance & ETA Calculation
            dist_km = haversine_distance(request.location, base_hosp.location)
            if dist_km > request.max_radius_km:
                continue

            # Assume average emergency transport speed of 45 km/h in city traffic (0.75 km/min)
            eta_mins = round((dist_km / 45.0) * 60.0 + 3.0, 1)  # +3 min prep time

            # 3. Dynamic Trust Score update
            trust = compute_trust_and_readiness_index(base_hosp, reqs.icu_required)

            # Create updated instance
            hosp_node = HospitalNode(
                hospital_id=base_hosp.hospital_id,
                name=base_hosp.name,
                location=base_hosp.location,
                capabilities=caps,
                reported_capacity=base_hosp.reported_capacity,
                verified_capacity=base_hosp.verified_capacity,
                trust_score=trust,
                distance_km=round(dist_km, 2),
                estimated_eta_minutes=eta_mins
            )
            matched.append(hosp_node)

        # Sort candidate hospitals by composite score (distance + high trust score)
        # Score formula: lower distance is better, higher trust is better
        matched.sort(key=lambda h: (h.distance_km / (h.trust_score + 0.1)))

        rec_hospital = matched[0] if matched else None

        return HospitalMatchResult(
            incident_id=request.incident_id,
            matched_hospitals=matched,
            recommended_hospital=rec_hospital
        )
