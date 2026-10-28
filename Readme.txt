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
   * Uses an advanced trust-and-readiness scoring model
