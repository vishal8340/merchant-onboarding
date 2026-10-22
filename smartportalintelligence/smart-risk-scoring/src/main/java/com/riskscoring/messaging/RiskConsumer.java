package com.riskscoring.messaging;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.riskscoring.api.CompactResult;
import com.riskscoring.api.MerchantRequest;
import com.riskscoring.api.RiskResponse;
import com.riskscoring.api.RiskScoringResponse;
import com.riskscoring.data.DataLoader;
import com.riskscoring.explain.LimeExplainer;
import com.riskscoring.llm.LlmReportService;
import com.riskscoring.model.RiskModelInference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * RabbitMQ consumer — listens on merchant.risk.request queue,
 * runs the full risk scoring pipeline, and publishes results
 * to merchant.risk.response queue.
 *
 * Flow:
 *   merchant.risk.request → [ML + LIME + LLM pipeline] → merchant.risk.response
 */
@Service
public class RiskConsumer {

    private static final Logger log = LoggerFactory.getLogger(RiskConsumer.class);

    @Autowired private RiskModelInference inference;
    @Autowired private LimeExplainer explainer;
    @Autowired private LlmReportService llm;
    @Autowired private RabbitTemplate rabbitTemplate;

    @Value("${rabbitmq.exchange}")
    private String exchange;

    @Value("${rabbitmq.routing.response}")
    private String responseRoutingKey;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @RabbitListener(queues = "${rabbitmq.queue.request}")
    public void consumeRiskRequest(Map<String, Object> message) {
        String correlationId = (String) message.getOrDefault("correlationId", "unknown");
        log.info("=== Received risk request [{}] ===", correlationId);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("correlationId", correlationId);
        result.put("processedAt", System.currentTimeMillis());

        try {
            // Extract merchant data from message
            MerchantRequest request = objectMapper.convertValue(message.get("merchant"), MerchantRequest.class);

            // Run the full pipeline (same logic as RiskController)
            RiskScoringResponse scoringResponse = processRiskScoring(request);

            result.put("status", "COMPLETED");
            result.put("result", objectMapper.convertValue(scoringResponse, Map.class));

            log.info("Risk scoring complete [{}]: {} → {}", correlationId,
                    scoringResponse.getCompactResult().getRiskLabel(),
                    scoringResponse.getCompactResult().getDecision());

        } catch (Exception e) {
            log.error("Risk scoring failed [{}]: {}", correlationId, e.getMessage(), e);
            result.put("status", "FAILED");
            result.put("error", e.getMessage());
        }

        // Publish result to response queue
        rabbitTemplate.convertAndSend(exchange, responseRoutingKey, result, msg -> {
            msg.getMessageProperties().setCorrelationId(correlationId);
            msg.getMessageProperties().setContentType("application/json");
            return msg;
        });

        log.info("Result published to response queue [{}]", correlationId);
    }

