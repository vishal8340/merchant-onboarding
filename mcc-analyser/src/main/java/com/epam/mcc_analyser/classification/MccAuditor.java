package com.epam.mcc_analyser.classification;

import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;

public interface MccAuditor {

    @SystemMessage("""
        You are an MCC Auditor. Classify the merchant using the MCC Handbook context.
        Rules: 1) Cite handbook section in handbookCitation. 2) For hybrid businesses, Service > Retail.
        3) Set confidence < 0.6 if unsure. 4) Flag stealth risks (weapons, gambling, crypto).
    """)
    MccAnalysisReport analyze(@UserMessage String merchantDescription);
}