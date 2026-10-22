package com.riskscoring.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.riskscoring.api.MerchantRequest;
import com.riskscoring.explain.LimeExplainer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;

/**
 * LLM service — generates all risk reports in a single API call.
 * Produces: analyst report, compliance report, sales report, merchant notification,
 * executive brief, anomaly description, and optional localized report.
 */
@Service
public class LlmReportService {

    @Value("${openai.api.key:#{null}}")
    private String apiKey;

    @Value("${openai.model:gpt-4o}")
    private String model;

    @Value("${openai.api.url:https://api.openai.com/v1/chat/completions}")
    private String apiUrl;

    @Value("${openai.auth.type:bearer}")
    private String authType;

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public LlmReportService() {
        // 25s connect + 25s read — each LLM call gets its own budget, total ≤50s
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(25_000);
        factory.setReadTimeout(25_000);
        this.restTemplate = new RestTemplate(factory);
    }

    public boolean isAvailable() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * Generates ALL reports in a single LLM call. Returns a map:
     * llmReport, complianceReport, salesReport, merchantNotification,
     * executiveBrief, anomalyDescription, localizedReport
     */
    public Map<String, String> generateAllReports(MerchantRequest request, String riskLabel,
                                                    double[] probabilities,
                                                    List<LimeExplainer.FeatureContribution> contributions,
                                                    String datasetStats) {
        if (!isAvailable()) {
            String msg = "[LLM not configured] Set openai.api.key in application.properties";
            return Map.of("llmReport", msg, "complianceReport", msg, "salesReport", msg,
                    "merchantNotification", "Your application is being reviewed. Please contact support for updates.",
                    "executiveBrief", msg, "anomalyDescription", msg,
                    "overrideSuggestion", "", "consistencyScore", "");
        }

        String context = buildMerchantContext(request, riskLabel, probabilities, contributions);

        String prompt = context
                + "\n\nDATASET STATISTICS (for anomaly comparison):\n" + datasetStats
                + "\n\nGenerate ALL of the following sections separated by the exact delimiters shown. "
                + "Output ONLY the sections with delimiters, nothing else.\n\n"
                + "===ANALYST_REPORT===\nFull risk assessment (200-300 words): executive summary, risk factor analysis, "
                + "regulatory considerations (BSA/AML, PCI-DSS, GDPR), recommendation.\n\n"
                + "===COMPLIANCE_REPORT===\nFor compliance officer (no word limit — be thorough): regulatory violations, EDD requirements, "
                + "SAR filing obligations (31 CFR 1020.320), Visa VDMP/Mastercard ECP thresholds. Formal regulatory language with section references.\n\n"
                + "===SALES_REPORT===\nFor sales rep (STRICTLY under 150 words): simple language, what merchant needs to do, timeline, "
                + "positive framing. No model details or LIME weights.\n\n"
                + "===MERCHANT_NOTIFICATION===\nFor the merchant (STRICTLY under 100 words): friendly, simple, clear status and next steps. "
                + "No risk scores or fraud flags. Include support contact.\n\n"
                + "===EXECUTIVE_BRIEF===\nFor C-suite dashboard (STRICTLY under 50 words): one-line verdict, dollar exposure, "
                + "3-4 bullet points max. Numbers only, no fluff.\n\n"
                + "===ANOMALY_DESCRIPTION===\nFraud analyst view (100-150 words): what makes this merchant unusual — statistical outliers, "
                + "unusual feature combinations, known fraud patterns, investigation steps.\n\n"
                + "===OVERRIDE_SUGGESTION===\nShould a human reviewer override the automated decision? "
                + "Answer with: OVERRIDE_RECOMMENDED or NO_OVERRIDE, followed by a brief reason (under 80 words). "
                + "Consider edge cases the model might miss: bust-out fraud, structuring, industry-specific risks.\n\n"
                + "===CONSISTENCY_SCORE===\nOutput ONLY a JSON object on a single line with no other text:\n"
                + "{\"score\": <1-10>, \"llmVerdict\": \"<Low/Medium/High>\", \"mlVerdict\": \"" + riskLabel + "\", \"agrees\": <true/false>, \"reason\": \"<one sentence>\"}\n"
                + "Rules: Score 10 = LLM fully agrees with ML. Score 1 = complete disagreement. "
                + "Set llmVerdict to what YOU think the risk should be based on the data. "
                + "Set agrees=true if llmVerdict matches mlVerdict, false otherwise.\n";

        String combined = callLlm(prompt, 4000);

        // If LLM failed, return clean placeholders (not raw error messages)
        if (combined.startsWith("[LLM Error]")) {
            System.out.println("LLM reports unavailable: " + combined);
            return Map.of(
                    "llmReport", "[LLM unavailable] Risk assessment based on ML model and rule-based analysis. See summary and explanation fields for details.",
                    "complianceReport", "[LLM unavailable] Compliance review pending — refer to fraudSignals and countryRisk sections for automated checks.",
                    "salesReport", "[LLM unavailable] Please refer to the summary field for merchant risk status.",
                    "merchantNotification", "[LLM unavailable] Your application is being reviewed. Please contact support for updates.",
                    "executiveBrief", "[LLM unavailable] See riskLabel, riskScore, and financialExposure fields.",
                    "anomalyDescription", "[LLM unavailable] See explanation field for LIME-based anomaly analysis.",
                    "overrideSuggestion", "",
                    "consistencyScore", "");
        }

        Map<String, String> result = new LinkedHashMap<>();
        result.put("llmReport", extractSection(combined, "===ANALYST_REPORT===", "===COMPLIANCE_REPORT==="));
        result.put("complianceReport", extractSection(combined, "===COMPLIANCE_REPORT===", "===SALES_REPORT==="));
        result.put("salesReport", extractSection(combined, "===SALES_REPORT===", "===MERCHANT_NOTIFICATION==="));
        result.put("merchantNotification", extractSection(combined, "===MERCHANT_NOTIFICATION===", "===EXECUTIVE_BRIEF==="));
        result.put("executiveBrief", extractSection(combined, "===EXECUTIVE_BRIEF===", "===ANOMALY_DESCRIPTION==="));
        result.put("anomalyDescription", extractSection(combined, "===ANOMALY_DESCRIPTION===", "===OVERRIDE_SUGGESTION==="));
        result.put("overrideSuggestion", extractSection(combined, "===OVERRIDE_SUGGESTION===", "===CONSISTENCY_SCORE==="));
        result.put("consistencyScore", extractSection(combined, "===CONSISTENCY_SCORE===", null));
        return result;
    }

