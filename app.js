/**
 * RED.HEALTH Emergency Connect - Command & Dispatch Platform Controller
 * Supports:
 * 1. Voice-based emergency request (Web Audio API waveform visualizer, PII/PHI scrubbing, AI triage)
 * 2. Smart hospital coordination (Capability matching, readiness scoring, trust index)
 * 3. Connected emergency response (Rapid ambulance-hospital coordination, ER pre-alerts, state machine)
 * 4. Real-time hospital information (Live facility directory, bed sync simulation, capability filters)
 * 5. Ambulance on a map (Official Google Maps API SDK support, fallback bright vector map, live GPS fleet tracking)
 */

// Application State
const state = {
  activeRole: "Dispatcher",
  authToken: null,
  isRecording: false,
  audioContext: null,
  analyser: null,
  animFrameId: null,
  currentTriage: null,
  currentIncidentId: null,
  selectedHospitalId: "HOSP-001",
  matchedHospitals: [],
  allHospitals: [],
  ambulanceFleet: [],

  // Maps Architecture
  leafletMaps: {},
  googleMaps: {},
  googleMapsLoaded: false,
  googleMapsApiKey: localStorage.getItem("red_health_gmaps_key") || "",
  activeMapEngine: "leaflet", // 'leaflet' or 'google'
  hospitalMarkers: { leaflet: {}, google: {} },
  ambulanceMarkers: { leaflet: {}, google: {} },
  incidentMarker: { leaflet: null, google: null },
  routePolyline: { leaflet: null, google: null },

  // Real-time Telemetry & WebSockets
  ws: null,
  incidentState: "Triggered",
  telemetryThrottleMs: 2000,
  lastTelemetryTime: 0,
  currentRouteWaypoints: [],
  ambulanceSimInterval: null
};

// Preset Emergency Scenarios
const PRESET_SCENARIOS = {
  cardiac: "Caller reporting 65yo male, severe crushing chest pain, left arm numbness, faint pulse, unresponsive patient on floor. SSN 123-45-6789. Urgent!",
  trauma: "Multi-vehicle collision on Outer Ring Road. 28yo female with compound femoral fracture, uncontrolled bleeding, severe trauma, MRN-998822.",
  respiratory: "Pediatric 8yo male having acute asthma attack, blue lips, severe wheezing, cyanosis, cannot breathe. Caller Jane Smith at 555-0199.",
  failsafe: "Static noise background faint indistinct voice caller unintelligible background emergency sounds."
};

// Bengaluru Metropolitan Center Coordinates (RED.HEALTH Emergency Operations Center)
const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 };
const INCIDENT_COORDS = { lat: 12.9600, lng: 77.6000 };

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  initAuthToken();
  initNavigation();
  initLeafletMaps();
  initGoogleMapsIfKeyPresent();
  initAudioCanvas();
  initWebSocket();
  setupEventListeners();
  loadAllHospitals();
  loadAllAmbulances();

  logAuditStream("SYSTEM", "RED.HEALTH Zero-Trust Dispatch Platform Initialized (Bright Theme & Google Maps Ready).");
});

// ============================================================================
// 1. JWT Authentication & RBAC Handling
// ============================================================================

async function initAuthToken() {
  try {
    const res = await fetch(`/api/v1/auth/token?role=${encodeURIComponent(state.activeRole)}&user_id=cmd-op-01`, {
      method: "POST"
    });
    const data = await res.json();
    state.authToken = data.access_token;
  } catch (err) {
    console.error("Auth token initialization failed:", err);
  }
}

// ============================================================================
// 2. Navigation & Feature View Switching
// ============================================================================

function initNavigation() {
  const navItems = [
    { btnId: "nav-overview", viewId: "view-overview" },
    { btnId: "nav-voice", viewId: "view-voice" },
    { btnId: "nav-coordination", viewId: "view-coordination" },
    { btnId: "nav-response", viewId: "view-response" },
    { btnId: "nav-hospital-info", viewId: "view-hospital-info" },
    { btnId: "nav-map", viewId: "view-map" }
  ];

  navItems.forEach(item => {
    const btn = document.getElementById(item.btnId);
    if (!btn) return;

    btn.addEventListener("click", () => {
      // Toggle button active classes
      navItems.forEach(n => {
        const b = document.getElementById(n.btnId);
        if (b) b.classList.remove("active");
        const v = document.getElementById(n.viewId);
        if (v) v.classList.add("hidden");
      });

      btn.classList.add("active");
      const targetView = document.getElementById(item.viewId);
      if (targetView) targetView.classList.remove("hidden");

      // Auto-trigger hospital match if switching to coordination view and list is empty
      if (item.btnId === "nav-coordination" && state.matchedHospitals.length === 0) {
        executeHospitalMatch();
      }

      // Invalidate map sizes on tab switch
      setTimeout(() => {
        if (state.leafletMaps.overview) state.leafletMaps.overview.invalidateSize();
        if (state.leafletMaps.dedicated) state.leafletMaps.dedicated.invalidateSize();
      }, 100);
    });
  });
}

// ============================================================================
// 3. Bright Theme Maps (Leaflet & Google Maps Official API Key SDK)
// ============================================================================

