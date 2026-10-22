package com.riskscoring.api;

import com.riskscoring.config.FraudRulesConfig;
import com.riskscoring.data.DataLoader;
import com.riskscoring.explain.LimeExplainer;
import com.riskscoring.llm.LlmReportService;
import com.riskscoring.model.RiskModelInference;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

/**
 * Payment Gateway Risk Scoring API.
 *
 * POST /api/risk/score   — Full sync pipeline: LLM fraud → ML → LIME → LLM reports
 * GET  /api/risk/health  — Health check
 * GET  /api/risk/rules   — Fraud detection thresholds
 */
@RestController
@RequestMapping("/api/risk")
public class RiskController {

    @Autowired private RiskModelInference inference;
    @Autowired private LimeExplainer explainer;
    @Autowired private LlmReportService llm;
    @Autowired private FraudRulesConfig fraudRules;

    /**
     * Full sync risk scoring pipeline:
     * 0. LLM fraud detection + country risk (with rule-based fallback)
     * 1. Weka RandomForest ML prediction (10 features)
     * 2. LIME explainability
     * 3. Decision + risk score
     * 4. Template summary
     * 5. LLM reports (8 reports in 1 call)
     */
    @PostMapping("/score")
    public RiskScoringResponse scoreRisk(@RequestBody MerchantRequest request) throws Exception {

        // 0. LLM-powered fraud detection + country risk (sync call)
        Map<String, Object> fraudAndCountry = llm.detectFraudAndCountryRisk(request);

        @SuppressWarnings("unchecked")
        Map<String, Object> fraudSignals = (Map<String, Object>) fraudAndCountry.get("fraud");
        String llmSource = (String) fraudSignals.getOrDefault("source", "");

        int calculatedFraudFlag;
        int fraudSeverity;
        List<String> fraudIndicators;

        // If LLM failed → fall back to rule-based fraud detection
        if (llmSource.contains("error") || llmSource.contains("unavailable")) {
            fraudIndicators = detectFraudIndicators(request);
            calculatedFraudFlag = fraudIndicators.isEmpty() ? 0 : 1;
            fraudSeverity = fraudIndicators.size() >= 3 ? 4 : fraudIndicators.size() >= 2 ? 3
                    : fraudIndicators.size() == 1 ? 2 : 0;
            fraudSignals = buildFraudSignals(request, fraudIndicators);
            fraudSignals.put("source", "rule-based-fallback");
        } else {
            calculatedFraudFlag = (int) fraudSignals.getOrDefault("fraudFlag", 0);
            String severityStr = (String) fraudSignals.getOrDefault("severity", "NONE");
            fraudSeverity = DataLoader.encodeFraudSeverity(severityStr);
            @SuppressWarnings("unchecked")
            List<String> llmIndicators = (List<String>) fraudSignals.getOrDefault("indicators", List.of());
            fraudIndicators = llmIndicators;
        }

        request.setFraudFlag(calculatedFraudFlag);
        request.setFraudSeverity(fraudSeverity);

        @SuppressWarnings("unchecked")
        Map<String, Object> countryRisk = (Map<String, Object>) fraudAndCountry.get("countryRisk");
        String countrySource = (String) countryRisk.getOrDefault("source", "");

        if (countrySource.contains("error") || countrySource.contains("unavailable")) {
            countryRisk = assessLocationRisk(request.getLocation());
            countryRisk.put("source", "rule-based-fallback");
        }

        double countryRiskScore = ((Number) countryRisk.getOrDefault("score", 50)).doubleValue();
        request.setCountryRiskScore(countryRiskScore);

        // 1. Encode & predict (10 features)
        double[] features = DataLoader.encodeMerchant(
                request.getBusinessType(), request.getTransactionVolume(), request.getLocation(),
                request.getChargebackRate(), request.getYearsInBusiness(),
                request.getAverageTransactionSize(), request.getFraudFlag(), request.getComplianceScore(),
                request.getFraudSeverity(), request.getCountryRiskScore());

        String riskLabel = inference.predictFromFeatures(features);
        double[] probabilities = inference.predictProbabilities(features);

        // 2. LIME explanation + 6. LLM reports run concurrently (both independent of each other)
        String datasetStatsForLlm = computeDatasetStats();
        final String finalRiskLabel = riskLabel;
        final double[] finalProbabilities = probabilities;
        final double[] finalFeatures = features;

        CompletableFuture<List<LimeExplainer.FeatureContribution>> limeFuture =
                CompletableFuture.supplyAsync(() -> {
                    try { return explainer.explain(finalFeatures); }
                    catch (Exception e) { return List.of(); }
                });

        CompletableFuture<Map<String, String>> reportsFuture =
                CompletableFuture.supplyAsync(() ->
                        llm.generateAllReports(request, finalRiskLabel, finalProbabilities, List.of(), datasetStatsForLlm)
                );

        List<LimeExplainer.FeatureContribution> contributions = limeFuture.join();
        Map<String, String> llmReports = reportsFuture.join();

        List<Map<String, Object>> explanation = contributions.stream().limit(5).map(fc -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("feature", fc.featureName);
            map.put("weight", Math.round(fc.weight * 10000.0) / 10000.0);
            map.put("rawValue", fc.featureValue);
            map.put("displayValue", decodeFeatureValue(fc.featureName, fc.featureValue, request));
            map.put("direction", fc.weight > 0 ? "INCREASES risk" : "DECREASES risk");
            map.put("impact", describeImpact(fc.weight));
            map.put("reason", getFeatureReason(fc.featureName, fc.featureValue, fc.weight, request));
            return map;
        }).collect(Collectors.toList());

