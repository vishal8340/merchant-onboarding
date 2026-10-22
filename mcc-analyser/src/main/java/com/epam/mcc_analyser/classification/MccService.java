package com.epam.mcc_analyser.classification;

import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.loader.FileSystemDocumentLoader;
import dev.langchain4j.data.document.parser.apache.pdfbox.ApachePdfBoxDocumentParser;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.ollama.OllamaChatModel;
import dev.langchain4j.model.ollama.OllamaEmbeddingModel;
import dev.langchain4j.rag.content.retriever.ContentRetriever;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.inmemory.InMemoryEmbeddingStore;
import lombok.extern.log4j.Log4j;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
public class MccService {

       /* public static void doClassification(){

            System.out.println("reachin here S");

            var chatModel = OllamaChatModel.builder()
                    .baseUrl("http://localhost:11434")
                    .modelName("deepseek-r1:8b")
                    .timeout(Duration.ofMinutes(5))
                    .temperature(0.0) // 0.0 ensures deterministic audit results
                    .build();

            var embeddingModel = OllamaEmbeddingModel.builder()
                    .baseUrl("http://localhost:11434")
                    .modelName("bge-m3")
                    .build();

            // 2. RAG: Load the MCC Manual into Vector Store
            EmbeddingStore<TextSegment> embeddingStore = new InMemoryEmbeddingStore<>();
            Document manual = FileSystemDocumentLoader.loadDocument("mcc_handbook.pdf", new ApachePdfBoxDocumentParser());

            // In a real MVP, use a proper DocumentSplitter here
            embeddingStore.add(embeddingModel.embed(manual.text()).content(), TextSegment.from(manual.text()));

            ContentRetriever retriever = EmbeddingStoreContentRetriever.builder()
                    .embeddingStore(embeddingStore)
                    .embeddingModel(embeddingModel)
                    .maxResults(3)
                    .build();

            // 3. Build the Agent
            MccAuditor agent = AiServices.builder(MccAuditor.class).chatModel(chatModel)
                    .contentRetriever(retriever)
                    .build();

            // 4. Test Case: Hybrid Business
            String testData = "Business Name: The Daily Grind. Evidence: Sells coffee, pastries, and hosts weekly paid pottery classes in the back room.";
            MccClasification.MccClassification result = agent.classify(testData);

            // 5. Output for Demo
            System.out.println("Business: " + result.businessName());
            System.out.println("Primary MCC: " + result.primaryMcc());
            System.out.println("Justification: " + result.justificationString());

            if (result.confidenceScore() >= 0.85) {
                // STRAIGHT-THROUGH PROCESSING
                System.out.println("✅ Auto-Approved: " + result.businessName());
            }
            else if (result.confidenceScore() >= 0.50) {
                // HUMAN-IN-THE-LOOP (HITL)
                System.out.println("⚠️ Routed to Human: " + result.businessName() + " (Score: " + result.confidenceScore() + ")");
            }
            else {
                // REJECT / REQUEST MORE INFO
                System.out.println("❌ High Risk/Low Info: Requesting Manual Docs.");
            }
        }*/

}