    private String extractSection(String text, String startDelimiter, String endDelimiter) {
        int start = text.indexOf(startDelimiter);
        if (start == -1) return "";
        start += startDelimiter.length();
        int end = (endDelimiter != null) ? text.indexOf(endDelimiter, start) : -1;
        if (end == -1) end = text.length();
        return text.substring(start, end).trim();
    }

    private String buildMerchantContext(MerchantRequest req, String riskLabel,
                                        double[] probs,
                                        List<LimeExplainer.FeatureContribution> contributions) {
        StringBuilder sb = new StringBuilder();
        sb.append("MERCHANT DATA:\n");
        sb.append(String.format("- Business Type: %s\n", req.getBusinessType()));
        sb.append(String.format("- Location: %s\n", req.getLocation()));
        sb.append(String.format("- Monthly Transaction Volume: $%,.2f\n", req.getTransactionVolume()));
        sb.append(String.format("- Average Transaction Size: $%,.2f\n", req.getAverageTransactionSize()));
        sb.append(String.format("- Chargeback Rate: %.2f%%\n", req.getChargebackRate() * 100));
        sb.append(String.format("- Years in Business: %d\n", req.getYearsInBusiness()));
        sb.append(String.format("- Prior Fraud Incidents: %s\n", req.getFraudFlag() == 1 ? "Yes" : "No"));
        sb.append(String.format("- Fraud Severity (LLM-assessed): %s\n",
                switch (req.getFraudSeverity()) { case 0 -> "NONE"; case 1 -> "LOW"; case 2 -> "MODERATE"; case 3 -> "HIGH"; case 4 -> "CRITICAL"; default -> "UNKNOWN"; }));
        sb.append(String.format("- Compliance Score: %.0f/100\n", req.getComplianceScore()));
        sb.append(String.format("- Country Risk Score (LLM-assessed): %.0f/100\n\n", req.getCountryRiskScore()));
        sb.append(String.format("MODEL PREDICTION: %s risk\n", riskLabel));
        sb.append(String.format("CONFIDENCE: Low=%.1f%%, Medium=%.1f%%, High=%.1f%%\n\n",
                probs[0] * 100, probs[1] * 100, probs[2] * 100));
        sb.append("LIME FEATURE CONTRIBUTIONS (ranked by impact):\n");
        int rank = 1;
        for (LimeExplainer.FeatureContribution fc : contributions.subList(0, Math.min(5, contributions.size()))) {
            String direction = fc.weight > 0 ? "INCREASES" : "DECREASES";
            sb.append(String.format("%d. %s = %.4f -> %s risk (weight: %.4f)\n",
                    rank++, fc.featureName, fc.featureValue, direction, fc.weight));
        }
        return sb.toString();
    }

