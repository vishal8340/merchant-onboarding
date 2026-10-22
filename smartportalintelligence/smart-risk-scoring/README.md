# Smart Risk Scoring - Merchant Onboarding PoC

## Overview
AI-driven risk scoring system for payment merchant onboarding using Random Forest classification with LIME explainability.

## Why Risk Scoring Matters in Payments
- **Fraud Prevention**: Identifies high-risk merchants before they process transactions
- **Compliance (KYC/AML)**: Automated risk assessment supports regulatory requirements
- **Chargeback Reduction**: Proactive risk identification reduces financial losses
- **Explainability**: LIME provides auditable reasons for decisions (required by regulations like GDPR Art. 22)

## Project Structure
```
src/main/java/com/riskscoring/
├── data/           - Synthetic data generation & CSV loading
├── model/          - Random Forest training & inference (Smile library)
├── explain/        - LIME-style explainability engine
├── api/            - Spring Boot REST controller
└── RiskScoringApplication.java - Spring Boot entry point
```

## Features & Payment Domain Relevance
| Feature | Type | Risk Relevance |
|---------|------|---------------|
| business_type | Categorical | Online/Travel merchants have higher fraud rates |
| transaction_volume | Numeric | High volumes may indicate money laundering |
| location | Categorical | Geographic compliance risk factors |
| chargeback_rate | Numeric | Direct fraud/dispute indicator |
| years_in_business | Numeric | New merchants are statistically riskier |
| average_transaction_size | Numeric | Unusually large transactions signal fraud |
| fraud_flag | Binary | Prior fraud is strongest risk predictor |
| compliance_score | Numeric | KYC/AML assessment score |

## Risk Label Rules
- `chargeback_rate > 0.1` OR `fraud_flag = 1` → **High**
- `compliance_score < 60` → **Medium**
- `transaction_volume > 100000` → **Medium**
- Otherwise → **Low**

## How to Run

### Prerequisites
- Java 17+
- Maven 3.8+

### Step 1: Generate Data & Train Model
```bash
mvn compile exec:java -Dexec.mainClass="com.riskscoring.model.RiskModelTrainer"
```
This generates `data/merchants.csv` (200 records) and saves the model to `data/risk_model.ser`.

### Step 2: Run Inference Demo
```bash
mvn exec:java -Dexec.mainClass="com.riskscoring.model.RiskModelInference"
```

### Step 3: Run Explainability Demo
```bash
mvn exec:java -Dexec.mainClass="com.riskscoring.explain.LimeExplainer"
```

### Step 4: Start REST API
```bash
mvn spring-boot:run
```

### Step 5: Test API
```bash
curl -X POST http://localhost:8080/api/risk/score ^
  -H "Content-Type: application/json" ^
  -d "{\"businessType\":\"Online\",\"transactionVolume\":150000,\"location\":\"Miami\",\"chargebackRate\":0.12,\"yearsInBusiness\":2,\"averageTransactionSize\":500,\"fraudFlag\":1,\"complianceScore\":45}"
```

### Run Tests
```bash
mvn test
```

## Sample Output

### Inference
```
Merchant 1 (Retail, low chargeback, high compliance): Low
Merchant 2 (Online, high chargeback, fraud flag): High
Merchant 3 (Travel, high volume, low compliance): Medium
```

### LIME Explanation
```
--- LIME Explanation for prediction: High ---
Top contributing features:
  1. fraud_flag (value=1.0000) → ↑ supports prediction (weight=0.3521)
  2. chargeback_rate (value=0.1500) → ↑ supports prediction (weight=0.2834)
  3. compliance_score (value=45.0000) → ↑ supports prediction (weight=0.1456)
  4. transaction_volume (value=180000.0000) → ↑ supports prediction (weight=0.0892)
  5. years_in_business (value=1.0000) → ↓ opposes prediction (weight=-0.0234)
```

### API Response
```json
{
  "riskLabel": "High",
  "probabilities": [0.05, 0.12, 0.83],
  "explanation": [
    {"feature": "fraud_flag", "weight": 0.3521, "value": 1.0},
    {"feature": "chargeback_rate", "weight": 0.2834, "value": 0.12},
    {"feature": "compliance_score", "weight": 0.1456, "value": 45.0}
  ]
}
```

## Dependencies
- **Smile 3.1.0** - Random Forest classifier
- **Weka 3.8.6** - Alternative ML library (available for future extensions)
- **OpenCSV 5.9** - CSV parsing
- **Spring Boot 3.2.5** - REST API framework
- **JUnit 4.13** - Unit testing

## Architecture Notes
- LIME implementation is custom (LIME4J has no stable Maven artifact) but follows the original LIME algorithm
- Model is serialized to disk for production deployment
- API is stateless; model is loaded once at startup
- Explainability runs per-request (~500 perturbation samples)

