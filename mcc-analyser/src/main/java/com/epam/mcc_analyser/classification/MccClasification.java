package com.epam.mcc_analyser.classification;

import java.util.List;

public class MccClasification {

    public record MccClassification(
            String businessName,
            String primaryMcc,
            List<String> secondaryMccs,
            double confidenceScore,
            String justificationString
    ) {}
}
