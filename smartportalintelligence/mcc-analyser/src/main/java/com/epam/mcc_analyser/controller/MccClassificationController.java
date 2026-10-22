package com.epam.mcc_analyser.controller;

import com.epam.mcc_analyser.classification.MccAnalysisReport;
import com.epam.mcc_analyser.classification.MccAuditor;
import com.epam.mcc_analyser.classification.MccClasification;
import com.epam.mcc_analyser.classification.MerchantTask;
import org.springframework.context.annotation.Lazy;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/v1/onboarding")
public class MccClassificationController {

   private final MccAuditor mccAgent;
   /** Cache keyed by "description|location" — avoids repeated LLM calls for known (businessType, country) combos */
   private final ConcurrentHashMap<String, MccAnalysisReport> mccCache = new ConcurrentHashMap<>();

    // In a real app, use Constructor Injection for your Agent
    public MccClassificationController(@Lazy MccAuditor mccAgent) {
        this.mccAgent = mccAgent;
    }

    /**
     * Endpoint for other services to request a merchant classification.
     * POST /api/v1/onboarding/classify
     */
    @PostMapping("/classify")
    public ResponseEntity<MccAnalysisReport> classifyMerchant(@RequestBody MerchantRequest request) {
        try {
            System.out.println("Classify MCC !!");
            // Cache key: normalised description + location (covers businessType + country combos)
            String cacheKey = request.description().trim().toLowerCase() + "|" + request.location().trim().toLowerCase();
            MccAnalysisReport cached = mccCache.get(cacheKey);
            if (cached != null) {
                System.out.println("[MCC] Cache hit for key: " + cacheKey);
                return ResponseEntity.ok(cached);
            }
            MccAnalysisReport result = mccAgent.analyze(buildContext(request));
            // Only cache confident results (avoid caching low-confidence / fallback responses)
            if (result.getConfidence() >= 0.6) {
                mccCache.put(cacheKey, result);
            }
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            // FALLBACK: If AI unavailable (network/auth), return a default MCC for human review
            System.err.println("[MCC] AI classification failed, using fallback: " + e.getMessage());
            MccAnalysisReport fallback = new MccAnalysisReport();
            fallback.setMccCode("5999");
            fallback.setConfidence(0.0);
            fallback.setReasoning("AI service unreachable — auto-assigned fallback MCC for manual verification.");
            fallback.setSecondaryMccs(List.of());
            fallback.setDetectedRisks(List.of());
            return ResponseEntity.ok(fallback);
        }
    }

    @GetMapping("/test-onboarding")
    public String triggerTest(@RequestParam String type) {
        MerchantTask task = switch(type) {
            case "safe" -> new MerchantTask("ID-1", "Zest & Zen", "A premium yoga studio offering classes and mats.", "India", System.currentTimeMillis());
            case "mismatch" -> new MerchantTask("ID-2", "Tactical Treats", "A bakery selling sourdough bread and tactical protection units.", "India", System.currentTimeMillis());
            default -> new MerchantTask("ID-3", "General Store", "Selling various items.", "India", System.currentTimeMillis());
        };

        //rabbitTemplate.convertAndSend("agent.mcc.queue", task);
        return "Task sent to RabbitMQ: " + type;
    }

    private String buildContext(MerchantRequest request) {
        // Compact format — ~50% fewer tokens vs verbose version
        String desc = (request.description() != null && !request.description().isBlank())
                ? request.description()
                : "Not provided";
        return "Business: " + request.businessName() +
               " | Location: " + request.location() +
               " | Activity: " + desc;
    }


    private String determineRoutingStatus(double score) {
        if (score >= 0.85) return "AUTO_APPROVED";
        if (score >= 0.50) return "ROUTED_TO_HUMAN";
        return "DOCUMENT_REQUEST_REQUIRED";
    }
}

// Request and Response DTOs
record MerchantRequest(String businessName, String location, String description) {}
record MccClassificationResponse(MccClasification.MccClassification classification, String systemStatus) {}
