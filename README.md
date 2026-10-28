# RED Emergency Connect 🚑🚨
> **Autonomous Voice Triage, Smart Hospital Coordination & Real-Time Fleet Telemetry**  
> *Submitted for Hack in Hills, Powered by TinyFish*

[![Live Deployment](https://img.shields.io/badge/Live-Prototype-red?style=for-the-badge&logo=vercel)](https://red-health-emergency-connect.vercel.app/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Leaflet](https://img.shields.io/badge/Maps-Leaflet.js-199900?style=for-the-badge&logo=leaflet)](https://leafletjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

---

## 🔍 Overview

**RED Emergency Connect** is a zero-trust, high-throughput emergency orchestration platform built to slash response latency between distress calls and hospital admission. Traditional emergency dispatch suffers from manual bottlenecks, lack of real-time bed visibility, and communication delays. Our prototype bridges this gap through sub-second AI voice intake, automated HIPAA PII/PHI de-identification, live hospital capability matching, real-time WebSocket ambulance telemetry, and a cryptographic SHA-256 audit ledger.

---

## 🚀 Core Platform Features

1. **Sub-500ms AI Voice Intake & HIPAA De-Identification**
   * Captures live Web Audio API frequency spectrum streams.
   * Instantly transcribes emergency audio and automatically scrubs sensitive Personal Identifiable Information (PII) to meet strict compliance standards.
   * Dynamically populates an **AI Triage Matrix** evaluating clinical urgency scores, patient age estimates, and specific needs (ICU beds, oxygen support).

2. **Smart Hospital Capability Matching**
   * Pairs real-time clinical demand with verified hospital readiness (Trauma Levels, Burn Units, and live ICU/ER bed inventories).
   * Uses an advanced trust-and-readiness scoring model combining traffic ETA, distance, and historical admission acceptance rates.

3. **Real-Time WebSocket Fleet Telemetry**
   * Integrated with interactive Leaflet and Google Maps architecture.
   * Streams live GPS vehicle coordinates, current speed, and dynamic ETAs for active ambulance units (`AMB-101` through `104`).
   * Syncs paramedics and ER bays across a 5-step lifecycle state machine (*Triggered ➔ Triaged ➔ Dispatched ➔ In Transit ➔ Admitted*).

4. **Cryptographic SHA-256 Immutable Audit Ledger**
   * Every critical event—from voice capture to bed reservation—is immutably chained into a local cryptographic ledger with a **100% tamper-proof verification check** for absolute zero-trust accountability.

---

## 🛠️ Tech Stack

* **Backend:** FastAPI (Python), High-Throughput WebSockets, RESTful Endpoints.
* **Frontend:** Vanilla JavaScript, HTML5 Web Audio API, Modern CSS / Tailwind Architecture.
* **Mapping & Telemetry:** Leaflet.js Vector Tiles, Google Maps JavaScript API SDK Integration.
* **Security & Compliance:** AES-256 Tokenization, SHA-256 Cryptographic Hashing Ledger, HIPAA/DISHA-aligned PII scrubbers.

---

## 📂 Project Architecture

```text
red-emergency-connect/
├── index.html              # Main Command Center UI & Role-Based Layout
├── assets/                 # Icons, Logos & Styling Sheets
├── js/                     # Frontend State Machines, Map Handlers & Audio Visualizers
├── backend/                # FastAPI Endpoints, Telemetry Bus & Triage Logic
└── README.md               # Project Documentation