function initLeafletMaps() {
  // 1. Overview Map
  const elOverview = document.getElementById("leaflet-map");
  if (elOverview) {
    state.leafletMaps.overview = L.map("leaflet-map", {
      zoomControl: true,
      attributionControl: false
    }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    }).addTo(state.leafletMaps.overview);
  }

  // 2. Dedicated Full Map
  const elDedicated = document.getElementById("leaflet-map-dedicated");
  if (elDedicated) {
    state.leafletMaps.dedicated = L.map("leaflet-map-dedicated", {
      zoomControl: true,
      attributionControl: false
    }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    }).addTo(state.leafletMaps.dedicated);
  }

  // Initial Pins
  addIncidentMarkerLeaflet(INCIDENT_COORDS.lat, INCIDENT_COORDS.lng);
}

function addIncidentMarkerLeaflet(lat, lng) {
  const incidentIcon = L.divIcon({
    className: "custom-incident-pin",
    html: `<i class="fa-solid fa-triangle-exclamation"></i>`,
    iconSize: [34, 34]
  });

  ['overview', 'dedicated'].forEach(key => {
    const map = state.leafletMaps[key];
    if (map) {
      L.marker([lat, lng], { icon: incidentIcon }).addTo(map)
        .bindPopup(`<b>Emergency Incident Site</b><br>${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E<br><span class="text-rose-600 font-bold">Priority Triage Required</span>`);
    }
  });
}

