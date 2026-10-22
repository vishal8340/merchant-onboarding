package com.riskscoring.model;

import com.riskscoring.data.DataLoader;
import weka.classifiers.trees.RandomForest;
import weka.core.*;

import java.io.*;
import java.util.ArrayList;

/**
 * Trains a Random Forest classifier using Weka library.
 * The model predicts merchant risk_label (Low/Medium/High) from encoded features.
 */
public class RiskModelTrainer {

    private static final String MODEL_PATH = "data/risk_model.ser";

    /**
     * Train a Random Forest model on the provided dataset.
     */
    public static RandomForest train(double[][] features, int[] labels) throws Exception {
        Instances dataset = buildInstances(features, labels);

        RandomForest model = new RandomForest();
        model.setNumIterations(100);
        model.setMaxDepth(20);
        model.setSeed(42);
        model.buildClassifier(dataset);

        // Print training accuracy
        int correct = 0;
        for (int i = 0; i < dataset.numInstances(); i++) {
            int predicted = (int) model.classifyInstance(dataset.instance(i));
            if (predicted == labels[i]) correct++;
        }
        double accuracy = (double) correct / features.length * 100;
        System.out.printf("Training Accuracy: %.2f%% (%d/%d)%n", accuracy, correct, features.length);

        return model;
    }

    /**
     * Build Weka Instances from features and labels.
     */
    public static Instances buildInstances(double[][] features, int[] labels) {
        ArrayList<Attribute> attributes = buildAttributes();
        Instances dataset = new Instances("MerchantRisk", attributes, features.length);
        dataset.setClassIndex(attributes.size() - 1);

        for (int i = 0; i < features.length; i++) {
            Instance inst = new DenseInstance(attributes.size());
            inst.setDataset(dataset);
            for (int j = 0; j < features[i].length; j++) {
                inst.setValue(j, features[i][j]);
            }
            inst.setValue(attributes.size() - 1, DataLoader.RISK_LABELS[labels[i]]);
            dataset.add(inst);
        }
        return dataset;
    }

    /**
     * Build a single Weka Instance for prediction.
     */
    public static Instance buildSingleInstance(double[] features, Instances header) {
        Instance inst = new DenseInstance(header.numAttributes());
        inst.setDataset(header);
        for (int j = 0; j < features.length; j++) {
            inst.setValue(j, features[j]);
        }
        return inst;
    }

    /**
     * Create the attribute schema for the dataset.
     */
    public static ArrayList<Attribute> buildAttributes() {
        ArrayList<Attribute> attributes = new ArrayList<>();
        for (String name : DataLoader.FEATURE_NAMES) {
            attributes.add(new Attribute(name));
        }
        ArrayList<String> classValues = new ArrayList<>();
        classValues.add("Low");
        classValues.add("Medium");
        classValues.add("High");
        attributes.add(new Attribute("risk_label", classValues));
        return attributes;
    }

    /**
     * Create an empty Instances object (header only) for inference.
     */
    public static Instances createHeader() {
        ArrayList<Attribute> attributes = buildAttributes();
        Instances header = new Instances("MerchantRisk", attributes, 0);
        header.setClassIndex(attributes.size() - 1);
        return header;
    }

    /**
     * Save the trained model to disk.
     */
    public static void saveModel(RandomForest model, String path) throws IOException {
        new File(path).getParentFile().mkdirs();
        try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream(path))) {
            oos.writeObject(model);
        }
        System.out.println("Model saved to: " + path);
    }

    /**
     * Load a previously saved model.
     */
    public static RandomForest loadModel(String path) throws IOException, ClassNotFoundException {
        try (ObjectInputStream ois = new ObjectInputStream(new FileInputStream(path))) {
            RandomForest model = (RandomForest) ois.readObject();
            System.out.println("Model loaded from: " + path);
            return model;
        }
    }

    public static void main(String[] args) throws Exception {
        // Generate data first
        com.riskscoring.data.SyntheticDataGenerator.generate(1000, "data/merchants.csv");

        // Load data
        DataLoader.DataSet dataSet = DataLoader.load("data/merchants.csv");

        // Train model
        RandomForest model = train(dataSet.features, dataSet.labels);

        // Save model
        saveModel(model, MODEL_PATH);

        System.out.println("\n--- Model Training Complete ---");
        System.out.println("Features used: " + String.join(", ", DataLoader.FEATURE_NAMES));
        System.out.println("Classes: Low (0), Medium (1), High (2)");
    }
}