        // 3. Decision
        String decision = switch (riskLabel) {
            case "High" -> "DECLINED";
            case "Medium" -> "CONDITIONAL";
            default -> "APPROVED";
        };

        // 4. Financial exposure & risk score
        double financialExposure = request.getTransactionVolume() * request.getChargebackRate();
        int riskScore = calculateRiskScore(probabilities, fraudIndicators, request);

        // 5. Template summary
        String summary = buildSummary(request, riskLabel, probabilities, contributions, decision);

        // (LLM reports already resolved above via CompletableFuture)

        // Build full result
        RiskResponse fullResult = RiskResponse.builder()
                .decision(decision)
                .riskLabel(riskLabel)
                .probabilities(probabilities)
                .financialExposure(financialExposure)
                .explanation(explanation)
                .summary(summary)
                .llmReport(llmReports.get("llmReport"))
                .complianceReport(llmReports.get("complianceReport"))
                .salesReport(llmReports.get("salesReport"))
                .merchantNotification(llmReports.get("merchantNotification"))
                .executiveBrief(llmReports.get("executiveBrief"))
                .anomalyDescription(llmReports.get("anomalyDescription"))
                .overrideSuggestion(llmReports.get("overrideSuggestion"))
                .consistencyScore(llmReports.get("consistencyScore"))
                .fraudFlag(calculatedFraudFlag)
                .fraudIndicators(fraudIndicators)
                .riskScore(riskScore)
                .countryRisk(countryRisk)
                .fraudSignals(fraudSignals)
                .build();

        // Build compact result
        int totalSignals = fraudSignals != null
                ? ((Number) fraudSignals.getOrDefault("totalSignals", 0)).intValue() : 0;
        String compactSummary = String.format("%s | %s risk (score %d/100) | exposure $%,.0f | fraud %s | %d signal(s)",
                decision, riskLabel, riskScore, financialExposure,
                calculatedFraudFlag == 1 ? "YES" : "NO", totalSignals);

        CompactResult compactResult = CompactResult.builder()
                .decision(decision)
                .riskLabel(riskLabel)
                .financialExposure(financialExposure)
                .riskScore(riskScore)
                .score((100 - riskScore) + "/100")
                .fraudFlag(calculatedFraudFlag)
                .totalSignals(totalSignals)
                .summary(compactSummary)
                .build();