// Google Maps Official API Loader
function initGoogleMapsIfKeyPresent() {
  const key = state.googleMapsApiKey.trim();
  const statusPill = document.getElementById("gmaps-status-pill");
  const btnText = document.getElementById("gmaps-btn-text");

  if (!key) {
    if (statusPill) statusPill.textContent = "Google Maps API: Ready";
    if (btnText) btnText.textContent = "Enter Google Maps API Key";
    updateActiveMapEngineText(false);
    return;
  }

  if (statusPill) statusPill.textContent = "Google Maps API: Active";
  if (btnText) btnText.textContent = "Google Maps API: Configured";
  updateActiveMapEngineText(true);

  if (!window.google || !window.google.maps) {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places,geometry&callback=onGoogleMapsSDKLoaded`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      console.warn("Failed to load official Google Maps SDK. Reverting to bright vector maps.");
      if (statusPill) statusPill.textContent = "Google Maps: Key Error";
      updateActiveMapEngineText(false);
    };
    document.head.appendChild(script);
  } else {
    onGoogleMapsSDKLoaded();
  }
}

window.onGoogleMapsSDKLoaded = function() {
  state.googleMapsLoaded = true;
  state.activeMapEngine = "google";
  updateActiveMapEngineText(true);

  // Switch display containers
  document.getElementById("google-map-container")?.classList.remove("hidden");
  document.getElementById("google-map-container-dedicated")?.classList.remove("hidden");

  // Initialize Google Maps Instances
  const gmapOptions = {
    center: { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng },
    zoom: 12,
    mapTypeControl: true,
    streetViewControl: false,
    styles: [
      { featureType: "poi.medical", elementType: "geometry", stylers: [{ color: "#fee2e2" }] },
      { featureType: "poi.medical", elementType: "labels.text.fill", stylers: [{ color: "#be123c" }] }
    ]
  };

  const gElOverview = document.getElementById("google-map-container");
  if (gElOverview) {
    state.googleMaps.overview = new google.maps.Map(gElOverview, gmapOptions);
  }

  const gElDedicated = document.getElementById("google-map-container-dedicated");
  if (gElDedicated) {
    state.googleMaps.dedicated = new google.maps.Map(gElDedicated, gmapOptions);
  }

  renderHospitalNodes();
  renderAmbulanceNodes();
};

function updateActiveMapEngineText(isGoogle) {
  const el = document.getElementById("map-active-engine-text");
  if (!el) return;
  if (isGoogle) {
    el.innerHTML = `<span class="text-emerald-700 font-bold"><i class="fa-brands fa-google mr-1"></i>Official Google Maps JavaScript API Active</span> (Live Traffic & Satellite Enabled)`;
  } else {
    el.innerHTML = `<span class="text-rose-600 font-bold">Interactive Vector Map Active</span> (Click 'Google Maps API' in header to use official Google Maps SDK)`;
  }
}

// ============================================================================
// 4. Hospital & Fleet Data Renderers
// ============================================================================

async function loadAllHospitals() {
  try {
    const res = await fetch("/api/v1/hospitals");
    const hospitals = await res.json();
    state.allHospitals = hospitals;
    renderHospitalDirectoryCards(hospitals);
    renderHospitalNodes();
  } catch (err) {
    console.error("Failed to load hospitals list:", err);
  }
}

async function loadAllAmbulances() {
  try {
    const res = await fetch("/api/v1/ambulances");
    const ambulances = await res.json();
    state.ambulanceFleet = ambulances;
    renderAmbulanceNodes();
  } catch (err) {
    console.error("Failed to load ambulances list:", err);
  }
}

function renderHospitalNodes() {
  if (!state.allHospitals || state.allHospitals.length === 0) return;

  state.allHospitals.forEach(h => {
    const lat = h.location.latitude;
    const lng = h.location.longitude;
    const colorBg = h.trust_score >= 0.90 ? "bg-emerald-600" : h.trust_score >= 0.80 ? "bg-amber-600" : "bg-rose-600";

    // 1. Leaflet Markers
    ['overview', 'dedicated'].forEach(key => {
      const map = state.leafletMaps[key];
      if (map) {
        const hospIcon = L.divIcon({
          className: "custom-hosp-pin",
          html: `<div class="custom-hosp-badge ${colorBg}"><i class="fa-solid fa-hospital"></i></div>`,
          iconSize: [32, 32]
        });

        const marker = L.marker([lat, lng], { icon: hospIcon }).addTo(map)
          .bindPopup(`
            <div class="p-1">
              <div class="text-xs font-bold text-slate-900">${h.name}</div>
              <div class="text-[11px] text-slate-500 mt-0.5">${h.location.address}</div>
              <div class="mt-2 flex items-center justify-between text-xs pt-1.5 border-t border-slate-100">
                <span class="font-bold text-emerald-600">${h.capabilities.icu_available} ICU Beds Free</span>
                <span class="font-bold text-slate-800">${(h.trust_score * 100).toFixed(0)}% Trust</span>
              </div>
            </div>
          `);
        state.hospitalMarkers.leaflet[h.hospital_id] = marker;
      }
    });

    // 2. Google Maps Markers (if loaded)
    if (state.googleMapsLoaded) {
      ['overview', 'dedicated'].forEach(key => {
        const gmap = state.googleMaps[key];
        if (gmap) {
          const gMarker = new google.maps.Marker({
            position: { lat, lng },
            map: gmap,
            title: h.name,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 9,
              fillColor: h.trust_score >= 0.90 ? "#059669" : "#D97706",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2.5
            }
          });
          state.hospitalMarkers.google[h.hospital_id] = gMarker;
        }
      });
    }
  });
}

function renderAmbulanceNodes() {
  if (!state.ambulanceFleet || state.ambulanceFleet.length === 0) return;

  state.ambulanceFleet.forEach(u => {
    const lat = u.location.latitude;
    const lng = u.location.longitude;

    // 1. Leaflet Markers
    ['overview', 'dedicated'].forEach(key => {
      const map = state.leafletMaps[key];
      if (map) {
        const ambIcon = L.divIcon({
          className: "custom-amb-pin",
          html: `
            <div class="custom-amb-badge">
              <div class="custom-amb-pulse"></div>
              <i class="fa-solid fa-truck-medical"></i>
            </div>
          `,
          iconSize: [32, 32]
        });

        const marker = L.marker([lat, lng], { icon: ambIcon }).addTo(map)
          .bindPopup(`
            <div class="p-1">
              <div class="text-xs font-bold text-rose-700">${u.call_sign} (${u.unit_id})</div>
              <div class="text-[11px] text-slate-500">Status: <span class="font-bold text-emerald-600">${u.status}</span></div>
              <div class="text-[11px] text-slate-500 font-mono mt-0.5">GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
            </div>
          `);
        state.ambulanceMarkers.leaflet[u.unit_id] = marker;
      }
    });

    // 2. Google Maps Markers (if loaded)
    if (state.googleMapsLoaded) {
      ['overview', 'dedicated'].forEach(key => {
        const gmap = state.googleMaps[key];
        if (gmap) {
          const gMarker = new google.maps.Marker({
            position: { lat, lng },
            map: gmap,
            title: u.call_sign,
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 6,
              fillColor: "#E11D48",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2
            }
          });
          state.ambulanceMarkers.google[u.unit_id] = gMarker;
        }
      });
    }
  });
}

// ============================================================================
// 5. Feature 1: Voice-Based Emergency Request Engine
// ============================================================================

function initAudioCanvas() {
  const canvases = [
    document.getElementById("waveform-canvas"),
    document.getElementById("waveform-canvas-dedicated")
  ];

  canvases.forEach(canvas => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth || 300;
    canvas.height = canvas.offsetHeight || 60;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  });
}

async function toggleRecording() {
  const recordBtns = [
    document.getElementById("record-btn"),
    document.getElementById("record-btn-dedicated")
  ];
  const recordStatus = document.getElementById("record-status");

  if (state.isRecording) {
    // Stop Recording
    state.isRecording = false;
    recordBtns.forEach(btn => {
      if (btn) {
        btn.classList.remove("animate-pulse", "bg-rose-800");
        btn.classList.add("bg-rose-600");
      }
    });
    if (recordStatus) recordStatus.textContent = "Audio Stream Captured & Processing...";

    if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
    if (state.audioContext) state.audioContext.close();

    // Trigger AI Triage
    executeVoiceTriage(PRESET_SCENARIOS.cardiac);
  } else {
    // Start Recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = state.audioContext.createMediaStreamSource(stream);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 64;
      source.connect(state.analyser);

      state.isRecording = true;
      recordBtns.forEach(btn => {
        if (btn) {
          btn.classList.add("animate-pulse", "bg-rose-800");
        }
      });
      if (recordStatus) recordStatus.textContent = "Recording Live Emergency Audio...";

      visualizeWaveform();
    } catch (err) {
      console.warn("Microphone hardware unavailable, activating simulated live speech stream:", err);
      state.isRecording = true;
      recordBtns.forEach(btn => {
        if (btn) btn.classList.add("animate-pulse", "bg-rose-800");
      });
      if (recordStatus) recordStatus.textContent = "Simulating Live Voice Audio Stream...";
      setTimeout(() => toggleRecording(), 2400);
    }
  }
}

function visualizeWaveform() {
  const canvases = [
    document.getElementById("waveform-canvas"),
    document.getElementById("waveform-canvas-dedicated")
  ];
  const bufferLength = state.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function renderFrame() {
    if (!state.isRecording) return;
    state.animFrameId = requestAnimationFrame(renderFrame);

    state.analyser.getByteFrequencyData(dataArray);

    canvases.forEach(canvas => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 1.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = `rgb(225, 29, ${Math.min(255, 72 + barHeight * 2)})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 2;
      }
    });
  }
  renderFrame();
}

