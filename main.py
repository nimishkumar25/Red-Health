"""
RED Emergency Connect - Main Backend FastAPI Application Server
Provides REST endpoints, security headers, rate limiting, RBAC,
cryptographic audit log access, and WebSocket telemetry streaming.
"""

import time
import json
import asyncio
from typing import Dict, List, Set
from collections import defaultdict

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
import os

from backend.models import (
    VoiceTriageRequest,
    VoiceTriageResponse,
    HospitalMatchRequest,
    HospitalMatchResult,
    DispatchRequest,
    DispatchResponse,
    HospitalCapacityUpdate,
    UserRole,
    IncidentState,
    Location,
)
from backend.security import (
    create_access_token,
    RoleChecker,
    verify_request_signature,
    scrub_pii_phi,
    aes_cipher
)
from backend.triage_engine import VoiceTriageEngine
from backend.hospital_matcher import HospitalMatcher, MOCK_HOSPITALS
from backend.dispatch_engine import DispatchEngine, AMBULANCE_FLEET
from backend.audit_logger import audit_logger


app = FastAPI(
    title="RED Emergency Connect Platform Engine",
    version="1.0.0",
    description="High-Throughput Zero-Trust Voice-Assisted Emergency Dispatch Engine"
)

# --- 1. Security Headers & Rate Limiting Middleware ---

RATE_LIMIT_STORE: Dict[str, List[float]] = defaultdict(list)
RATE_LIMIT_MAX_REQUESTS = 60  # 60 requests per minute per IP
RATE_LIMIT_WINDOW = 60.0  # seconds


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    start_time = time.time()
    client_ip = request.client.host if request.client else "127.0.0.1"

    # Rate Limiting Check
    now = time.time()
    timestamps = RATE_LIMIT_STORE[client_ip]
    # Filter out timestamps older than window
    timestamps = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    RATE_LIMIT_STORE[client_ip] = timestamps

    if len(timestamps) >= RATE_LIMIT_MAX_REQUESTS:
        return Response(
            content=json.dumps({"detail": "Rate limit exceeded. Please wait before retrying."}),
            status_code=429,
            media_type="application/json"
        )
    timestamps.append(now)

    # Process Request
    response: Response = await call_next(request)

    # Inject Production Security Headers
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:;"
    response.headers["X-Latency-Ms"] = str(round((time.time() - start_time) * 1000, 2))

    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 2. WebSocket Telemetry Manager ---

class TelemetryConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead_sockets = set()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_sockets.add(connection)
        for dead in dead_sockets:
            self.active_connections.remove(dead)


telemetry_manager = TelemetryConnectionManager()


# --- 3. Authentication & Authorization Routes ---

@app.post("/api/v1/auth/token", summary="Obtain Signed JWT Token for RBAC Role")
def get_auth_token(role: UserRole = UserRole.DISPATCHER, user_id: str = "operator-01"):
    token = create_access_token(user_id=user_id, role=role)
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": role.value,
        "user_id": user_id
    }


# --- 4. Emergency Voice Triage Route ---

@app.post(
    "/api/v1/emergency/voice-triage",
    response_model=VoiceTriageResponse,
    summary="Process Emergency Voice Intake Payload"
)
def process_voice_triage(payload: VoiceTriageRequest):
    """
    Receives voice audio transcript or base64 blob.
    Extracts clinical urgency features, scrubs PII/PHI, enforces fail-safe rules,
    and logs SHA-256 audit entry.
    """
    response = VoiceTriageEngine.process_voice_triage(payload)

    # Log SHA-256 Audit Trail
    audit_logger.log_event(
        event_type="VOICE_TRIAGE_PROCESSED",
        actor="AI-Triage-Engine",
        payload=response.model_dump(),
        data_summary=f"Voice Triage {response.triage_id}: Severity={response.severity_level.value}, Failsafe={response.failsafe_triggered}"
    )

    return response


# --- 5. Hospital Capability Matching Route ---

@app.post(
    "/api/v1/hospitals/match",
    response_model=HospitalMatchResult,
    summary="Geospatial Hospital Matching with Trust & Readiness Index"
)
def match_hospitals(payload: HospitalMatchRequest):
    result = HospitalMatcher.match_hospitals(payload)

    audit_logger.log_event(
        event_type="HOSPITAL_MATCHING_COMPLETED",
        actor="Match-Engine",
        payload=result.model_dump(),
        data_summary=f"Matched {len(result.matched_hospitals)} hospitals for Incident {payload.incident_id}"
    )

    return result


# --- 6. Dispatch & Routing Route ---