    /**
     * Full risk scoring pipeline — mirrors RiskController.scoreRisk() logic.
     */
    private RiskScoringResponse processRiskScoring(MerchantRequest request) throws Exception {
        // 0. LLM fraud detection + country risk (sync, with rule-based fallback)
        Map<String, Object> fraudAndCountry = llm.detectFraudAndCountryRisk(request);

        @SuppressWarnings("unchecked")
        Map<String, Object> fraudSignals = (Map<String, Object>) fraudAndCountry.get("fraud");
        String llmSource = (String) fraudSignals.getOrDefault("source", "");

        int calculatedFraudFlag;
        int fraudSeverity;
        List<String> fraudIndicators;

        if (llmSource.contains("error") || llmSource.contains("unavailable")) {
            fraudIndicators = detectFraudIndicators(request);
            calculatedFraudFlag = fraudIndicators.isEmpty() ? 0 : 1;
            fraudSeverity = fraudIndicators.size() >= 3 ? 4 : fraudIndicators.size() >= 2 ? 3
                    : fraudIndicators.size() == 1 ? 2 : 0;
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

        // 2. LIME explanation
        List<LimeExplainer.FeatureContribution> contributions = explainer.explain(features);
        List<Map<String, Object>> explanation = contributions.stream().limit(5).map(fc -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("feature", fc.featureName);
            map.put("weight", Math.round(fc.weight * 10000.0) / 10000.0);
            map.put("direction", fc.weight > 0 ? "INCREASES risk" : "DECREASES risk");
            return map;
        }).collect(Collectors.toList());

        // 3. Decision
        String decision = switch (riskLabel) {
            case "High" -> "DECLINED";
            case "Medium" -> "CONDITIONAL";
            default -> "APPROVED";
        };

        // 4. Risk score & financial exposure
        double financialExposure = request.getTransactionVolume() * request.getChargebackRate();
        int riskScore = calculateRiskScore(probabilities, fraudIndicators, request);

        // 5. LLM reports (sync)
        Map<String, String> llmReports = llm.generateAllReports(
                request, riskLabel, probabilities, contributions, computeDatasetStats());

        // Build full result
        RiskResponse fullResult = RiskResponse.builder()
                .decision(decision)
                .riskLabel(riskLabel)
                .probabilities(probabilities)
                .financialExposure(financialExposure)
                .riskScore(riskScore)
                .explanation(explanation)
                .fraudFlag(calculatedFraudFlag)
                .fraudIndicators(fraudIndicators)
                .fraudSignals(fraudSignals)
                .countryRisk(countryRisk)
                .llmReport(llmReports.get("llmReport"))
                .complianceReport(llmReports.get("complianceReport"))
                .salesReport(llmReports.get("salesReport"))
                .merchantNotification(llmReports.get("merchantNotification"))
                .executiveBrief(llmReports.get("executiveBrief"))
                .anomalyDescription(llmReports.get("anomalyDescription"))
                .overrideSuggestion(llmReports.get("overrideSuggestion"))
                .consistencyScore(llmReports.get("consistencyScore"))
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

    private List<String> detectFraudIndicators(MerchantRequest req) {
        List<String> indicators = new ArrayList<>();
        if (req.getChargebackRate() > 0.05)
            indicators.add("HIGH_CHARGEBACK: " + String.format("%.1f%%", req.getChargebackRate() * 100));
        if (req.getYearsInBusiness() <= 2 && req.getTransactionVolume() > 100000)
            indicators.add("BUST_OUT_PATTERN: New business + high volume");
        if (req.getAverageTransactionSize() > 500 && "Online".equals(req.getBusinessType()))
            indicators.add("CNP_FRAUD_RISK: Online + high avg transaction");
        if (req.getComplianceScore() < 40 && req.getTransactionVolume() > 80000)
            indicators.add("AML_RED_FLAG: Low compliance + high volume");
        if (req.getYearsInBusiness() <= 1 && req.getComplianceScore() < 50)
            indicators.add("SHELL_COMPANY_RISK: Brand new + poor compliance");
        if (("Travel".equals(req.getBusinessType()) || "Subscription".equals(req.getBusinessType()))
                && req.getChargebackRate() > 0.03)
            indicators.add("HIGH_RISK_INDUSTRY: " + req.getBusinessType() + " + high chargeback");
        return indicators;
    }

    private int calculateRiskScore(double[] probabilities, List<String> fraudIndicators, MerchantRequest req) {
        double score = probabilities[2] * 50
                + Math.min(req.getChargebackRate() / 0.15, 1.0) * 15
                + Math.max(0, (100 - req.getComplianceScore()) / 100.0) * 15
                + Math.min(fraudIndicators.size(), 4) * 2.5
                + Math.min(req.getTransactionVolume() / 200000.0, 1.0) * 5
                + Math.max(0, (5 - req.getYearsInBusiness()) / 5.0) * 5;
        return Math.max(0, Math.min(100, (int) Math.round(score)));
    }

    private String computeDatasetStats() {
        try {
            DataLoader.DataSet ds = DataLoader.load("data/merchants.csv");
            double[][] f = ds.features;
            int n = f.length;
            StringBuilder sb = new StringBuilder("Total merchants: ").append(n).append("\n");
            for (int j = 0; j < DataLoader.FEATURE_NAMES.length; j++) {
                double sum = 0;
                for (double[] row : f) sum += row[j];
                sb.append(String.format("  %s: avg=%.2f\n", DataLoader.FEATURE_NAMES[j], sum / n));
            }
            return sb.toString();
        } catch (Exception e) { return "Stats unavailable"; }
    }
}

