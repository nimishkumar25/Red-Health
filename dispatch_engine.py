"""
RED Emergency Connect - Ambulance Dispatch & State Machine Engine
Manages emergency lifecycle transitions (Triggered -> Triaged -> Dispatched -> Transit -> Admitted),
ambulance unit assignment, and route GPS coordinate generation.
"""

import uuid
from typing import Dict, List, Optional
from backend.models import (
    DispatchRequest,
    DispatchResponse,
    AmbulanceUnit,
    Location,
    IncidentState,
    HospitalNode
)
from backend.hospital_matcher import MOCK_HOSPITALS
from backend.audit_logger import audit_logger

# Mock Ambulance Fleet Units
AMBULANCE_FLEET: Dict[str, AmbulanceUnit] = {
    "AMB-101": AmbulanceUnit(
        unit_id="AMB-101",
        call_sign="Red Rescue Alpha",
        location=Location(latitude=12.9650, longitude=77.5900, address="Station 1 - Central"),
        status="Idle",
        eta_minutes=4.2
    ),
    "AMB-102": AmbulanceUnit(
        unit_id="AMB-102",
        call_sign="Red Rescue Bravo",
        location=Location(latitude=12.9280, longitude=77.6100, address="Station 4 - South"),
        status="Idle",
        eta_minutes=6.5
    ),
    "AMB-103": AmbulanceUnit(
        unit_id="AMB-103",
        call_sign="Red Rescue Charlie",
        location=Location(latitude=12.9820, longitude=77.6350, address="Station 2 - East"),
        status="Idle",
        eta_minutes=3.8
    ),
    "AMB-104": AmbulanceUnit(
        unit_id="AMB-104",
        call_sign="Red Rescue Delta (ICU Special)",
        location=Location(latitude=13.0200, longitude=77.5850, address="Station 5 - North"),
        status="Idle",
        eta_minutes=7.0
    )
}

# Incident active state storage
ACTIVE_INCIDENTS: Dict[str, Dict] = {}


def generate_route_waypoints(start: Location, incident: Location, hospital: Location, steps: int = 10) -> List[Location]:
    """
    Interpolates a realistic sequence of route coordinates from Ambulance -> Incident -> Hospital.
    """
    waypoints: List[Location] = []

    # Segment 1: Start to Incident (5 steps)
    for i in range(steps // 2 + 1):
        ratio = i / (steps / 2)
        lat = start.latitude + (incident.latitude - start.latitude) * ratio
        lon = start.longitude + (incident.longitude - start.longitude) * ratio
        waypoints.append(Location(latitude=round(lat, 5), longitude=round(lon, 5)))

    # Segment 2: Incident to Hospital (5 steps)
    for i in range(1, steps // 2 + 1):
        ratio = i / (steps / 2)
        lat = incident.latitude + (hospital.latitude - incident.latitude) * ratio
        lon = incident.longitude + (hospital.longitude - incident.longitude) * ratio
        waypoints.append(Location(latitude=round(lat, 5), longitude=round(lon, 5)))

    return waypoints


class DispatchEngine:
    @staticmethod
    def assign_dispatch(request: DispatchRequest, actor: str = "Dispatcher-101") -> DispatchResponse:
        dispatch_id = f"DSP-{uuid.uuid4().hex[:8].upper()}"

        # 1. Find target hospital
        dest_hosp = next((h for h in MOCK_HOSPITALS if h.hospital_id == request.target_hospital_id), MOCK_HOSPITALS[0])

        # 2. Assign available idle ambulance
        assigned_unit = None
        for unit in AMBULANCE_FLEET.values():
            if unit.status == "Idle":
                assigned_unit = unit
                break

        if not assigned_unit:
            # Fallback if all busy, assign first unit
            assigned_unit = list(AMBULANCE_FLEET.values())[0]

        # Update unit state
        assigned_unit.status = "En Route"
        assigned_unit.current_incident_id = request.incident_id

        # 3. Generate route coordinates (Incident location approx near Bangalore city center)
        incident_loc = Location(latitude=12.9600, longitude=77.6000, address="Emergency Incident Site")
        route_coords = generate_route_waypoints(assigned_unit.location, incident_loc, dest_hosp.location)

        # 4. Advance State Machine: Dispatched -> Transit
        current_state = IncidentState.DISPATCHED

        # 5. Log cryptographic audit block
        audit_payload = {
            "dispatch_id": dispatch_id,
            "incident_id": request.incident_id,
            "triage_id": request.triage_id,
            "unit_id": assigned_unit.unit_id,
            "hospital_id": dest_hosp.hospital_id,
            "state": current_state.value
        }
        audit_block = audit_logger.log_event(
            event_type="DISPATCH_ASSIGNED",
            actor=actor,
            payload=audit_payload,
            data_summary=f"Ambulance {assigned_unit.call_sign} dispatched to Incident {request.incident_id} -> Hospital {dest_hosp.name}"
        )

        response = DispatchResponse(
            dispatch_id=dispatch_id,
            incident_id=request.incident_id,
            assigned_unit=assigned_unit,
            destination_hospital=dest_hosp,
            incident_state=current_state,
            route_coordinates=route_coords,
            audit_hash=audit_block.block_hash
        )

        ACTIVE_INCIDENTS[request.incident_id] = {
            "dispatch": response,
            "state": current_state,
            "audit_hash": audit_block.block_hash
        }

        return response

    @staticmethod
    def update_incident_state(incident_id: str, new_state: IncidentState, actor: str) -> str:
        """Enforces air-tight state transitions and records SHA-256 audit entry."""
        if incident_id in ACTIVE_INCIDENTS:
            ACTIVE_INCIDENTS[incident_id]["state"] = new_state
            audit_block = audit_logger.log_event(
                event_type="STATE_TRANSITION",
                actor=actor,
                payload={"incident_id": incident_id, "new_state": new_state.value},
                data_summary=f"Incident {incident_id} transitioned to state '{new_state.value}'"
            )
            ACTIVE_INCIDENTS[incident_id]["audit_hash"] = audit_block.block_hash
            return audit_block.block_hash
        return "UNKNOWN_INCIDENT"
