package com.epam.mcc_analyser.controller;
import com.epam.mcc_analyser.classification.MccAuditor;

import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.loader.FileSystemDocumentLoader;
import dev.langchain4j.data.document.parser.apache.pdfbox.ApachePdfBoxDocumentParser;
import dev.langchain4j.data.segment.TextSegment;

import dev.langchain4j.model.azure.AzureOpenAiChatModel;
import dev.langchain4j.model.azure.AzureOpenAiEmbeddingModel;

import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.rag.content.retriever.ContentRetriever;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.inmemory.InMemoryEmbeddingStore;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;

import java.nio.file.Paths;

import java.util.Collections;
import java.util.Map;

@Configuration
public class LangChainConfig {

    @Bean
    @Lazy
    public MccAuditor mccAuditor() {
        // 1. Setup Chat Model (Ollama)
       /* var chatModel = OllamaChatModel.builder()
                .baseUrl("http://localhost:11434")
                .modelName("deepseek-r1:8b")
                .timeout(Duration.ofMinutes(5))
                .build();

        // 2. Setup Embedding Model
        var embeddingModel = OllamaEmbeddingModel.builder()
                .baseUrl("http://localhost:11434")
                .modelName("bge-m3")
                .build();*/

        String apiKey = System.getenv("API_KEY");
        System.out.println("API KEY is "+apiKey);
        String baseUrl = "https://ai-proxy.lab.epam.com";

        EmbeddingModel embeddingModel = AzureOpenAiEmbeddingModel.builder()
                // The base endpoint for EPAM's proxy
                .endpoint("https://ai-proxy.lab.epam.com")

                // This must match the deployment name in your AI Launchpad
                .deploymentName("text-embedding-3-small-1")

                // Azure requires an API version (e.g., 2024-02-01 or 2023-05-15)
                .serviceVersion("2024-02-01")

                .apiKey(System.getenv("API_KEY"))

                // Logs are vital here to see the URL construction
                .build();



        // 1. Define your custom headers (replaces -H "Api-Key: ...")
        Map<String, String> headers = Collections.singletonMap("Api-Key", System.getenv("API_KEY"));

        // 2. Build the model to point to the proxy
        var chatModel = AzureOpenAiChatModel.builder()
                .endpoint("https://ai-proxy.lab.epam.com") // The proxy base path
                // gpt-4o-mini: 87% cheaper than gpt-4o, sufficient for MCC classification
                .deploymentName("gpt-4o-mini")

                // Azure requires an API version (e.g., 2024-02-01 or 2023-05-15)
                .serviceVersion("2024-12-01-preview")

                .apiKey(System.getenv("API_KEY"))

                // Logs are vital here to see the URL construction
                .build();

        // 3. Load and Index the Handbook (RAG)
        EmbeddingStore<TextSegment> embeddingStore = new InMemoryEmbeddingStore<>();
        // Resolve PDF relative to JAR location, with fallback to common paths
        String pdfPath = System.getProperty("mcc.handbook.path",
                locatePdf("MCC_Handbook_Sample.pdf"));
        Document manual = FileSystemDocumentLoader.loadDocument(
                Paths.get(pdfPath),
                new ApachePdfBoxDocumentParser()
        );

        // Simplified for POC: In production, use a DocumentSplitter here
        embeddingStore.add(embeddingModel.embed(manual.text()).content(), TextSegment.from(manual.text()));

        ContentRetriever retriever = EmbeddingStoreContentRetriever.builder()
                .embeddingStore(embeddingStore)
                .embeddingModel(embeddingModel)
                .maxResults(3)
                .build();

        // 4. Create the AI Service (The Bean Spring is looking for)
        return AiServices.builder(MccAuditor.class).chatLanguageModel(chatModel)
                .contentRetriever(retriever)
                .build();
    }

    private static String locatePdf(String filename) {
        // Try CWD first, then JAR directory, then known project paths
        String[] candidates = {
            filename,
            "../mcc-analyser/" + filename,
            System.getProperty("user.home") + "/bfsi-hackthon-2026/merchant-onboarding/mcc-analyser/" + filename,
        };
        for (String path : candidates) {
            if (new java.io.File(path).isFile()) return path;
        }
        return filename; // fallback — will give clear error
    }
}