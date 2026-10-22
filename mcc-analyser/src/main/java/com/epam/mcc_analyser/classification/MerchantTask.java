package com.epam.mcc_analyser.classification;

import java.io.Serializable;

/**
 * Represents the onboarding task sent from the Orchestrator
 * to the MCC Analyser Agent.
 */
public record MerchantTask(
        String correlationId,   // Unique ID to track this request across services
        String businessName,    // The name of the merchant (e.g., "Zest & Zen")
        String description,     // The raw business description provided by the user
        String location,        // Geographic context (optional, helps AI reasoning)
        long timestamp          // When the task was created
) implements Serializable {

    // Canonical Constructor for extra safety (Optional)
    public MerchantTask {
        if (correlationId == null || correlationId.isBlank()) {
            throw new IllegalArgumentException("Correlation ID cannot be null or empty");
        }
    }
}
