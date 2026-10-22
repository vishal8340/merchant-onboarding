# Unified Merchant Onboarding — BFSI Hackathon 2026

An end-to-end AI-powered merchant onboarding platform built for the BFSI Hackathon 2026.  
The system automates KYC, MCC categorisation, and risk scoring using LLMs, RAG pipelines, and ML models.

---

## Architecture Overview

| Layer | Technology | Port |
|---|---|---|
| React Frontend | React 18 · TypeScript · CRA | 3000 |
| Node.js Backend | Express 4 · TypeScript · JWT | 3001 |
| Message Broker | RabbitMQ (Homebrew macOS) | 5673 / 15673 |
| Database | MongoDB (local) | 27017 |
| MCC Analyser | Spring Boot 3.5 · Java 25 · LangChain4j RAG | 8091 |
| Smart Risk Scoring | Spring Boot 3.5 · Java 25 · Weka ML + LIME | 8080 |

**AI Services used:**
- **AWS Textract** — Document OCR (PDF → PNG via Ghostscript, eu-west-1)
- **EPAM AI Proxy** — GPT-4o / gpt-4o-mini via `ai-proxy.lab.epam.com`
- **EPAM DIAL** — GPT-4o via `dial.lab.epam.com` (KYC, MCC, Risk agents)
- **LangChain4j RAG** — MCC Handbook PDF indexed with `text-embedding-3-small`
- **Weka RandomForest** — Trained ML model (`risk_model.ser`, 10 features) + LIME explainer

---

## Services

### frontend/
React 18 SPA with TypeScript.
- Multi-step onboarding wizard (ApplicationForm)
- Document upload with drag-and-drop
- Document Intelligence view (Textract + agent results)
- Application Status with exponential backoff polling (3s → 30s)
- Review Console for admin approval/rejection
- Telemetry Dashboard (15s auto-refresh)
- JWT auth via AuthContext · Axios interceptor on all `/api/*` calls
- React.lazy + Suspense code splitting · useMemo stats · React.memo

### backend/
Node.js + Express 4 orchestrator.
- `OnboardingOrchestrator` — publishes 3 parallel AMQP events; falls back to direct in-process agent execution (`registerDirectAgents()`) when RabbitMQ is unavailable
- `EventBus` — amqplib 0.10.x · topic exchange `merchant.onboarding` · DLQ enabled
- `TextractService` — PDF→PNG (Ghostscript 200 DPI), `Promise.all()` parallel per-doc
- `KYCAgent` — conditional DIAL: skips GPT-4o when score ≥ 85 (~60% of apps)
- `MCCAgent` — 3 retries + exponential backoff; conditional DIAL when RAG conf < 0.6 (~15% of apps)
- `RiskAgent` — Weka ML always runs; DIAL only for HIGH/MANUAL_REVIEW risk (~30% of apps)
- Security: Helmet.js · express-rate-limit · JWT (8h) · bcryptjs (rounds: 12) · requireAuth / requireRole(ADMIN)
- Storage: MongoDB (Mongoose, maxPoolSize:10, compound indexes) + in-memory fallback Map

### mcc-analyser/
Spring Boot 3.5 · Java 25 (Temurin) — MCC classification service.
- `POST /api/v1/onboarding/classify` — LangChain4j RAG pipeline against MCC Handbook PDF
- Model: `gpt-4o-mini` (87% cheaper than GPT-4o)
- `ConcurrentHashMap` result cache keyed by `description|location` (confidence ≥ 0.6)
- `@Lazy` beans for startup safety

### smart-risk-scoring/
Spring Boot 3.5 · Java 25 (Temurin) — ML risk scoring service.
- `POST /api/risk/score` — Weka RandomForest (`risk_model.ser`, 10 features)
- LIME explainer for feature importance breakdown
- GPT-4o LLM risk report via EPAM AI Proxy — only when riskLevel = HIGH
- `CompletableFuture.supplyAsync()` for LIME + LLM in parallel