@app.post(
    "/api/v1/dispatch/route",
    response_model=DispatchResponse,
    summary="Assign Ambulance & Initiate Route Telemetry"
)
def dispatch_route(
    payload: DispatchRequest,
    claims: dict = Depends(RoleChecker([UserRole.DISPATCHER, UserRole.PARAMEDIC, UserRole.USER]))
):
    actor = f"{claims.get('role')}:{claims.get('sub')}"
    response = DispatchEngine.assign_dispatch(payload, actor=actor)
    return response


@app.post("/api/v1/dispatch/state-transition", summary="Advance Emergency Lifecycle State")
def update_state(
    incident_id: str,
    new_state: IncidentState,
    claims: dict = Depends(RoleChecker([UserRole.DISPATCHER, UserRole.PARAMEDIC]))
):
    actor = f"{claims.get('role')}:{claims.get('sub')}"
    audit_hash = DispatchEngine.update_incident_state(incident_id, new_state, actor)

    # Broadcast via WebSocket
    asyncio.create_task(telemetry_manager.broadcast({
        "event": "STATE_CHANGE",
        "incident_id": incident_id,
        "new_state": new_state.value,
        "audit_hash": audit_hash
    }))

    return {"status": "success", "incident_id": incident_id, "state": new_state.value, "audit_hash": audit_hash}


# --- 7. Hospital Resource Capacity Update Route ---

@app.post("/api/v1/hospitals/capacity", summary="Real-time Hospital Capacity Sync")
def update_hospital_capacity(
    payload: HospitalCapacityUpdate,
    claims: dict = Depends(RoleChecker([UserRole.HOSPITAL_ADMIN, UserRole.DISPATCHER]))
):
    for hosp in MOCK_HOSPITALS:
        if hosp.hospital_id == payload.hospital_id:
            hosp.capabilities.icu_available = payload.icu_beds_free
            hosp.capabilities.er_beds_available = payload.er_beds_free
            hosp.capabilities.ventilators_free = payload.ventilators_free
            hosp.verified_capacity = payload.icu_beds_free + payload.er_beds_free

            audit_block = audit_logger.log_event(
                event_type="HOSPITAL_CAPACITY_UPDATED",
                actor=f"{claims.get('role')}:{claims.get('sub')}",
                payload=payload.model_dump(),
                data_summary=f"Hospital {hosp.name} updated: ICU={payload.icu_beds_free}, ER={payload.er_beds_free}"
            )

            # Broadcast WebSocket event
            asyncio.create_task(telemetry_manager.broadcast({
                "event": "CAPACITY_UPDATE",
                "hospital_id": hosp.hospital_id,
                "hospital_name": hosp.name,
                "icu_available": payload.icu_beds_free,
                "er_available": payload.er_beds_free,
                "audit_hash": audit_block.block_hash
            }))

            return {"status": "updated", "hospital_id": hosp.hospital_id, "audit_hash": audit_block.block_hash}

    raise HTTPException(status_code=404, detail="Hospital ID not found")


@app.get("/api/v1/hospitals", summary="List All Network Hospitals and Live Capacities")
def list_hospitals():
    return [h.model_dump() for h in MOCK_HOSPITALS]


@app.get("/api/v1/ambulances", summary="List All Fleet Ambulance Units and Statuses")
def list_ambulances():
    return [a.model_dump() for a in AMBULANCE_FLEET.values()]


# --- 8. Immutable Audit Trail Ledger Route ---

@app.get("/api/v1/audit/ledger", summary="Retrieve SHA-256 Immutable Audit Ledger")
def get_audit_ledger():
    is_valid, report = audit_logger.verify_ledger_integrity()
    blocks = audit_logger.get_all_blocks()
    return {
        "chain_integrity_valid": is_valid,
        "integrity_report": report,
        "total_blocks": len(blocks),
        "ledger_blocks": [b.model_dump() for b in blocks]
    }


# --- 9. Real-Time Telemetry WebSocket Endpoint ---

@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    await telemetry_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo or process client command if needed
            await websocket.send_json({"event": "PONG", "received": data})
    except WebSocketDisconnect:
        telemetry_manager.disconnect(websocket)


# --- 10. Serve Frontend Dashboard ---

frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")

@app.get("/styles.css")
def get_css():
    return FileResponse(os.path.join(frontend_path, "styles.css"))

@app.get("/app.js")
def get_js():
    return FileResponse(os.path.join(frontend_path, "app.js"))

@app.get("/", response_class=HTMLResponse)
def read_root():
    index_file = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return "<h1>RED Emergency Connect Engine Server Running</h1>"