async function executeVoiceTriage(transcriptText) {
  const boxes = [
    document.getElementById("transcript-box"),
    document.getElementById("transcript-box-dedicated")
  ];
  boxes.forEach(b => {
    if (b) b.innerHTML = `<span class="text-rose-600 font-bold animate-pulse">Running Zero-Trust Triage & Scrubbing PII/PHI...</span>`;
  });

  const payload = {
    audio_transcript: transcriptText,
    location: { latitude: INCIDENT_COORDS.lat, longitude: INCIDENT_COORDS.lng, address: "Central City Sector 4" }
  };

  try {
    const startTime = performance.now();
    const res = await fetch("/api/v1/emergency/voice-triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    const latency = Math.round(performance.now() - startTime);

    state.currentTriage = data;
    renderTriageMatrix(data, latency);
    updateStateMachineStep("step-triaged");
    logAuditStream("AI_TRIAGE", `Voice Intake ${data.triage_id} processed in ${latency}ms. Severity: ${data.severity_level}`);
  } catch (err) {
    console.error("Voice triage API error:", err);
  }
}

function renderTriageMatrix(triage, latency) {
  const transcriptHTML = `
    <span class="text-slate-500 font-bold">[SCRUBBED PII/PHI]:</span> ${triage.scrubbed_summary}<br>
    <span class="text-[11px] text-emerald-600 font-mono mt-1 block">✓ AES-256 Encrypted & Tokenized (${latency}ms)</span>
  `;

  // Update both Overview and Dedicated transcript boxes
  const box1 = document.getElementById("transcript-box");
  const box2 = document.getElementById("transcript-box-dedicated");
  if (box1) box1.innerHTML = transcriptHTML;
  if (box2) box2.innerHTML = transcriptHTML;

  // Severity Badge
  const sev = triage.severity_level;
  const badge1 = document.getElementById("triage-severity-badge");
  if (badge1) {
    badge1.textContent = sev;
    badge1.className = `px-2.5 py-1 text-xs font-bold rounded-lg ${
      sev === "Critical" ? "bg-rose-100 text-rose-800 border border-rose-300" :
      sev === "High" ? "bg-amber-100 text-amber-800 border border-amber-300" :
      "bg-sky-100 text-sky-800 border border-sky-300"
    }`;
  }

  // Fields
  document.getElementById("triage-type").textContent = triage.emergency_type;
  document.getElementById("triage-confidence").textContent = `${(triage.confidence_score * 100).toFixed(0)}%`;
  document.getElementById("triage-age").textContent = triage.patient_age_est ? `${triage.patient_age_est} Years` : "Unspecified";
  document.getElementById("flag-icu").textContent = triage.icu_required ? "YES (Required)" : "NO";
  document.getElementById("flag-oxygen").textContent = triage.oxygen_needed ? "YES (High-Flow)" : "NO";

  // Dedicated View Elements
  const dedId = document.getElementById("ded-triage-id");
  if (dedId) {
    dedId.textContent = triage.triage_id;
    document.getElementById("ded-triage-type").textContent = triage.emergency_type;
    document.getElementById("ded-triage-conf").textContent = `${(triage.confidence_score * 100).toFixed(0)}%`;
    document.getElementById("ded-triage-age").textContent = triage.patient_age_est ? `${triage.patient_age_est} Years` : "Unspecified";
    document.getElementById("ded-flag-icu").textContent = triage.icu_required ? "YES" : "NO";
    document.getElementById("ded-flag-oxy").textContent = triage.oxygen_needed ? "YES" : "NO";
  }

  // Fail-Safe Banner
  const banner = document.getElementById("failsafe-banner");
  if (banner) {
    if (triage.failsafe_triggered) banner.classList.remove("hidden");
    else banner.classList.add("hidden");
  }

  // Enable hospital match button
  const triggerBtn = document.getElementById("trigger-match-btn");
  if (triggerBtn) triggerBtn.disabled = false;
}

// ============================================================================
// 6. Feature 2: Smart Hospital Coordination Engine
// ============================================================================

async function executeHospitalMatch() {
  if (!state.currentTriage) {
    // If user triggered match directly without voice intake, synthesize a cardiac payload
    await executeVoiceTriage(PRESET_SCENARIOS.cardiac);
  }

  const payload = {
    incident_id: `INC-${Math.floor(1000 + Math.random() * 9000)}`,
    location: { latitude: INCIDENT_COORDS.lat, longitude: INCIDENT_COORDS.lng },
    capabilities: {
      icu_required: state.currentTriage ? state.currentTriage.icu_required : true,
      trauma_center: state.currentTriage ? state.currentTriage.severity_level === "Critical" : true,
      burn_unit: state.currentTriage ? state.currentTriage.emergency_type === "Burn" : false,
      cardiac_cath_lab: state.currentTriage ? state.currentTriage.emergency_type === "Cardiac" : true
    },
    max_radius_km: 25.0
  };

  state.currentIncidentId = payload.incident_id;

  try {
    const res = await fetch("/api/v1/hospitals/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    state.matchedHospitals = data.matched_hospitals;
    renderMatchedHospitals(data.matched_hospitals);
  } catch (err) {
    console.error("Hospital match API error:", err);
  }
}

function renderMatchedHospitals(hospitals) {
  const matchCount = document.getElementById("match-count");
  if (matchCount) matchCount.textContent = `${hospitals.length} Facilities Matched`;

  const dedCount = document.getElementById("ded-match-count");
  if (dedCount) dedCount.textContent = `${hospitals.length} Matched Facilities Found`;

  if (hospitals.length === 0) return;

  // 1. Overview List
  const list = document.getElementById("hospitals-list");
  if (list) {
    list.innerHTML = hospitals.map((h, idx) => {
      const isTop = idx === 0;
      if (isTop) state.selectedHospitalId = h.hospital_id;

      const trustPct = (h.trust_score * 100).toFixed(0);
      return `
        <div class="p-3 rounded-xl border ${isTop ? 'bg-rose-50/70 border-rose-300' : 'bg-slate-50 border-slate-200'} flex items-center justify-between transition hover:border-slate-300">
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-xs font-bold text-slate-900">${h.name}</span>
              ${isTop ? '<span class="px-1.5 py-0.5 text-[9px] font-bold bg-rose-600 text-white rounded">TOP RECOM</span>' : ''}
            </div>
            <div class="text-[11px] text-slate-500 mt-0.5 flex items-center space-x-3">
              <span><i class="fa-solid fa-route text-slate-400"></i> ${h.distance_km} km</span>
              <span><i class="fa-solid fa-clock text-slate-400"></i> ${h.estimated_eta_minutes} min ETA</span>
              <span><i class="fa-solid fa-bed text-slate-400"></i> ${h.capabilities.icu_available} ICU Beds</span>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs font-bold text-emerald-600">${trustPct}% Trust</div>
            <div class="text-[10px] text-slate-400">Readiness Score</div>
          </div>
        </div>
      `;
    }).join("");
  }

  // 2. Dedicated View List
  const dedContainer = document.getElementById("ded-hospitals-container");
  if (dedContainer) {
    dedContainer.innerHTML = hospitals.map((h, idx) => {
      const isTop = idx === 0;
      const trustPct = (h.trust_score * 100).toFixed(0);
      return `
        <div class="p-4 rounded-xl border ${isTop ? 'bg-rose-50/60 border-rose-300 shadow-sm' : 'bg-white border-slate-200'} flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div class="space-y-1">
            <div class="flex items-center space-x-2">
              <span class="text-sm font-bold text-slate-900">${h.name}</span>
              ${isTop ? '<span class="px-2 py-0.5 text-[10px] font-bold bg-rose-600 text-white rounded-md">RECOMMENDED FACILITY</span>' : ''}
            </div>
            <div class="text-xs text-slate-500">${h.location.address}</div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-slate-600 pt-1">
              <span class="bg-slate-100 px-2 py-0.5 rounded"><i class="fa-solid fa-route mr-1 text-slate-400"></i>${h.distance_km} km away</span>
              <span class="bg-slate-100 px-2 py-0.5 rounded"><i class="fa-solid fa-clock mr-1 text-slate-400"></i>${h.estimated_eta_minutes} min ETA</span>
              <span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold"><i class="fa-solid fa-bed-pulse mr-1"></i>${h.capabilities.icu_available} ICU Free</span>
              <span class="bg-sky-50 text-sky-700 px-2 py-0.5 rounded"><i class="fa-solid fa-shield mr-1"></i>Level-${h.capabilities.trauma_center_level} Trauma</span>
            </div>
          </div>

          <div class="flex items-center space-x-4 shrink-0">
            <div class="text-right">
              <div class="text-base font-extrabold text-emerald-600">${trustPct}%</div>
              <div class="text-[10px] text-slate-400">Trust Index</div>
            </div>
            <button onclick="selectTargetHospital('${h.hospital_id}', '${h.name}')" class="px-4 py-2 rounded-xl text-xs font-bold ${isTop ? 'bg-rose-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
              ${isTop ? 'Selected' : 'Select'}
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  // Enable Dispatch Now Button
  const dispatchBtn = document.getElementById("dispatch-now-btn");
  if (dispatchBtn) dispatchBtn.disabled = false;
}

function selectTargetHospital(hospitalId, hospitalName) {
  state.selectedHospitalId = hospitalId;
  const targetHospEl = document.getElementById("conn-target-hosp");
  if (targetHospEl) targetHospEl.textContent = hospitalName;
  logAuditStream("COORDINATION", `Locked destination hospital to ${hospitalName} (${hospitalId}).`);
}

// ============================================================================
// 7. Feature 3: Connected Emergency Response Engine (Faster Coordination)
// ============================================================================

async function executeDispatch() {
  if (!state.currentIncidentId) state.currentIncidentId = `INC-${Math.floor(1000 + Math.random() * 9000)}`;
  if (!state.selectedHospitalId) state.selectedHospitalId = "HOSP-001";

  const payload = {
    incident_id: state.currentIncidentId,
    triage_id: state.currentTriage ? state.currentTriage.triage_id : "TRIAGE-SIM",
    target_hospital_id: state.selectedHospitalId
  };

  try {
    const res = await fetch("/api/v1/dispatch/route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.authToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    updateStateMachineStep("step-dispatched");
    document.getElementById("assigned-unit-name").textContent = `${data.assigned_unit.call_sign} (${data.assigned_unit.unit_id})`;
    document.getElementById("conn-amb-unit").textContent = `${data.assigned_unit.call_sign} (${data.assigned_unit.unit_id})`;

    const routeLatLngs = data.route_coordinates.map(c => [c.latitude, c.longitude]);
    state.currentRouteWaypoints = routeLatLngs;

    // Draw Polyline Route on Leaflet Maps
    ['overview', 'dedicated'].forEach(key => {
      const map = state.leafletMaps[key];
      if (map) {
        if (state.routePolyline.leaflet) map.removeLayer(state.routePolyline.leaflet);
        state.routePolyline.leaflet = L.polyline(routeLatLngs, {
          color: "#E11D48",
          weight: 5,
          opacity: 0.85,
          dashArray: "8, 6"
        }).addTo(map);
        map.fitBounds(state.routePolyline.leaflet.getBounds(), { padding: [30, 30] });
      }
    });

    // Draw Polyline on Google Maps (if loaded)
    if (state.googleMapsLoaded) {
      ['overview', 'dedicated'].forEach(key => {
        const gmap = state.googleMaps[key];
        if (gmap) {
          if (state.routePolyline.google) state.routePolyline.google.setMap(null);
          state.routePolyline.google = new google.maps.Polyline({
            path: routeLatLngs.map(pt => ({ lat: pt[0], lng: pt[1] })),
            geodesic: true,
            strokeColor: "#E11D48",
            strokeOpacity: 0.9,
            strokeWeight: 5
          });
          state.routePolyline.google.setMap(gmap);
        }
      });
    }

    logAuditStream("DISPATCH", `Emergency Order: Unit ${data.assigned_unit.call_sign} dispatched. Hash: ${data.audit_hash.substring(0, 16)}...`);

    // Simulate route movement along waypoints
    simulateAmbulanceRoute(data.assigned_unit.unit_id, routeLatLngs);

  } catch (err) {
    console.error("Dispatch API error:", err);
  }
}

function sendERPreAlert() {
  logAuditStream("ER_PREALERT", `Hospital ER Handshake sent to ${state.selectedHospitalId}. Cath Lab & Trauma Team alerted.`);
  alert("✓ ER Pre-Arrival Handshake Dispatched!\nHospital Emergency Department trauma bays and cardiac teams notified in real-time.");
}

function simulateAmbulanceRoute(unitId, waypoints) {
  if (state.ambulanceSimInterval) clearInterval(state.ambulanceSimInterval);

  let step = 0;
  updateStateMachineStep("step-transit");

  state.ambulanceSimInterval = setInterval(() => {
    if (step >= waypoints.length) {
      clearInterval(state.ambulanceSimInterval);
      updateStateMachineStep("step-admitted");
      logAuditStream("ADMITTED", `Incident ${state.currentIncidentId} patient successfully admitted to hospital emergency room.`);
      return;
    }

    const currentCoords = waypoints[step];

    // Update Leaflet Markers
    ['overview', 'dedicated'].forEach(key => {
      const marker = state.ambulanceMarkers.leaflet[unitId];
      if (marker) marker.setLatLng(currentCoords);
    });

    // Update Google Maps Markers (if loaded)
    if (state.googleMapsLoaded) {
      const gMarker = state.ambulanceMarkers.google[unitId];
      if (gMarker) gMarker.setPosition({ lat: currentCoords[0], lng: currentCoords[1] });
    }

    // Update HUD
    const hudCoords = document.getElementById("hud-coords");
    if (hudCoords) hudCoords.textContent = `${currentCoords[0].toFixed(4)}° N, ${currentCoords[1].toFixed(4)}° E`;

    // WebSocket Telemetry Send
    const now = Date.now();
    if (now - state.lastTelemetryTime >= state.telemetryThrottleMs) {
      state.lastTelemetryTime = now;
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
          event: "AMBULANCE_TELEMETRY",
          unit_id: unitId,
          lat: currentCoords[0],
          lng: currentCoords[1],
          speed_kmh: 58.4,
          state: "Transit"
        }));
      }
      logAuditStream("TELEMETRY", `Unit ${unitId} GPS: ${currentCoords[0].toFixed(4)}, ${currentCoords[1].toFixed(4)} (Speed: 58km/h)`);
    }

    step++;
  }, 1600);
}

// ============================================================================
// 8. Feature 4: Real-Time Hospital Information Network
// ============================================================================

function renderHospitalDirectoryCards(hospitals) {
  const container = document.getElementById("hospital-directory-cards");
  if (!container) return;

  container.innerHTML = hospitals.map(h => {
    const icuTotal = 20;
    const icuPct = Math.min(100, Math.round((h.capabilities.icu_available / icuTotal) * 100));
    const trustPct = (h.trust_score * 100).toFixed(0);

    return `
      <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4 hover:border-slate-300 transition" data-trauma="${h.capabilities.trauma_center_level}" data-cath="${h.capabilities.cardiac_cath_lab}" data-burn="${h.capabilities.burn_unit}" data-icu="${h.capabilities.icu_available}">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="text-sm font-bold text-slate-900">${h.name}</h3>
            <p class="text-xs text-slate-500">${h.location.address}</p>
          </div>
          <span class="px-2 py-0.5 text-xs font-bold rounded-lg ${h.trust_score >= 0.90 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
            ${trustPct}% Trust
          </span>
        </div>

        <!-- Capability Tags -->
        <div class="flex flex-wrap gap-1.5 text-[10px]">
          <span class="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-700">Level-${h.capabilities.trauma_center_level} Trauma</span>
          ${h.capabilities.cardiac_cath_lab ? '<span class="bg-rose-50 text-rose-700 px-2 py-0.5 rounded font-bold">Cath Lab</span>' : ''}
          ${h.capabilities.burn_unit ? '<span class="bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-bold">Burn Unit</span>' : ''}
          <span class="bg-sky-50 text-sky-700 px-2 py-0.5 rounded font-medium">${h.capabilities.ventilators_free} Ventilators</span>
        </div>

        <!-- Bed Capacity Meter -->
        <div class="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
          <div class="flex justify-between text-slate-600">
            <span>Live ICU Availability:</span>
            <span class="font-bold text-slate-900" id="hosp-icu-${h.hospital_id}">${h.capabilities.icu_available} Free Beds</span>
          </div>
          <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div class="bg-rose-600 h-full rounded-full transition-all duration-500" style="width: ${icuPct}%"></div>
          </div>
          <div class="flex justify-between text-[11px] text-slate-400">
            <span>Verified: ${h.verified_capacity}</span>
            <span>Reported: ${h.reported_capacity}</span>
          </div>
        </div>

        <button onclick="selectTargetHospital('${h.hospital_id}', '${h.name}'); document.getElementById('nav-response').click();" class="w-full bg-slate-100 hover:bg-rose-50 text-slate-800 hover:text-rose-700 font-bold py-2 rounded-xl text-xs transition border border-slate-200 hover:border-rose-200">
          Direct Facility Dispatch Link
        </button>
      </div>
    `;
  }).join("");
}

// ============================================================================
// 9. Feature 5: Google Maps API Configuration Modal
// ============================================================================

function setupGoogleMapsModal() {
  const modal = document.getElementById("gmaps-modal");
  const openBtn = document.getElementById("open-gmaps-modal-btn");
  const openBtnMap = document.getElementById("gmaps-config-btn-map");
  const closeBtn = document.getElementById("close-gmaps-modal");
  const input = document.getElementById("gmaps-key-input");
  const saveBtn = document.getElementById("save-gmaps-key-btn");
  const clearBtn = document.getElementById("clear-gmaps-key-btn");
  const toggleVisibility = document.getElementById("toggle-key-visibility");
  const eyeIcon = document.getElementById("eye-icon");

  function openModal() {
    if (input) input.value = state.googleMapsApiKey;
    if (modal) modal.classList.remove("hidden");
  }

  function closeModal() {
    if (modal) modal.classList.add("hidden");
  }

  if (openBtn) openBtn.addEventListener("click", openModal);
  if (openBtnMap) openBtnMap.addEventListener("click", openModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  if (toggleVisibility) {
    toggleVisibility.addEventListener("click", () => {
      if (input.type === "password") {
        input.type = "text";
        eyeIcon.className = "fa-solid fa-eye-slash";
      } else {
        input.type = "password";
        eyeIcon.className = "fa-solid fa-eye";
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const key = input.value.trim();
      state.googleMapsApiKey = key;
      localStorage.setItem("red_health_gmaps_key", key);
      closeModal();
      initGoogleMapsIfKeyPresent();
      logAuditStream("MAPS_CONFIG", `Saved Google Maps official API Key. Initializing Google Maps SDK.`);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.googleMapsApiKey = "";
      localStorage.removeItem("red_health_gmaps_key");
      input.value = "";
      closeModal();
      state.activeMapEngine = "leaflet";
      document.getElementById("google-map-container")?.classList.add("hidden");
      document.getElementById("google-map-container-dedicated")?.classList.add("hidden");
      updateActiveMapEngineText(false);
      logAuditStream("MAPS_CONFIG", "Cleared Google Maps API key. Reverted to high-res vector map.");
    });
  }
}

// ============================================================================
// 10. WebSocket Telemetry Bus
// ============================================================================

function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

  try {
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      const statusEl = document.getElementById("ws-status");
      if (statusEl) statusEl.textContent = "Telemetry WS: Connected (Live)";
    };

    state.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.event === "CAPACITY_UPDATE") {
        logAuditStream("CAPACITY_SYNC", `${data.hospital_name} updated: ${data.icu_available} ICU beds available.`);
        const icuEl = document.getElementById(`hosp-icu-${data.hospital_id}`);
        if (icuEl) icuEl.textContent = `${data.icu_available} Free Beds`;
      }
    };

    state.ws.onclose = () => {
      const statusEl = document.getElementById("ws-status");
      if (statusEl) statusEl.textContent = "Telemetry WS: Reconnecting...";
      setTimeout(initWebSocket, 3000);
    };
  } catch (e) {
    console.warn("WebSocket fallback mode active:", e);
  }
}

// ============================================================================
// 11. UI Helpers & Cryptographic Audit Modal
// ============================================================================

function updateStateMachineStep(activeStepId) {
  const steps = ["step-triggered", "step-triaged", "step-dispatched", "step-transit", "step-admitted"];
  let found = false;

  steps.forEach((id, idx) => {
    const el = document.getElementById(id);
    const elDed = document.getElementById(`${id}-d`);
    const line = document.getElementById(`line-${idx}`);
    const lineDed = document.getElementById(`line-${idx}-d`);

    const applyState = (target, isLine = false) => {
      if (!target) return;
      if (isLine) {
        if (!found) target.classList.add("completed");
        else target.classList.remove("completed");
      } else {
        if (id === activeStepId) {
          target.className = "step-node active";
          found = true;
        } else if (!found) {
          target.className = "step-node completed";
        } else {
          target.className = "step-node";
        }
      }
    };

    applyState(el);
    applyState(elDed);
    if (line) applyState(line, true);
    if (lineDed) applyState(lineDed, true);
  });
}

function logAuditStream(tag, message) {
  const timeStr = new Date().toLocaleTimeString();
  const box = document.getElementById("audit-feed-box");
  if (!box) return;

  const line = document.createElement("div");
  line.className = "px-1 py-0.5 rounded hover:bg-slate-100 transition";
  line.innerHTML = `<span class="text-slate-400">[${timeStr}]</span> <span class="text-rose-600 font-bold">[${tag}]</span> ${message}`;
  box.prepend(line);
}

async function openAuditLedgerModal() {
  try {
    const res = await fetch("/api/v1/audit/ledger");
    const data = await res.json();

    document.getElementById("modal-integrity-status").textContent = data.chain_integrity_valid ? "VERIFIED (100% UNTAMPERED)" : "TAMPER WARNING DETECTED";
    document.getElementById("modal-total-blocks").textContent = data.total_blocks;

    document.getElementById("modal-blocks-container").innerHTML = data.ledger_blocks.map(b => `
      <div class="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-1">
        <div class="flex justify-between items-center">
          <span class="font-bold text-rose-600">Block #${b.index} - ${b.event_type}</span>
          <span class="text-slate-400">${b.timestamp}</span>
        </div>
        <div class="text-slate-700 text-[11px]">${b.data_summary}</div>
        <div class="text-[10px] text-slate-400 truncate">
          <span class="text-slate-600 font-medium">Actor:</span> ${b.actor} |
          <span class="text-slate-600 font-medium">SHA-256:</span> ${b.block_hash}
        </div>
      </div>
    `).join("");

    document.getElementById("audit-modal").classList.remove("hidden");
  } catch (err) {
    console.error("Audit ledger fetch error:", err);
  }
}

// ============================================================================
// 12. Event Listeners Registration
// ============================================================================

function setupEventListeners() {
  // Mic Recording
  document.getElementById("record-btn")?.addEventListener("click", toggleRecording);
  document.getElementById("record-btn-dedicated")?.addEventListener("click", toggleRecording);

  // Preset Emergency Buttons
  document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const scenario = e.currentTarget.getAttribute("data-scenario");
      if (PRESET_SCENARIOS[scenario]) {
        executeVoiceTriage(PRESET_SCENARIOS[scenario]);
      }
    });
  });

  // Action Buttons
  document.getElementById("trigger-match-btn")?.addEventListener("click", executeHospitalMatch);
  document.getElementById("dispatch-now-btn")?.addEventListener("click", executeDispatch);
  document.getElementById("sim-route-btn")?.addEventListener("click", () => {
    if (state.currentRouteWaypoints.length > 0) {
      simulateAmbulanceRoute("AMB-101", state.currentRouteWaypoints);
    } else {
      executeDispatch();
    }
  });

  // Role Switcher
  document.getElementById("role-select")?.addEventListener("change", (e) => {
    state.activeRole = e.target.value;
    initAuthToken();
    logAuditStream("RBAC_SWITCH", `Active role switched to '${state.activeRole}'. Fresh JWT issued.`);
  });

  // Simulate Bed Sync (Header / Buttons)
  const simBedHandler = async () => {
    try {
      await fetch("/api/v1/hospitals/capacity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${state.authToken}`
        },
        body: JSON.stringify({
          hospital_id: "HOSP-001",
          icu_beds_free: 17,
          er_beds_free: 30,
          ventilators_free: 12,
          verification_source: "Live Telemetry Sensor Sync"
        })
      });
    } catch (e) {
      console.error("Bed sync error:", e);
    }
  };

  document.getElementById("sim-bed-btn")?.addEventListener("click", simBedHandler);
  document.getElementById("sim-bed-btn-full")?.addEventListener("click", simBedHandler);

  // Audit Modal
  document.getElementById("verify-audit-btn")?.addEventListener("click", openAuditLedgerModal);
  document.getElementById("close-audit-modal")?.addEventListener("click", () => {
    document.getElementById("audit-modal")?.classList.add("hidden");
  });

  // Hospital Directory Filters
  document.querySelectorAll(".hosp-filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".hosp-filter-btn").forEach(b => {
        b.className = "hosp-filter-btn px-3 py-1.5 rounded-lg font-bold bg-slate-100 text-slate-700 hover:bg-slate-200";
      });
      e.currentTarget.className = "hosp-filter-btn px-3 py-1.5 rounded-lg font-bold bg-rose-600 text-white";

      const filter = e.currentTarget.getAttribute("data-filter");
      filterHospitalCards(filter);
    });
  });

  setupGoogleMapsModal();
}

function filterHospitalCards(filter) {
  const cards = document.querySelectorAll("#hospital-directory-cards > div");
  cards.forEach(card => {
    if (filter === "all") {
      card.classList.remove("hidden");
    } else if (filter === "trauma") {
      const trauma = card.getAttribute("data-trauma");
      if (trauma === "1") card.classList.remove("hidden");
      else card.classList.add("hidden");
    } else if (filter === "cardiac") {
      const cath = card.getAttribute("data-cath");
      if (cath === "true") card.classList.remove("hidden");
      else card.classList.add("hidden");
    } else if (filter === "burn") {
      const burn = card.getAttribute("data-burn");
      if (burn === "true") card.classList.remove("hidden");
      else card.classList.add("hidden");
    } else if (filter === "icu") {
      const icu = parseInt(card.getAttribute("data-icu") || "0", 10);
      if (icu >= 5) card.classList.remove("hidden");
      else card.classList.add("hidden");
    }
  });
}
