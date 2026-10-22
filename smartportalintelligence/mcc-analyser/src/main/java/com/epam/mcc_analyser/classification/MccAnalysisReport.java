package com.epam.mcc_analyser.classification;

import lombok.Data;
import java.util.List;

@Data
public class MccAnalysisReport {
    private String mccCode;            // The 4-digit code
    private double confidence;         // 0.0 to 1.0
    private String handbookCitation;   // Quote from the MCC PDF
    private String reasoning;          // Explanation of why this code was chosen
    private List<String> secondaryMccs; // Alternative codes considered
    private List<String> detectedRisks; // High-risk keywords identified
}