    /**
     * LLM-powered fraud detection + country risk in a SINGLE call.
     * Returns a Map with two top-level keys: "fraud" and "countryRisk".
     */
    public Map<String, Object> detectFraudAndCountryRisk(MerchantRequest req) {
        Map<String, Object> combined = new LinkedHashMap<>();

        if (!isAvailable()) {
            Map<String, Object> fraud = new LinkedHashMap<>();
            fraud.put("fraudDetected", false);
            fraud.put("fraudFlag", 0);
            fraud.put("severity", "UNKNOWN");
            fraud.put("indicators", List.of("[LLM not configured]"));
            fraud.put("checks", List.of());
            fraud.put("passed", 0);
            fraud.put("failed", 0);
            fraud.put("totalSignals", 0);
            fraud.put("source", "llm-unavailable");
            combined.put("fraud", fraud);

            Map<String, Object> country = new LinkedHashMap<>();
            country.put("location", req.getLocation());
            country.put("riskLevel", "UNKNOWN");
            country.put("score", 50);
            country.put("factors", List.of("[LLM not configured]"));
            country.put("regulatoryNote", "Manual assessment required.");
            country.put("recommendations", List.of());
            country.put("source", "llm-unavailable");
            combined.put("countryRisk", country);
            return combined;
        }

        String prompt = String.format("""
                Analyze this merchant for FRAUD RISK and GEOGRAPHIC RISK. Return ONLY a JSON object with two keys: "fraud" and "countryRisk".
                
                MERCHANT:
                - Business Type: %s
                - Location: %s
                - Monthly Transaction Volume: $%,.2f
                - Average Transaction Size: $%,.2f
                - Chargeback Rate: %.4f (%.2f%%)
                - Years in Business: %d
                - Compliance Score: %.0f/100
                
                INDUSTRY BENCHMARKS:
                - Visa VDMP chargeback threshold: 0.9%%
                - Mastercard ECP threshold: 1.5%%
                - FinCEN CTR reporting: $10,000+ per transaction
                - Average merchant chargeback rate: 0.6%%
                - Bust-out fraud pattern: <2 years + >$100K volume
                - Shell company pattern: <1 year + compliance <50
                
                Return this EXACT JSON structure:
                {
                  "fraud": {
                    "fraudDetected": true/false,
                    "fraudFlag": 0 or 1,
                    "severity": "NONE"/"LOW"/"MODERATE"/"HIGH"/"CRITICAL",
                    "indicators": ["SHORT_CODE: description", ...],
                    "checks": [
                      {"check": "Check Name", "status": "PASS"/"FAIL", "value": "actual value", "note": "why it matters"}
                    ]
                  },
                  "countryRisk": {
                    "riskLevel": "LOW"/"MODERATE"/"ELEVATED"/"HIGH"/"CRITICAL",
                    "score": 0-100,
                    "factors": ["factor 1", ...],
                    "regulatoryNote": "Key regulations",
                    "recommendations": ["recommendation 1", ...]
                  }
                }
                
                FRAUD CHECKS (run all, add any extras you detect):
                1. Chargeback Threshold — rate vs Visa/Mastercard limits
                2. Bust-Out Pattern — new business + high volume
                3. Card-Not-Present Risk — online + high avg transaction
                4. AML/Money Laundering — low compliance + high volume
                5. Shell Company — very new + poor compliance
                6. Industry Risk — high-risk vertical + chargebacks
                7. Structuring Detection — patterns suggesting structuring
                8. Velocity Anomaly — volume vs business age ratio
                
                COUNTRY RISK factors to assess:
                1. Local fraud rates and trends
                2. Regulatory environment (state/federal)
                3. Money laundering corridor risk
                4. FinCEN Geographic Targeting Orders
                5. Cross-border payment exposure
                6. Data privacy laws (CCPA, BIPA, state-specific)
                7. Financial licensing requirements
                
                Be strict on fraud. Use SHORT_CODEs: HIGH_CHARGEBACK, BUST_OUT, CNP_RISK, AML_FLAG, SHELL_COMPANY, INDUSTRY_RISK, STRUCTURING, VELOCITY_ANOMALY.
                """,
                req.getBusinessType(), req.getLocation(),
                req.getTransactionVolume(), req.getAverageTransactionSize(),
                req.getChargebackRate(), req.getChargebackRate() * 100,
                req.getYearsInBusiness(), req.getComplianceScore());

        String systemPrompt = "You are an expert payment fraud and geographic risk analyst. "
                + "Return ONLY valid JSON with 'fraud' and 'countryRisk' keys. No markdown, no explanation.";

        String response = callLlmWithSystemPrompt(systemPrompt, prompt, 1500);

        // If LLM failed, return graceful fallback (not a parse error)
        if (response.startsWith("[LLM Error]")) {
            Map<String, Object> fraud = new LinkedHashMap<>();
            fraud.put("fraudDetected", false);
            fraud.put("fraudFlag", 0);
            fraud.put("severity", "UNKNOWN");
            fraud.put("indicators", List.of(response));
            fraud.put("checks", List.of());
            fraud.put("passed", 0);
            fraud.put("failed", 0);
            fraud.put("totalSignals", 0);
            fraud.put("source", "llm-connection-error");
            combined.put("fraud", fraud);

            Map<String, Object> country = new LinkedHashMap<>();
            country.put("location", req.getLocation());
            country.put("riskLevel", "UNKNOWN");
            country.put("score", 50);
            country.put("factors", List.of(response));
            country.put("regulatoryNote", "LLM unavailable — manual assessment required.");
            country.put("recommendations", List.of());
            country.put("source", "llm-connection-error");
            combined.put("countryRisk", country);
            return combined;
        }

        try {
            String json = response.trim();
            if (json.startsWith("```")) {
                json = json.replaceAll("^```[a-z]*\\n?", "").replaceAll("\\n?```$", "").trim();
            }
            JsonNode root = objectMapper.readTree(json);

            // Parse fraud section
            JsonNode fraudNode = root.path("fraud");
            Map<String, Object> fraud = new LinkedHashMap<>();
            fraud.put("fraudDetected", fraudNode.path("fraudDetected").asBoolean(false));
            fraud.put("fraudFlag", fraudNode.path("fraudFlag").asInt(0));
            fraud.put("severity", fraudNode.path("severity").asText("UNKNOWN"));

            List<String> indicators = new ArrayList<>();
            if (fraudNode.has("indicators")) {
                for (JsonNode ind : fraudNode.get("indicators")) indicators.add(ind.asText());
            }
            fraud.put("indicators", indicators);

            List<Map<String, Object>> checks = new ArrayList<>();
            if (fraudNode.has("checks")) {
                for (JsonNode chk : fraudNode.get("checks")) {
                    Map<String, Object> c = new LinkedHashMap<>();
                    c.put("check", chk.path("check").asText());
                    c.put("status", chk.path("status").asText());
                    c.put("value", chk.path("value").asText());
                    c.put("note", chk.path("note").asText());
                    checks.add(c);
                }
            }
            fraud.put("checks", checks);
            fraud.put("passed", checks.stream().filter(c -> "PASS".equals(c.get("status"))).count());
            fraud.put("failed", checks.stream().filter(c -> "FAIL".equals(c.get("status"))).count());
            fraud.put("totalSignals", indicators.size());
            fraud.put("source", "llm-gpt4o");
            combined.put("fraud", fraud);

            // Parse countryRisk section
            JsonNode countryNode = root.path("countryRisk");
            Map<String, Object> country = new LinkedHashMap<>();
            country.put("location", req.getLocation());
            country.put("riskLevel", countryNode.path("riskLevel").asText("UNKNOWN"));
            country.put("score", countryNode.path("score").asInt(50));

            List<String> factors = new ArrayList<>();
            if (countryNode.has("factors")) {
                for (JsonNode f : countryNode.get("factors")) factors.add(f.asText());
            }
            country.put("factors", factors);
            country.put("regulatoryNote", countryNode.path("regulatoryNote").asText(""));

            List<String> recommendations = new ArrayList<>();
            if (countryNode.has("recommendations")) {
                for (JsonNode r : countryNode.get("recommendations")) recommendations.add(r.asText());
            }
            country.put("recommendations", recommendations);
            country.put("source", "llm-gpt4o");
            combined.put("countryRisk", country);

        } catch (Exception e) {
            Map<String, Object> fraud = new LinkedHashMap<>();
            fraud.put("fraudDetected", false);
            fraud.put("fraudFlag", 0);
            fraud.put("severity", "UNKNOWN");
            fraud.put("indicators", List.of("[LLM parse error] " + e.getMessage()));
            fraud.put("checks", List.of());
            fraud.put("passed", 0);
            fraud.put("failed", 0);
            fraud.put("totalSignals", 0);
            fraud.put("source", "llm-error");
            combined.put("fraud", fraud);

            Map<String, Object> country = new LinkedHashMap<>();
            country.put("location", req.getLocation());
            country.put("riskLevel", "UNKNOWN");
            country.put("score", 50);
            country.put("factors", List.of("[LLM parse error] " + e.getMessage()));
            country.put("regulatoryNote", "Manual assessment required.");
            country.put("recommendations", List.of());
            country.put("source", "llm-error");
            combined.put("countryRisk", country);
        }

        return combined;
    }

