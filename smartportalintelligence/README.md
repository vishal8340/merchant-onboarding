# SmartPortalIntelligence

An AI-powered merchant onboarding platform built for the BFSI Hackathon 2026. The system automates the full merchant onboarding lifecycle — from secure login and application submission to document intelligence, parallel AI agent verification, ML-based risk scoring with LIME explainability, human review, and real-time AI cost telemetry — using an event-driven microservices architecture with role-based access control.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [End-to-End Workflow](#end-to-end-workflow)
- [Project Structure](#project-structure)
- [Services & Ports](#services--ports)
- [Tech Stack](#tech-stack)
- [Role-Based Access Control](#role-based-access-control)
- [Default Users](#default-users)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Infrastructure](#infrastructure)
  - [Quick Start (All Services)](#quick-start-all-services)
  - [Manual Start](#manual-start)
- [Environment Variables](#environment-variables)
- [AI Agents](#ai-agents)
- [Smart Risk Scoring Service](#smart-risk-scoring-service)
- [AI Cost Telemetry](#ai-cost-telemetry)
- [Application Status Flow](#application-status-flow)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React/TS)                          │
│  LoginScreen → ApplicationForm → DocumentUpload → ApplicationStatus │
│  Dashboard · ReviewConsole · DocumentIntelligence · TelemetryDash   │
│  AuthContext (JWT) · ProtectedRoute (RBAC) · UserHeader             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ REST API (:3001)
┌──────────────────────────▼──────────────────────────────────────────┐
│                     BACKEND (Node.js/Express/TS)                    │
│                                                                     │
│  ┌──────────────┐   ┌─────────────┐   ┌──────────────────────────┐ │
│  │  REST API    │   │  AWS        │   │  OnboardingOrchestrator  │ │
│  │  /api/*      │──▶│  Textract   │   │  (Event-Driven)          │ │
│  │  /auth/*     │   │  (OCR/Forms)│   └──────────┬───────────────┘ │
│  └──────────────┘   └─────────────┘              │ RabbitMQ        │
│         │           PDF→PNG (Ghostscript)  ┌─────▼───────────────┐ │
│  ┌──────▼──────┐                           │ Parallel Agents     │ │
│  │  MongoDB    │◀──────────────────────────│ KYC · MCC · Risk    │ │
│  │  (persist)  │                           └─────────────────────┘ │
│  └─────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────┘
         │                        │                        │
┌────────▼────────┐   ┌───────────▼────────┐   ┌──────────▼──────────┐
│   KYC Agent     │   │    MCC Agent        │   │    Risk Agent        │
│ Identity & Doc  │   │ Categorization +    │   │ Fraud & Compliance   │
│ Verification    │   │ MCC Analyser (Java) │   │ + Smart Risk Scoring │
└─────────────────┘   └───────────┬────────┘   └──────────┬──────────┘
                                  │                        │
                    EPAM AI DIAL  │                        │ HTTP + RabbitMQ
                  (Claude 3.5 Sonnet)                      ▼
                                  │              ┌─────────────────────┐
                                  │              │  Smart Risk Scoring │
                                  │              │  (Java Spring Boot) │
                                  │              │  Random Forest + LIME│
                                  │              │  :8080              │
                                  ▼              └─────────────────────┘
                         ┌─────────────────┐
                         │  MCC Analyser   │
                         │  (Java Spring)  │
                         │  :8091          │
                         └─────────────────┘
```

---

## End-to-End Workflow

### Step 1 — Authentication
Users log in via the **LoginScreen** using pre-seeded credentials. The backend validates credentials against bcrypt-hashed passwords in MongoDB, issues a JWT token, and returns the user's role. The frontend stores the session in `sessionStorage` and routes the user based on their role:
- `ADMIN` → Dashboard
- `APP_MANAGER` → AI Telemetry Dashboard
- `USER` (merchant) → New Application form

### Step 2 — Application Submission
A merchant fills in the **ApplicationForm** (business name, type, country, Tax ID, contact details, website). A draft application is created in MongoDB with status `DRAFT`.

### Step 3 — Document Upload
The merchant uploads business documents (registration certificate, tax docs, etc.) via **DocumentUpload**. PDFs are automatically converted to PNG via Ghostscript before being sent to **AWS Textract** for OCR — extracting full text, key-value form fields, and tables in a single API call.

### Step 4 — Application Submission Trigger
The merchant submits the application. Status changes to `SUBMITTED`, and the **OnboardingOrchestrator** begins event-driven processing.

### Step 5 — Parallel Agent Processing (RabbitMQ)
The orchestrator publishes three events simultaneously to RabbitMQ queues:

| Queue | Agent | Role |
|---|---|---|
| `agent.kyc` | KYC Agent | Identity & document verification |
| `agent.mcc` | MCC Agent | Business categorisation & MCC code assignment |
| `agent.risk` | Risk Agent | Fraud risk & compliance assessment |

Application status is set to `PROCESSING`. Every AI call made during processing is recorded by the **TelemetryService** with token counts, latency, and cost.

### Step 6 — KYC Agent
- Cross-validates merchant-supplied data against Textract-extracted fields (business name, Tax ID, email, address, license number).
- Detects mismatches and flags them for manual review.
- Calls **EPAM AI DIAL** (Claude 3.5 Sonnet) for nuanced identity analysis.
- Publishes result to `result.kyc`.

### Step 7 — MCC Agent
- Maps business type to an MCC code (e.g., `RETAIL → 5999`, `CRYPTO → 6051`).
- Scans all Textract document text for high-risk keywords (gambling, cannabis, firearms, etc.).
- Calls the **MCC Analyser** Java microservice (`:8091`) for deep classification.
- Calls **EPAM AI DIAL** for AI-assisted categorisation.
- Publishes result to `result.mcc`.

### Step 8 — Risk Agent
- Evaluates country risk, business type risk, and email quality (disposable email detection).
- Scans Textract output for fraud-signal terms (shell company, bearer shares, OFAC, etc.).
- Calls the **Smart Risk Scoring** Java service (`:8080`) for ML-based fraud scoring with LIME explanations.
- Calls **EPAM AI DIAL** for additional intelligent risk scoring.
- Publishes result to `result.risk`.

### Step 9 — Orchestrator Aggregation
When all three agent results are received, the orchestrator:
- Collects scores and findings from KYC, MCC, and Risk agents.
- Computes the final decision.
- Updates the application status in MongoDB.

### Step 10 — Final Status
| Outcome | Status | Next Action |
|---|---|---|
| All agents pass | `APPROVED` | Merchant credentials generated |
| Any agent fails critically | `REJECTED` | Application closed |
| Any agent flags for review | `MANUAL_REVIEW` | Sent to human reviewer |

### Step 11 — Human Review Console (if needed)
Compliance officers use the **ReviewConsole** to inspect agent findings, Textract-extracted data, and audit logs. They approve or reject with written comments. Status is updated to `APPROVED` or `REJECTED`.

### Step 12 — Document Intelligence View
The **DocumentIntelligence** screen provides a full view of all AWS Textract results — merged key-value pairs, extracted text, word counts, and per-document breakdowns — for any application.

### Step 13 — AI Cost & Telemetry Dashboard
The **TelemetryDashboard** (accessible to `APP_MANAGER` role) provides real-time visibility into AI service usage across all applications:
- Per-application breakdown of every AI call (DIAL, Textract, MCC Analyser, Risk Scoring)
- Token counts (prompt + completion), latency, and estimated cost per call
- Grand totals: total LLM cost, Textract pages processed, error count
- Cost rates: Claude 3.5 Sonnet at $0.003/1k input, $0.015/1k output; Textract at $0.00065/page

---

## Project Structure

```
smartportalintelligence/
├── start-all.sh                         # One-command startup for all 4 services
├── agent-details.html                   # AI agent reference documentation
├── architecture-v9.html                 # System architecture diagram
│
├── frontend/                            # React 19 + TypeScript SPA (:3000)
│   └── src/
│       ├── context/AuthContext.tsx       # JWT auth state, login/logout, role
│       ├── routes/ProtectedRoute.tsx     # RBAC guard + UserHeader wrapper
│       ├── api/client.ts                 # Axios API client
│       ├── types.ts                      # Shared TypeScript types
│       └── components/
│           ├── LoginScreen.tsx           # Login form with role-based redirect
│           ├── UserHeader.tsx            # Persistent top bar with role badge
│           ├── ApplicationForm.tsx       # Merchant onboarding form
│           ├── Dashboard.tsx             # Applications overview (ADMIN)
│           ├── ApplicationStatus.tsx     # Per-application status tracker
│           ├── DocumentUpload.tsx        # Document upload UI
│           ├── DocumentIntelligence.tsx  # Textract results viewer
│           ├── ReviewConsole.tsx         # Human reviewer console (ADMIN)
│           └── TelemetryDashboard.tsx    # AI cost & usage dashboard (APP_MANAGER)
│
├── backend/                             # Node.js + Express + TypeScript (:3001)
│   ├── docker-compose.yml               # RabbitMQ container
│   └── src/
│       ├── server.ts                    # Express app, REST/auth routes, PDF→PNG
│       ├── orchestrator.ts              # Event-driven workflow coordinator
│       ├── storage.ts                   # In-memory fallback store
│       ├── types.ts                     # Domain types & enums
│       ├── agents/
│       │   ├── kycAgent.ts              # KYC verification agent
│       │   ├── mccAgent.ts              # MCC categorisation agent
│       │   └── riskAgent.ts             # Risk assessment + Smart Risk Scoring
│       ├── models/
│       │   ├── Application.ts           # Mongoose application model
│       │   └── User.ts                  # Mongoose user model + bcrypt + seed
│       ├── services/
│       │   ├── dialService.ts           # EPAM AI DIAL client (BPE token counting)
│       │   ├── textractService.ts       # AWS Textract document analysis
│       │   └── telemetryService.ts      # AI call tracking: tokens, latency, cost
│       ├── scripts/
│       │   ├── backfillTokens.ts        # Retroactively estimate missing token counts
│       │   ├── backfillNoneRisks.ts     # Fix applications with missing risk scores
│       │   ├── deduplicateMerchants.ts  # Remove duplicate merchant records
│       │   └── generateSampleDocs.ts    # Generate test documents (PDFKit)
│       └── events/
│           └── eventBus.ts              # RabbitMQ AMQP event bus wrapper
│
├── mcc-analyser/                        # Java Spring Boot MCC service (:8091)
│   └── src/main/java/com/epam/mcc_analyser/
│       ├── classification/
│       │   ├── MccService.java          # Core MCC classification logic
│       │   ├── MccAuditor.java          # Audit trail for MCC decisions
│       │   ├── MccAnalysisReport.java   # Analysis report DTO
│       │   └── FinalValidatedResult.java
│       ├── controller/
│       │   └── MccClassificationController.java  # REST endpoint
│       └── service/
│           ├── SmartMccAnalyser.java    # AI-enhanced MCC analyser
│           └── GuardrailService.java    # Input validation & guardrails
│
└── smart-risk-scoring/                  # Java Spring Boot ML risk service (:8080)
    └── src/main/java/com/riskscoring/
        ├── api/
        │   ├── RiskController.java      # REST endpoint (/api/risk/*)
        │   ├── MerchantRequest.java     # Input DTO
        │   └── RiskResponse.java        # Response with score + explanation
        ├── model/                       # Random Forest training & inference (Weka)
        ├── data/                        # Synthetic data generation & CSV loading
        ├── explain/                     # LIME-style explainability engine
        ├── llm/                         # GPT-4o integration for narrative summaries
        ├── messaging/                   # RabbitMQ consumer/producer
        └── config/                      # Spring configuration
```

---

## Services & Ports

| Service | Technology | Port |
|---|---|---|
| Frontend | React 19 + TypeScript | `3000` |
| Backend API | Node.js + Express | `3001` |
| Smart Risk Scoring | Java 25, Spring Boot 3.5 | `8080` |
| MCC Analyser | Java 25, Spring Boot | `8091` |
| MongoDB | MongoDB | `27017` |
| RabbitMQ AMQP | RabbitMQ 3 | `5672` |
| RabbitMQ Management UI | RabbitMQ 3 | `15672` |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, React Router v6, Axios |
| Backend | Node.js, Express, TypeScript, Mongoose, Multer |
| AI/LLM | EPAM AI DIAL — Claude 3.5 Sonnet / GPT-4o |
| Document OCR | AWS Textract (Forms + Tables); Ghostscript (PDF→PNG) |
| Messaging | RabbitMQ (AMQP) |
| Database | MongoDB |
| ML Risk Scoring | Java 25, Spring Boot 3.5, Weka (Random Forest), LIME explainability |
| MCC Service | Java 25, Spring Boot, LangChain4j |
| Token Counting | `gpt-tokenizer` (BPE / cl100k_base) |
| PDF Generation | PDFKit (sample document generation) |
| Containerisation | Docker Compose |

---

## Role-Based Access Control

All routes are protected via `ProtectedRoute` — unauthenticated users are redirected to `/login`.

| Role | Access |
|---|---|
| `ADMIN` | Full access: Dashboard, Review Console, Document Intelligence, Application Status |
| `APP_MANAGER` | AI Cost & Telemetry Dashboard only |
| `USER` | Submit new application, upload documents, view own application status |

---

## Demo Users

No demo passwords are included in this repository. To seed demo accounts, set the corresponding `DEMO_*_PASSWORD` environment variables in a private deployment environment. Accounts without configured passwords are not created.

---

## Getting Started

### Prerequisites

- Node.js >= 18
- Java 25 (Temurin recommended) + Maven 3.8+
- Docker & Docker Compose (for RabbitMQ)
- MongoDB running locally on `27017`
- Ghostscript (`brew install ghostscript` on macOS) for PDF → PNG conversion
- AWS account with Textract access
- EPAM AI DIAL API key

### Infrastructure

Start RabbitMQ with Docker:

```bash
cd backend
docker-compose up -d
```

Verify RabbitMQ at [http://localhost:15672](http://localhost:15672) (user: `admin`, pass: `admin123`).

### Quick Start (All Services)

The `start-all.sh` script launches all four services in the background and runs health checks:

```bash
chmod +x start-all.sh
./start-all.sh
```

Logs are written to:
- `/tmp/mcc-analyser.log`
- `/tmp/smart-risk-scoring.log`
- `/tmp/backend.log`
- `/tmp/frontend.log`

PIDs are saved to `/tmp/merchant-pids.txt` for easy cleanup.

To stop all services:
```bash
cd backend
npm run kill
```

### Manual Start

**Backend (Node.js):**
```bash
cd backend
cp .env.example .env   # fill in your credentials
npm install
npm run dev            # starts on :3001
```

To start all services with live colour-coded output in one terminal:
```bash
cd backend
npm run dev:all        # concurrently runs backend, mcc-analyser, smart-risk-scoring, frontend
```

**Frontend (React):**
```bash
cd frontend
npm install
npm start              # starts on :3000
```

**MCC Analyser (Java):**
```bash
cd mcc-analyser
./mvnw spring-boot:run  # starts on :8091
```

**Smart Risk Scoring (Java):**
```bash
cd smart-risk-scoring
./mvnw spring-boot:run --openai.api.key=<your-dial-key>  # starts on :8080
```

---

## Environment Variables

Create `backend/.env`:

```env
# Server
PORT=3001

# MongoDB
MONGODB_URI=mongodb://localhost:27017/merchant-onboarding

# JWT
JWT_SECRET=<your-secret>

# RabbitMQ
RABBITMQ_URL=amqp://admin:admin123@localhost

# AWS Textract
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
USE_AWS_TEXTRACT=true

# EPAM AI DIAL
DIAL_API_URL=https://ai-proxy.lab.epam.com
DIAL_API_KEY=<your-dial-api-key>
DIAL_MODEL=claude-3-5-sonnet

# External Services
MCC_ANALYSER_URL=http://localhost:8091
SMART_RISK_URL=http://localhost:8080
```

---

## AI Agents

### KYC Agent (`kycAgent.ts`)
Verifies merchant identity by cross-referencing submitted form data against AWS Textract-extracted fields (business name, Tax ID, email, phone, address, license number). Flags mismatches for manual review. Falls back to form-field validation when no Textract data is available. Calls Claude 3.5 Sonnet via EPAM AI DIAL for contextual identity reasoning.

**Scoring:** Starts at 100. Adds up to +20 for verified fields, deducts for mismatches, invalid Tax ID format (`XX-XXXXXXX`), short names, or low document word counts.

### MCC Agent (`mccAgent.ts`)
Assigns a Merchant Category Code (MCC) to the business based on type and document content:

| Business Type | MCC |
|---|---|
| RETAIL | 5999 |
| ECOMMERCE | 5734 |
| SERVICES | 7299 |
| MANUFACTURING | 5085 |
| CRYPTO | 6051 |
| GAMBLING | 7995 |

Scans all Textract document text for high-risk keywords. Delegates to the **MCC Analyser** Java microservice (`:8091`) for AI-enhanced deep classification. Calls Claude 3.5 Sonnet for final categorisation.

### Risk Agent (`riskAgent.ts`)
Multi-layer fraud and compliance assessment:
- **Country risk** — flags merchants from high-risk jurisdictions
- **Business type risk** — flags CRYPTO, GAMBLING, ADULT categories
- **Email quality** — detects disposable email providers
- **Document scanning** — searches Textract text for OFAC/AML signals (shell company, bearer shares, sanctions, etc.)
- **ML scoring** — calls **Smart Risk Scoring** service (`:8080`) for Random Forest–based fraud probability with LIME feature explanations
- **AI summary** — calls Claude 3.5 Sonnet for a narrative risk assessment

---

## Smart Risk Scoring Service

The `smart-risk-scoring` Spring Boot service provides ML-powered merchant risk classification with regulatory-grade explainability.

### Features

| Feature | Type | Risk Relevance |
|---|---|---|
| `business_type` | Categorical | Online/Travel merchants have higher fraud rates |
| `transaction_volume` | Numeric | High volumes may indicate money laundering |
| `location` | Categorical | Geographic compliance risk |
| `chargeback_rate` | Numeric | Direct fraud/dispute indicator |
| `years_in_business` | Numeric | New merchants are statistically riskier |
| `average_transaction_size` | Numeric | Unusually large transactions signal fraud |
| `fraud_flag` | Binary | Prior fraud is the strongest predictor |
| `compliance_score` | Numeric | KYC/AML assessment score |

### Risk Labels
- `chargeback_rate > 0.1` OR `fraud_flag = 1` → **High**
- `compliance_score < 60` OR `transaction_volume > 100,000` → **Medium**
- Otherwise → **Low**

### Configurable Fraud Rules (`application.properties`)

| Rule | Threshold |
|---|---|
| High chargeback | `> 0.05` |
| Bust-out pattern | Age ≤ 2 years + volume > 100,000 |
| Card-not-present fraud | Online type + avg transaction > $500 |
| AML red flag | Compliance < 40 + volume > 80,000 |
| Shell company | Age ≤ 1 year + compliance < 50 |
| High-risk industry | Travel/Subscription + chargeback > 0.03 |

### Explainability
LIME (Local Interpretable Model-agnostic Explanations) identifies which features most influenced each individual risk decision — providing auditable output required by GDPR Article 22 for automated decision-making.

### Integration
- **REST:** `POST /api/risk/score` — synchronous scoring
- **RabbitMQ:** listens on `merchant.risk.request`, responds on `merchant.risk.response`
- **LLM summary:** calls GPT-4o via EPAM proxy to generate a human-readable narrative explanation

---

## AI Cost Telemetry

Every AI call is captured by `TelemetryService` and persisted to MongoDB alongside the application. The **TelemetryDashboard** (role: `APP_MANAGER`) surfaces this data in real time.

**Tracked per call:**
- Service: `DIAL`, `TEXTRACT`, `MCC_ANALYSER`, `RISK_SCORING`
- Agent: `KYC`, `MCC`, `RISK`, `TEXTRACT`, `SYSTEM`
- Token counts — prompt + completion (BPE-estimated via `gpt-tokenizer` when the API does not return usage)
- Latency (ms)
- Estimated cost (USD)

**Cost rates:**

| Model / Service | Input | Output |
|---|---|---|
| Claude 3.5 Sonnet | $0.003 / 1k tokens | $0.015 / 1k tokens |
| GPT-4o | $0.005 / 1k tokens | $0.015 / 1k tokens |
| GPT-4o mini | $0.00015 / 1k tokens | $0.0006 / 1k tokens |
| AWS Textract (AnalyzeDocument) | $0.00065 / page | — |

**Utility scripts:**
- `backfillTokens.ts` — retroactively estimates token counts for records created before the BPE tokenizer was integrated
- `backfillNoneRisks.ts` — patches applications that have missing or `null` risk scores
- `deduplicateMerchants.ts` — removes duplicate merchant records from MongoDB
- `generateSampleDocs.ts` — generates realistic PDF test documents using PDFKit

---

## Application Status Flow

```
DRAFT → SUBMITTED → PROCESSING → APPROVED
                              ↘ REJECTED
                              ↘ MANUAL_REVIEW → APPROVED / REJECTED
```

| Status | Description |
|---|---|
| `DRAFT` | Application created, not yet submitted |
| `SUBMITTED` | Merchant submitted; orchestrator queued |
| `PROCESSING` | KYC, MCC, and Risk agents running in parallel |
| `APPROVED` | All agents passed; merchant onboarded |
| `REJECTED` | Critical failure detected by one or more agents |
| `MANUAL_REVIEW` | Flagged for human compliance officer review |