        return RiskScoringResponse.builder()
                .compactResult(compactResult)
                .fullResult(fullResult)
                .build();
    }

    /**
     * Calculate a composite risk score (0-100).
     * 0 = lowest risk, 100 = highest risk.
     */
    private int calculateRiskScore(double[] probabilities, List<String> fraudIndicators, MerchantRequest req) {
        double modelScore = probabilities[2] * 50;
        double chargebackScore = Math.min(req.getChargebackRate() / 0.15, 1.0) * 15;
        double complianceScore = Math.max(0, (100 - req.getComplianceScore()) / 100.0) * 15;
        double fraudScore = Math.min(fraudIndicators.size(), 4) * 2.5;
        double volumeScore = Math.min(req.getTransactionVolume() / 200000.0, 1.0) * 5;
        double ageScore = Math.max(0, (5 - req.getYearsInBusiness()) / 5.0) * 5;
        int total = (int) Math.round(modelScore + chargebackScore + complianceScore + fraudScore + volumeScore + ageScore);
        return Math.max(0, Math.min(100, total));
    }

    /**
     * Assess location/country risk.
     */
    private Map<String, Object> assessLocationRisk(String location) {
        Map<String, Object> risk = new LinkedHashMap<>();
        risk.put("location", location);
        return switch (location) {
            case "Miami" -> {
                risk.put("riskLevel", "ELEVATED");
                risk.put("score", 70);
                risk.put("factors", List.of(
                        "High international transaction corridor (Latin America/Caribbean)",
                        "Elevated money laundering risk — FinCEN geographic targeting order area",
                        "Higher-than-average card-not-present fraud rates",
                        "Cross-border payment exposure increases chargeback risk"));
                risk.put("regulatoryNote", "Subject to FinCEN Geographic Targeting Orders. Enhanced BSA/AML monitoring required.");
                yield risk;
            }
            case "NewYork" -> {
                risk.put("riskLevel", "MODERATE");
                risk.put("score", 50);
                risk.put("factors", List.of(
                        "Major financial hub — high volumes normal",
                        "Strong regulatory oversight (NY DFS)",
                        "Moderate fraud rates proportional to volume"));
                risk.put("regulatoryNote", "NY DFS regulations apply. Standard BSA/AML compliance sufficient.");
                yield risk;
            }
            case "SanJose" -> {
                risk.put("riskLevel", "LOW");
                risk.put("score", 30);
                risk.put("factors", List.of(
                        "Silicon Valley tech hub — legitimate high-value businesses",
                        "Strong compliance culture",
                        "CCPA compliance area"));
                risk.put("regulatoryNote", "CCPA applies. Standard compliance sufficient.");
                yield risk;
            }
            case "Chicago" -> {
                risk.put("riskLevel", "MODERATE");
                risk.put("score", 45);
                risk.put("factors", List.of(
                        "Major commerce hub — diverse merchant mix",
                        "Moderate fraud profile",
                        "Illinois BIPA compliance area"));
                risk.put("regulatoryNote", "Illinois BIPA applies for biometric data. Standard BSA/AML compliance.");
                yield risk;
            }
            case "Dallas" -> {
                risk.put("riskLevel", "LOW");
                risk.put("score", 35);
                risk.put("factors", List.of(
                        "Growing business hub with lower fraud rates",
                        "Texas business-friendly regulatory environment",
                        "Moderate cross-border exposure (Mexico corridor)"));
                risk.put("regulatoryNote", "Texas Finance Code applies. Standard compliance sufficient.");
                yield risk;
            }
            default -> {
                risk.put("riskLevel", "UNKNOWN");
                risk.put("score", 50);
                risk.put("factors", List.of("Location not in risk database — manual review recommended"));
                risk.put("regulatoryNote", "Unknown jurisdiction. Conduct manual compliance assessment.");
                yield risk;
            }
        };
    }

    /**
     * Build detailed fraud signal detection report with individual checks.
     */
    private Map<String, Object> buildFraudSignals(MerchantRequest req, List<String> indicators) {
        Map<String, Object> signals = new LinkedHashMap<>();
        signals.put("fraudDetected", !indicators.isEmpty());
        signals.put("totalSignals", indicators.size());
        signals.put("severity", indicators.size() >= 3 ? "CRITICAL" : indicators.size() >= 2 ? "HIGH" : indicators.size() == 1 ? "MODERATE" : "NONE");
        signals.put("indicators", indicators);

        List<Map<String, Object>> checks = new ArrayList<>();
        checks.add(signalCheck("Chargeback Threshold",
                req.getChargebackRate() <= fraudRules.getChargebackThreshold(),
                String.format("%.2f%% (limit: %.1f%%)", req.getChargebackRate() * 100, fraudRules.getChargebackThreshold() * 100),
                "Visa VDMP threshold is 0.9%. Mastercard ECP is 1.5%."));
        checks.add(signalCheck("Bust-Out Pattern",
                !(req.getYearsInBusiness() <= fraudRules.getBustOutMaxYears() && req.getTransactionVolume() > fraudRules.getBustOutMinVolume()),
                String.format("%d yrs (limit: %d), $%,.0f vol (limit: $%,.0f)", req.getYearsInBusiness(), fraudRules.getBustOutMaxYears(), req.getTransactionVolume(), fraudRules.getBustOutMinVolume()),
                "New business + high volume = bust-out fraud indicator."));
        checks.add(signalCheck("Card-Not-Present Risk",
                !(req.getAverageTransactionSize() > fraudRules.getCnpMinAvgTransaction() && fraudRules.getCnpBusinessType().equalsIgnoreCase(req.getBusinessType())),
                String.format("%s, $%,.0f avg (limit: $%,.0f)", req.getBusinessType(), req.getAverageTransactionSize(), fraudRules.getCnpMinAvgTransaction()),
                "Online + high avg txn = elevated CNP fraud."));
        checks.add(signalCheck("AML Compliance",
                !(req.getComplianceScore() < fraudRules.getAmlMaxCompliance() && req.getTransactionVolume() > fraudRules.getAmlMinVolume()),
                String.format("Score: %.0f (limit: %.0f), Vol: $%,.0f (limit: $%,.0f)", req.getComplianceScore(), fraudRules.getAmlMaxCompliance(), req.getTransactionVolume(), fraudRules.getAmlMinVolume()),
                "Low compliance + high volume = AML red flag."));
        checks.add(signalCheck("Shell Company",
                !(req.getYearsInBusiness() <= fraudRules.getShellMaxYears() && req.getComplianceScore() < fraudRules.getShellMaxCompliance()),
                String.format("%d yr (limit: %d), compliance: %.0f (limit: %.0f)", req.getYearsInBusiness(), fraudRules.getShellMaxYears(), req.getComplianceScore(), fraudRules.getShellMaxCompliance()),
                "New + poor compliance = shell company risk."));
        checks.add(signalCheck("Industry Risk",
                !(fraudRules.isHighRiskIndustry(req.getBusinessType()) && req.getChargebackRate() > fraudRules.getIndustryChargebackThreshold()),
                String.format("%s, %.2f%% CB (limit: %.1f%%)", req.getBusinessType(), req.getChargebackRate() * 100, fraudRules.getIndustryChargebackThreshold() * 100),
                String.format("High-risk types (%s) with >%.1f%% CB exceeds tolerance.", fraudRules.getIndustryHighRiskTypes(), fraudRules.getIndustryChargebackThreshold() * 100)));

        signals.put("checks", checks);
        signals.put("passed", checks.stream().filter(c -> "PASS".equals(c.get("status"))).count());
        signals.put("failed", checks.stream().filter(c -> "FAIL".equals(c.get("status"))).count());
        return signals;
    }

    private Map<String, Object> signalCheck(String name, boolean passed, String value, String note) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("check", name);
        c.put("status", passed ? "PASS" : "FAIL");
        c.put("value", value);
        c.put("note", note);
        return c;
    }

    /**
     * Auto-detect fraud indicators from merchant data.
     * All thresholds loaded from application.properties (fraud.rules.*).
     * Returns list of triggered reasons. If non-empty → fraudFlag = 1.
     */
    private List<String> detectFraudIndicators(MerchantRequest req) {
        List<String> indicators = new ArrayList<>();

        // 1. Chargeback rate exceeds threshold
        if (req.getChargebackRate() > fraudRules.getChargebackThreshold()) {
            indicators.add(String.format("HIGH_CHARGEBACK: %.1f%% chargeback rate exceeds %.1f%% threshold (Visa VDMP limit is 0.9%%)",
                    req.getChargebackRate() * 100, fraudRules.getChargebackThreshold() * 100));
        }

        // 2. Bust-out pattern (new business + high volume)
        if (req.getYearsInBusiness() <= fraudRules.getBustOutMaxYears() && req.getTransactionVolume() > fraudRules.getBustOutMinVolume()) {
            indicators.add(String.format("BUST_OUT_PATTERN: New business (%d years, limit: %d) with high volume ($%,.0f, limit: $%,.0f)",
                    req.getYearsInBusiness(), fraudRules.getBustOutMaxYears(), req.getTransactionVolume(), fraudRules.getBustOutMinVolume()));
        }

        // 3. Card-not-present fraud (business type + high avg txn)
        if (req.getAverageTransactionSize() > fraudRules.getCnpMinAvgTransaction()
                && fraudRules.getCnpBusinessType().equalsIgnoreCase(req.getBusinessType())) {
            indicators.add(String.format("CNP_FRAUD_RISK: %s merchant with avg txn $%,.0f (limit: $%,.0f) — card-not-present fraud pattern",
                    req.getBusinessType(), req.getAverageTransactionSize(), fraudRules.getCnpMinAvgTransaction()));
        }

        // 4. AML red flag (low compliance + high volume)
        if (req.getComplianceScore() < fraudRules.getAmlMaxCompliance() && req.getTransactionVolume() > fraudRules.getAmlMinVolume()) {
            indicators.add(String.format("AML_RED_FLAG: Compliance %.0f (limit: %.0f) with volume $%,.0f (limit: $%,.0f) — potential money laundering",
                    req.getComplianceScore(), fraudRules.getAmlMaxCompliance(), req.getTransactionVolume(), fraudRules.getAmlMinVolume()));
        }

        // 5. Shell company (very new + poor compliance)
        if (req.getYearsInBusiness() <= fraudRules.getShellMaxYears() && req.getComplianceScore() < fraudRules.getShellMaxCompliance()) {
            indicators.add(String.format("SHELL_COMPANY_RISK: %d year (limit: %d) with compliance %.0f (limit: %.0f)",
                    req.getYearsInBusiness(), fraudRules.getShellMaxYears(), req.getComplianceScore(), fraudRules.getShellMaxCompliance()));
        }

        // 6. High-risk industry + chargeback
        if (fraudRules.isHighRiskIndustry(req.getBusinessType())
                && req.getChargebackRate() > fraudRules.getIndustryChargebackThreshold()) {
            indicators.add(String.format("HIGH_RISK_INDUSTRY: %s with %.1f%% chargeback (limit: %.1f%%)",
                    req.getBusinessType(), req.getChargebackRate() * 100, fraudRules.getIndustryChargebackThreshold() * 100));
        }

        return indicators;
    }

    private String decodeFeatureValue(String feature, double encoded, MerchantRequest req) {
        return switch (feature) {
            case "business_type" -> req.getBusinessType();
            case "location" -> req.getLocation();
            case "transaction_volume" -> String.format("$%,.0f/month", req.getTransactionVolume());
            case "chargeback_rate" -> String.format("%.2f%%", req.getChargebackRate() * 100);
            case "years_in_business" -> req.getYearsInBusiness() + " years";
            case "average_transaction_size" -> String.format("$%,.0f", req.getAverageTransactionSize());
            case "fraud_flag" -> req.getFraudFlag() == 1 ? "Yes — prior fraud incidents" : "No fraud history";
            case "compliance_score" -> String.format("%.0f/100", req.getComplianceScore());
            case "fraud_severity" -> switch (req.getFraudSeverity()) {
                case 0 -> "NONE";
                case 1 -> "LOW";
                case 2 -> "MODERATE";
                case 3 -> "HIGH";
                case 4 -> "CRITICAL";
                default -> "UNKNOWN";
            } + " (LLM-assessed)";
            case "country_risk_score" -> String.format("%.0f/100 (LLM-assessed)", req.getCountryRiskScore());
            default -> String.valueOf(encoded);
        };
    }

    private String describeImpact(double weight) {
        double abs = Math.abs(weight);
        if (abs > 0.3) return "CRITICAL";
        if (abs > 0.1) return "HIGH";
        if (abs > 0.03) return "MODERATE";
        return "LOW";
    }

    private String getFeatureReason(String feature, double value, double weight, MerchantRequest req) {
        String direction = weight > 0 ? "increases" : "decreases";
        return switch (feature) {
            case "fraud_flag" -> req.getFraudFlag() == 1
                    ? "Prior fraud history is the strongest predictor of future risk. This merchant has documented fraud incidents."
                    : "No prior fraud history — this " + direction + " overall risk.";
            case "chargeback_rate" -> {
                double rate = req.getChargebackRate() * 100;
                String threshold = rate > 1.0 ? "exceeds Visa's 0.9% VDMP threshold" : "is within acceptable range";
                yield String.format("Chargeback rate of %.2f%% %s. Industry average is ~0.6%%.", rate, threshold);
            }
            case "transaction_volume" -> {
                double vol = req.getTransactionVolume();
                yield vol > 100000
                        ? String.format("Monthly volume of $%,.0f is high — may trigger AML monitoring thresholds ($10K+ per transaction).", vol)
                        : String.format("Monthly volume of $%,.0f is within normal range for %s businesses.", vol, req.getBusinessType());
            }
            case "compliance_score" -> {
                double score = req.getComplianceScore();
                yield score < 60
                        ? String.format("Compliance score of %.0f/100 is below the 60-point minimum — indicates KYC/AML verification gaps.", score)
                        : String.format("Compliance score of %.0f/100 meets minimum standards.", score);
            }
            case "years_in_business" -> {
                int years = req.getYearsInBusiness();
                yield years < 3
                        ? years + " years in business — new merchants have 3x higher default rates than established ones."
                        : years + " years in business — established track record " + direction + " risk.";
            }
            case "average_transaction_size" -> {
                double avg = req.getAverageTransactionSize();
                yield avg > 500
                        ? String.format("Average transaction of $%,.0f is high — could indicate high-value fraud or card testing.", avg)
                        : String.format("Average transaction of $%,.0f is within normal range.", avg);
            }
            case "business_type" -> {
                String type = req.getBusinessType();
                yield switch (type) {
                    case "Online" -> "Online businesses carry 2-3x higher fraud rates than brick-and-mortar due to card-not-present transactions.";
                    case "Travel" -> "Travel industry has elevated risk due to high-value bookings, advance payments, and chargeback disputes.";
                    case "Subscription" -> "Subscription models carry recurring billing risk — involuntary churn can inflate chargeback rates.";
                    default -> type + " business type has a moderate risk profile.";
                };
            }
            case "location" -> {
                String loc = req.getLocation();
                yield loc + " — geographic risk varies by local fraud rates and regulatory environment.";
            }
            case "fraud_severity" -> {
                int sev = req.getFraudSeverity();
                yield sev >= 3
                        ? "LLM assessed fraud severity as " + (sev == 4 ? "CRITICAL" : "HIGH") + " — multiple fraud indicators detected across industry benchmarks."
                        : "LLM assessed fraud severity as " + (sev == 0 ? "NONE" : sev == 1 ? "LOW" : "MODERATE") + " — " + direction + " overall risk.";
            }
            case "country_risk_score" -> {
                double crs = req.getCountryRiskScore();
                yield crs > 70
                        ? String.format("LLM geographic risk score of %.0f/100 is elevated — region has higher fraud corridor risk and regulatory complexity.", crs)
                        : String.format("LLM geographic risk score of %.0f/100 is within normal range for the merchant's location.", crs);
            }
            default -> feature + " " + direction + " risk with weight " + String.format("%.4f", weight);
        };
    }

    private String buildSummary(MerchantRequest req, String riskLabel, double[] probs,
                                List<LimeExplainer.FeatureContribution> contributions, String decision) {
        StringBuilder sb = new StringBuilder();
        double confidence = Math.max(probs[0], Math.max(probs[1], probs[2])) * 100;
        sb.append(String.format("=== PAYMENT GATEWAY RISK ASSESSMENT ===\n\n"));
        sb.append(String.format("DECISION: %s | RISK: %s (%.1f%% confidence)\n", decision, riskLabel.toUpperCase(), confidence));
        sb.append(String.format("FINANCIAL EXPOSURE: $%,.2f/month\n\n", req.getTransactionVolume() * req.getChargebackRate()));
        sb.append("MERCHANT PROFILE:\n");
        sb.append(String.format("  Business: %s | Location: %s | Years: %d\n", req.getBusinessType(), req.getLocation(), req.getYearsInBusiness()));
        sb.append(String.format("  Volume: $%,.0f/mo | Avg Txn: $%,.0f | Chargeback: %.2f%%\n",
                req.getTransactionVolume(), req.getAverageTransactionSize(), req.getChargebackRate() * 100));
        sb.append(String.format("  Fraud History: %s | Compliance: %.0f/100\n", req.getFraudFlag() == 1 ? "YES" : "No", req.getComplianceScore()));
        sb.append(String.format("  Fraud Severity: %s | Country Risk: %.0f/100 (LLM-derived)\n\n",
                switch (req.getFraudSeverity()) { case 0 -> "NONE"; case 1 -> "LOW"; case 2 -> "MODERATE"; case 3 -> "HIGH"; case 4 -> "CRITICAL"; default -> "UNKNOWN"; },
                req.getCountryRiskScore()));
        sb.append("TOP RISK FACTORS:\n");
        Map<String, String> desc = Map.ofEntries(
                Map.entry("fraud_flag", "Prior fraud — strongest risk predictor"),
                Map.entry("chargeback_rate", "High chargebacks — disputes/unauthorized txns"),
                Map.entry("compliance_score", "Low compliance — KYC/AML gaps"),
                Map.entry("transaction_volume", "High volume — potential money laundering"),
                Map.entry("average_transaction_size", "Large avg txn — high-value fraud risk"),
                Map.entry("years_in_business", "New business — limited track record"),
                Map.entry("business_type", "Industry risk exposure"),
                Map.entry("location", "Geographic risk profile"),
                Map.entry("fraud_severity", "LLM fraud severity — multi-signal assessment"),
                Map.entry("country_risk_score", "LLM geographic risk — regulatory & corridor risk"));
        int rank = 1;
        for (LimeExplainer.FeatureContribution fc : contributions.subList(0, Math.min(5, contributions.size()))) {
            sb.append(String.format("  %d. %s → %s (%s)\n", rank++, fc.featureName,
                    fc.weight > 0 ? "INCREASES" : "DECREASES", desc.getOrDefault(fc.featureName, "")));
        }
        return sb.toString();
    }

    private String computeDatasetStats() {
        try {
            DataLoader.DataSet ds = DataLoader.load("data/merchants.csv");
            double[][] f = ds.features;
            int n = f.length;
            StringBuilder sb = new StringBuilder();
            sb.append("Total merchants: ").append(n).append("\n");
            for (int j = 0; j < DataLoader.FEATURE_NAMES.length; j++) {
                double sum = 0, min = Double.MAX_VALUE, max = Double.MIN_VALUE;
                for (double[] row : f) { sum += row[j]; min = Math.min(min, row[j]); max = Math.max(max, row[j]); }
                sb.append(String.format("  %s: avg=%.2f, min=%.2f, max=%.2f\n", DataLoader.FEATURE_NAMES[j], sum / n, min, max));
            }
            return sb.toString();
        } catch (Exception e) { return "Stats unavailable"; }
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "UP", "model", "RandomForest-Weka", "version", "2.0.0");
    }

    /**
     * GET /api/risk/rules — view current fraud detection thresholds.
     */
    @GetMapping("/rules")
    public Map<String, Object> getRules() {
        Map<String, Object> rules = new LinkedHashMap<>();
        rules.put("chargebackThreshold", fraudRules.getChargebackThreshold());
        rules.put("bustOut", Map.of("maxYears", fraudRules.getBustOutMaxYears(), "minVolume", fraudRules.getBustOutMinVolume()));
        rules.put("cnpFraud", Map.of("minAvgTransaction", fraudRules.getCnpMinAvgTransaction(), "businessType", fraudRules.getCnpBusinessType()));
        rules.put("amlRedFlag", Map.of("maxCompliance", fraudRules.getAmlMaxCompliance(), "minVolume", fraudRules.getAmlMinVolume()));
        rules.put("shellCompany", Map.of("maxYears", fraudRules.getShellMaxYears(), "maxCompliance", fraudRules.getShellMaxCompliance()));
        rules.put("industryRisk", Map.of("chargebackThreshold", fraudRules.getIndustryChargebackThreshold(), "highRiskTypes", fraudRules.getIndustryHighRiskTypes()));
        rules.put("source", "application.properties (fraud.rules.*)");
        return rules;
    }
}

