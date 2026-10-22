package com.epam.mcc_analyser;

import com.epam.mcc_analyser.classification.MccAuditor;
import dev.langchain4j.model.azure.AzureOpenAiChatModel;

import dev.langchain4j.service.AiServices;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.util.Collections;

import java.util.Map;

@SpringBootApplication
public class MccAnalyserApplication {

	public static void main(String[] args) {

		SpringApplication.run(MccAnalyserApplication.class, args);

		//MccService.doClassification();

	}

	public static void testModel(){
		String apiKey = System.getenv("API_KEY");

		String baseUrl = "https://ai-proxy.lab.epam.com";

		// 1. Define your custom headers (replaces -H "Api-Key: ...")
		Map<String, String> headers = Collections.singletonMap("Api-Key", System.getenv("API_KEY"));

		// 2. Build the model to point to the proxy
		var chatModel = AzureOpenAiChatModel.builder()
				.endpoint("https://ai-proxy.lab.epam.com") // The proxy base path
				// This must match the deployment name in your AI Launchpad
				.deploymentName("gpt-4o")

				// Azure requires an API version (e.g., 2024-02-01 or 2023-05-15)
				.serviceVersion("2024-12-01-preview")

				.apiKey(System.getenv("API_KEY"))

				// Logs are vital here to see the URL construction
				.build();

		System.out.println(" Response : "+chatModel.generate("tell me a joke "));

		/*MccAuditor auditor = AiServices.builder(MccAuditor.class).chatLanguageModel(chatModel)
				.build();
		auditor.classify("This is Juice Business");*/
	}

	}


