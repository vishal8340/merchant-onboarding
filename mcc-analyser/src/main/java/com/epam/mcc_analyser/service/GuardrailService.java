package com.epam.mcc_analyser.service;

import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Service;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class GuardrailService {

    // Define keywords that represent high-risk or prohibited items
    private static final Map<String, String> RISK_KEYWORDS = Map.of(
            "protection unit", "WEAPONS",
            "tactical", "MILITARY",
            "ammunition", "WEAPONS",
            "pharmaceutical", "MEDICAL",
            "cannabis", "RESTRICTED",
            "betting", "GAMBLING"
    );

    // List of MCCs that are normally "Safe" and shouldn't contain the keywords above
    private static final Set<String> SAFE_MCCS = Set.of("5462", "5812", "5992", "7298"); // Bakery, Cafe, Florist, Spa

    private Pattern riskPattern;

    @PostConstruct
    public void init() {
        // Compile all keywords into a single case-insensitive regex for microsecond performance
        String regexString = "\\b(" + String.join("|", RISK_KEYWORDS.keySet()) + ")\\b";
        this.riskPattern = Pattern.compile(regexString, Pattern.CASE_INSENSITIVE);
    }

    /**
     * Checks if a high-risk keyword exists in a description that is mapped to a low-risk MCC.
     */
    public boolean isEscalationRequired(String description, String detectedMcc) {
        // 1. If description is empty, nothing to scan
        if (description == null || description.isBlank()) {
            return false;
        }

        // 2. Identify if the AI classified this as a "Safe/Low-Risk" business
        boolean isSafeCategory = SAFE_MCCS.contains(detectedMcc);

        // 3. Scan for red-flag keywords
        Matcher matcher = riskPattern.matcher(description);
        boolean hasRiskKeyword = matcher.find();

        // 4. THE GUARDRAIL LOGIC:
        // If it's labeled as a "Safe" business (like a Bakery) but contains a risk word (like "Tactical"),
        // then we MUST escalate to the Fraud Agent.
        return isSafeCategory && hasRiskKeyword;
    }
}