---

## Quick Start

### Prerequisites
- Java 25 (Temurin) — `brew install --cask temurin@25`
- Node.js 18+ and npm
- MongoDB running locally on port 27017
- RabbitMQ via Homebrew on port 5673:
  ```
  brew install rabbitmq
  # set listeners.tcp.default = 5673 in /opt/homebrew/etc/rabbitmq/rabbitmq.conf
  brew services start rabbitmq
  ```
- AWS credentials configured (`~/.aws/credentials`) with Textract access (eu-west-1)
- Ghostscript: `brew install ghostscript`

### Environment Setup

Create `backend/.env`:
```
RABBITMQ_URL=amqp://admin:admin123@localhost:5673
MONGODB_URI=mongodb://localhost:27017/merchant-onboarding
PORT=3001
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=AKI...
AWS_SECRET_ACCESS_KEY=...
USE_AWS_TEXTRACT=true
DIAL_API_URL=https://ai-proxy.lab.epam.com
DIAL_API_KEY=dial-...
DIAL_MODEL=gpt-4o
JWT_SECRET=your-secret-here
CORS_ORIGINS=http://localhost:3000
```

### Build Java Services
```bash
cd mcc-analyser && mvn clean package -DskipTests && cd ..
cd smart-risk-scoring && mvn clean package -DskipTests && cd ..
```

### Install Node Dependencies
```bash
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### Start All Services
```bash
chmod +x start-all.sh
./start-all.sh
```

This starts all 4 services and writes PIDs to `/tmp/merchant-pids.txt`.  
Logs: `/tmp/mcc-analyser.log`, `/tmp/smart-risk-scoring.log`, `/tmp/backend.log`, `/tmp/frontend.log`

### Stop All Services
```bash
./stop-all.sh
```

### Access
| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |
| RabbitMQ UI | http://localhost:15673 (admin/admin123) |
| MCC Analyser | http://localhost:8091 |
| Risk Scoring | http://localhost:8080 |

---

## AI Cost Optimisations

| Optimisation | Saving |
|---|---|
| Conditional DIAL — skip KYC LLM when score ≥ 85 (~60% apps) | ~20% |
| Conditional DIAL — skip MCC LLM when RAG conf ≥ 0.6 (~85% apps) | ~15% |
| Conditional DIAL — skip Risk LLM for LOW/MEDIUM risk (~70% apps) | ~10% |
| GPT-4o → gpt-4o-mini for MCC RAG classification | ~15% |
| **Total saving vs naive approach** | **~68%** |

Estimated cost: **~$0.009 – $0.018 per application** (was $0.040 – $0.057)

---

## Architecture Diagrams

- `architecture-ai.html` — Full AI usage, cost breakdown, tech stack, data flow
- `architecture-v9.html` — Five-layer architecture, AI pipeline, state machine, E2E flow

---

## Project Structure

```
merchant-onboarding/
├── start-all.sh           # Start all 4 services
├── stop-all.sh            # Stop all 4 services
├── architecture-ai.html   # AI architecture diagram
├── architecture-v9.html   # System architecture diagram
├── agent-details.html     # Agent details view
├── frontend/              # React 18 SPA
├── backend/               # Node.js Express orchestrator
├── mcc-analyser/          # Spring Boot MCC classification (Java 25)
└── smart-risk-scoring/    # Spring Boot risk scoring (Java 25 + Weka)
```

---

## Security

- JWT authentication (8h expiry) on all `/api/*` routes
- bcryptjs password hashing (rounds: 12)
- Helmet.js security headers (CSP, HSTS, X-Frame-Options)
- express-rate-limit: 10 req/15 min (login) · 100 req/60s (API)
- Role-based access: USER / ADMIN / APP_MANAGER
- multer: 5 MB file limit · PDF/JPG/PNG only
- 4-layer duplicate merchant guard

---

*BFSI Hackathon 2026 · Merchant Onboarding System · 5 May 2026*
