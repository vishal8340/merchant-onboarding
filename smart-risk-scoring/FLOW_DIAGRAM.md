# Smart Risk Scoring — Application Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CLIENT / API CONSUMER                                   │
│                                                                                 │
│   ┌──────────────────┐              ┌──────────────────┐                        │
│   │  Sync Request    │              │  Async Request   │                        │
│   │  POST /api/risk/ │              │  POST /api/risk/ │                        │
│   │       score      │              │       queue      │                        │
│   └────────┬─────────┘              └────────┬─────────┘                        │
└────────────┼─────────────────────────────────┼──────────────────────────────────┘
             │                                 │
             ▼                                 ▼
┌────────────────────────┐      ┌──────────────────────────┐
│    RiskController      │      │     RiskProducer         │
│    (Spring REST)       │      │     (Spring REST)        │
│                        │      │                          │
│  Returns full response │      │  Returns correlationId   │
│  after pipeline runs   │      │  + publishes to RabbitMQ │
└────────┬───────────────┘      └────────────┬─────────────┘
         │                                   │
         │                                   ▼
         │                      ┌──────────────────────────┐
         │                      │     RabbitMQ             │
         │                      │  ┌────────────────────┐  │
         │                      │  │ merchant.risk      │  │
         │                      │  │      .request      │  │
         │                      │  └─────────┬──────────┘  │
         │                      └────────────┼─────────────┘
         │                                   │
         │                                   ▼
         │                      ┌──────────────────────────┐
         │                      │     RiskConsumer         │
         │                      │  (RabbitMQ Listener)     │
         │                      └────────────┬─────────────┘
         │                                   │
         ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│                      ═══ RISK SCORING PIPELINE ═══                              │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 0: FRAUD DETECTION (rule-based, <1ms)                            │    │
│  │                                                                         │    │
│  │  Input: 7 merchant fields (no fraudFlag from user)                     │    │
│  │                                                                         │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐       │    │
│  │  │ Chargeback >5%  │  │ Bust-Out Pattern│  │ CNP Fraud Risk   │       │    │
│  │  │ → HIGH_CHARGEBACK│  │ yrs≤2 + vol>100K│  │ Online + avg>500 │       │    │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘       │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐       │    │
│  │  │ AML Red Flag    │  │ Shell Company   │  │ Industry Risk    │       │    │
│  │  │ comp<40 + vol>80K│  │ yrs≤1 + comp<50│  │ Travel/Sub + CB>3%│       │    │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘       │    │
│  │                                                                         │    │
│  │  Output: fraudFlag (0/1) + fraudIndicators[] + fraudSignals{}          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                           │                                                     │
│                           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 1: ML PREDICTION — Weka RandomForest (~50ms)                     │    │
│  │                                                                         │    │
│  │  ┌──────────────┐    ┌──────────────────────┐    ┌────────────────┐    │    │
│  │  │ DataLoader   │───▶│ encodeMerchant()     │───▶│ RandomForest   │    │    │
│  │  │ 8 features   │    │ categorical→numeric  │    │ .classify()    │    │    │
│  │  └──────────────┘    └──────────────────────┘    └───────┬────────┘    │    │
│  │                                                          │             │    │
│  │  Output: riskLabel (Low/Medium/High) + probabilities [L, M, H]        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                           │                                                     │
│                           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 2: RISK SCORE (0-100) + COUNTRY RISK (~1ms)                     │    │
│  │                                                                         │    │
│  │  Risk Score = ML probability (50pts)                                   │    │
│  │             + chargeback penalty (15pts)                               │    │
│  │             + compliance penalty (15pts)                               │    │
│  │             + fraud signals (10pts)                                    │    │
│  │             + volume risk (5pts)                                       │    │
│  │             + business age risk (5pts)                                 │    │
│  │                                                                         │    │
│  │  Country Risk = location → risk level + regulatory notes              │    │
│  │    Miami=ELEVATED(70) | NewYork=MODERATE(50) | SanJose=LOW(30)        │    │
│  │    Chicago=MODERATE(45) | Dallas=LOW(35)                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                           │                                                     │
│                           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 3: DECISION (rule-based, <1ms)                                   │    │
│  │                                                                         │    │
│  │    High   ──▶  DECLINED                                                │    │
│  │    Medium ──▶  CONDITIONAL                                             │    │
│  │    Low    ──▶  APPROVED                                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                           │                                                     │
│                           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 4: LIME EXPLAINABILITY (~500ms)                                  │    │
│  │                                                                         │    │
│  │  1. Perturb input features (500 samples)                               │    │
│  │  2. Get predictions for each perturbed sample                          │    │
│  │  3. Fit weighted linear regression locally                             │    │
│  │  4. Coefficients = feature importance                                  │    │
│  │                                                                         │    │
│  │  Output per feature:                                                   │    │
│  │    feature, weight, rawValue, displayValue, impact, direction, reason  │    │
│  │                                                                         │    │
│  │  Example:                                                              │    │
│  │    fraud_flag | 0.48 | "Yes — prior fraud" | CRITICAL | INCREASES     │    │
│  │    chargeback | 0.36 | "12.00%" | CRITICAL | INCREASES                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                           │                                                     │
│                           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 5: TEMPLATE SUMMARY (free, <1ms)                                 │    │
│  │                                                                         │    │
│  │  Pre-built text with decision, risk, exposure, merchant profile,       │    │
│  │  and top 5 risk factors. Always available, no LLM needed.              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                           │                                                     │
│                           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 6: LLM REPORTS — GPT-4o, 1 API call (~10-30s)                   │    │
│  │                                                                         │    │
│  │  Input: merchant data + ML prediction + LIME + dataset stats           │    │
│  │                                                                         │    │
│  │  ┌─────────────────────────────────────────────────────────────┐       │    │
│  │  │              Single GPT-4o API Call                         │       │    │
│  │  │                                                             │       │    │
│  │  │  ===ANALYST_REPORT===     (200-300 words)                  │       │    │
│  │  │  ===COMPLIANCE_REPORT===  (no limit — thorough)            │       │    │
│  │  │  ===SALES_REPORT===       (≤150 words)                     │       │    │
│  │  │  ===MERCHANT_NOTIFICATION=== (≤100 words)                  │       │    │
│  │  │  ===EXECUTIVE_BRIEF===    (≤50 words)                      │       │    │
│  │  │  ===ANOMALY_DESCRIPTION=== (100-150 words)                 │       │    │
│  │  │  ===OVERRIDE_SUGGESTION=== (≤80 words)                     │       │    │
│  │  │  ===CONSISTENCY_SCORE===  (JSON: score 1-10, agrees T/F)   │       │    │
│  │  │                                                             │       │    │
│  │  └─────────────────────────────────────────────────────────────┘       │    │
│  │                                                                         │    │
│  │  Parsed into 8 separate response fields via delimiter extraction.      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
             │                                   │
             ▼                                   ▼