    private String callLlmWithSystemPrompt(String systemPrompt, String userPrompt, int maxTokens) {
        try {
            Map<String, Object> body = Map.of(
                    "model", model, "temperature", 0.1, "max_tokens", maxTokens,
                    "messages", List.of(
                            Map.of("role", "system", "content", systemPrompt),
                            Map.of("role", "user", "content", userPrompt)));

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            if ("api-key".equalsIgnoreCase(authType)) {
                headers.set("Api-Key", apiKey);
            } else {
                headers.setBearerAuth(apiKey);
            }

            HttpEntity<String> entity = new HttpEntity<>(objectMapper.writeValueAsString(body), headers);
            ResponseEntity<String> response = restTemplate.exchange(apiUrl, HttpMethod.POST, entity, String.class);
            JsonNode root = objectMapper.readTree(response.getBody());
            return root.path("choices").get(0).path("message").path("content").asText();
        } catch (Exception e) {
            return "[LLM Error] " + e.getMessage();
        }
    }

    private String callLlm(String userPrompt, int maxTokens) {
        try {
            String systemPrompt = "You are a senior payment risk analyst. Generate ALL requested report sections "
                    + "in a single response. Use the EXACT delimiters provided (===SECTION_NAME===) to separate sections. "
                    + "Be specific and data-driven. Reference actual values from the merchant data. "
                    + "Each section should be self-contained and written for its target audience.";

            Map<String, Object> body = Map.of(
                    "model", model, "temperature", 0.3, "max_tokens", maxTokens,
                    "messages", List.of(
                            Map.of("role", "system", "content", systemPrompt),
                            Map.of("role", "user", "content", userPrompt)));

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            if ("api-key".equalsIgnoreCase(authType)) {
                headers.set("Api-Key", apiKey);
            } else {
                headers.setBearerAuth(apiKey);
            }

            HttpEntity<String> entity = new HttpEntity<>(objectMapper.writeValueAsString(body), headers);
            ResponseEntity<String> response = restTemplate.exchange(apiUrl, HttpMethod.POST, entity, String.class);
            JsonNode root = objectMapper.readTree(response.getBody());
            return root.path("choices").get(0).path("message").path("content").asText();
        } catch (Exception e) {
            return "[LLM Error] " + e.getMessage();
        }
    }
}