┌────────────────────────┐      ┌──────────────────────────┐
│   SYNC RESPONSE        │      │     RabbitMQ             │
│   (JSON to client)     │      │  ┌────────────────────┐  │
│                        │      │  │ merchant.risk      │  │
│   Full RiskResponse    │      │  │     .response      │  │
│   with all fields      │      │  │                    │  │
└────────────────────────┘      │  │ Full RiskResponse  │  │
                                │  │ + correlationId    │  │
                                │  └────────────────────┘  │
                                └──────────────────────────┘


═══════════════════════════════════════════════════════════════
                    RESPONSE STRUCTURE
═══════════════════════════════════════════════════════════════

{
  "decision":             "DECLINED",              ← Rule-based
  "riskLabel":            "High",                  ← ML model
  "riskScore":            82,                      ← Composite (0-100)
  "probabilities":        [0.05, 0.10, 0.85],      ← ML confidence
  "financialExposure":    18000.0,                 ← volume × chargeback

  "fraudFlag":            1,                       ← Auto-calculated
  "fraudIndicators":      ["HIGH_CHARGEBACK.."],   ← Triggered rules
  "fraudSignals": {                                ← Detailed checks
    "severity": "CRITICAL",
    "checks": [
      {"check":"Chargeback", "status":"FAIL"},
      {"check":"Bust-Out",   "status":"FAIL"},
      ...
    ]
  },

  "countryRisk": {                                 ← Location assessment
    "location": "Miami",
    "riskLevel": "ELEVATED",
    "score": 70,
    "factors": [...]
  },

  "explanation": [                                 ← LIME (human-readable)
    {"feature":"fraud_flag", "impact":"CRITICAL",
     "reason":"Prior fraud history is the strongest.."}
  ],

  "summary":              "=== PAYMENT GATEWAY..", ← Template (free)

  "llmReport":            "...",                   ← GPT-4o analyst
  "complianceReport":     "...",                   ← GPT-4o compliance
  "salesReport":          "...",                   ← GPT-4o sales
  "merchantNotification": "...",                   ← GPT-4o merchant
  "executiveBrief":       "...",                   ← GPT-4o C-suite
  "anomalyDescription":   "...",                   ← GPT-4o anomaly
  "overrideSuggestion":   "NO_OVERRIDE: ...",      ← GPT-4o override
  "consistencyScore":     "{\"score\":9, ...}"     ← GPT-4o vs ML
}
```

## Technology Stack

```
┌───────────────┬──────────────────────────────────────┐
│ Layer         │ Technology                           │
├───────────────┼──────────────────────────────────────┤
│ API           │ Spring Boot 3.2.5                    │
│ ML Model      │ Weka 3.8.6 RandomForest              │
│ Explainability│ Custom LIME implementation            │
│ LLM           │ GPT-4o (EPAM AI Proxy)               │
│ Messaging     │ RabbitMQ 3 (Docker)                  │
│ Data          │ OpenCSV + Synthetic Generator         │
│ Language      │ Java 17                              │
└───────────────┴──────────────────────────────────────┘
```

## Endpoints

```
POST /api/risk/score          Sync  — full pipeline, waits for LLM
POST /api/risk/queue          Async — publishes to RabbitMQ, returns immediately
GET  /api/risk/queue/status   Health — check RabbitMQ connection
GET  /api/risk/health         Health — app status
```

