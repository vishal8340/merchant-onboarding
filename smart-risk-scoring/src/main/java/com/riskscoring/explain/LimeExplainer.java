package com.riskscoring.explain;

import com.riskscoring.data.DataLoader;
import com.riskscoring.model.RiskModelInference;

import java.util.*;

/**
 * LIME-style explainability for risk predictions.
 * 
 * Since LIME4J is not available as a stable Maven artifact, this implements
 * the core LIME algorithm: Local Interpretable Model-agnostic Explanations.
 * 
 * How it works:
 * 1. Perturb the input features around the instance to explain
 * 2. Get predictions for perturbed samples
 * 3. Fit a weighted linear model locally
 * 4. Use linear coefficients as feature importance scores
 * 
 * This supports compliance requirements by providing transparent, auditable
 * explanations for why a merchant received a particular risk score.
 */
public class LimeExplainer {

    private final RiskModelInference inference;
    private final int numSamples;
    private final Random random;

    public LimeExplainer(RiskModelInference inference) {
        this(inference, 500);
    }

    public LimeExplainer(RiskModelInference inference, int numSamples) {
        this.inference = inference;
        this.numSamples = numSamples;
        this.random = new Random(42);
    }

    /**
     * Explain a prediction by computing feature contributions.
     * Returns a map of feature_name → contribution_weight (sorted by absolute value).
     */
    public List<FeatureContribution> explain(double[] originalFeatures) throws Exception {
        double[] originalProbs = inference.predictProbabilities(originalFeatures);
        int predictedClass = argmax(originalProbs);

        // Generate perturbed samples
        double[][] perturbedSamples = new double[numSamples][originalFeatures.length];
        double[] weights = new double[numSamples];
        double[] targets = new double[numSamples];

        for (int i = 0; i < numSamples; i++) {
            perturbedSamples[i] = perturbInstance(originalFeatures);
            double distance = euclideanDistance(originalFeatures, perturbedSamples[i]);
            weights[i] = Math.exp(-distance * distance / (0.75 * 0.75)); // kernel width
            double[] probs = inference.predictProbabilities(perturbedSamples[i]);
            targets[i] = probs[predictedClass];
        }

        // Fit weighted linear regression to get feature importances
        double[] coefficients = weightedLinearRegression(perturbedSamples, targets, weights);

        // Build sorted explanation
        List<FeatureContribution> contributions = new ArrayList<>();
        for (int i = 0; i < coefficients.length; i++) {
            contributions.add(new FeatureContribution(
                    DataLoader.FEATURE_NAMES[i],
                    coefficients[i],
                    originalFeatures[i]
            ));
        }
        contributions.sort((a, b) -> Double.compare(Math.abs(b.weight), Math.abs(a.weight)));
        return contributions;
    }

    /**
     * Print a human-readable explanation.
     */
    public void printExplanation(double[] features, String prediction) throws Exception {
        List<FeatureContribution> explanation = explain(features);
        System.out.println("\n--- LIME Explanation for prediction: " + prediction + " ---");
        System.out.println("Top contributing features:");
        for (int i = 0; i < Math.min(5, explanation.size()); i++) {
            FeatureContribution fc = explanation.get(i);
            String direction = fc.weight > 0 ? "↑ supports" : "↓ opposes";
            System.out.printf("  %d. %s (value=%.4f) → %s prediction (weight=%.4f)%n",
                    i + 1, fc.featureName, fc.featureValue, direction, fc.weight);
        }
    }

    private double[] perturbInstance(double[] original) {
        double[] perturbed = original.clone();
        for (int i = 0; i < perturbed.length; i++) {
            // For categorical features (indices 0, 2, 6), randomly flip
            if (i == 0 || i == 2) {
                if (random.nextDouble() < 0.3) perturbed[i] = random.nextInt(5);
            } else if (i == 6) {
                if (random.nextDouble() < 0.3) perturbed[i] = 1 - perturbed[i];
            } else if (i == 8) {
                // fraud_severity: ordinal 0-4 (NONE/LOW/MODERATE/HIGH/CRITICAL)
                if (random.nextDouble() < 0.3) perturbed[i] = random.nextInt(5);
            } else {
                // Numeric: add Gaussian noise proportional to value
                double noise = random.nextGaussian() * Math.max(Math.abs(original[i]) * 0.2, 1);
                perturbed[i] = Math.max(0, original[i] + noise);
                // Clamp country_risk_score to 0-100
                if (i == 9) perturbed[i] = Math.min(100, perturbed[i]);
            }
        }
        return perturbed;
    }

    private double euclideanDistance(double[] a, double[] b) {
        double sum = 0;
        for (int i = 0; i < a.length; i++) {
            double diff = (a[i] - b[i]) / Math.max(Math.abs(a[i]), 1);
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }

    /**
     * Simple weighted least squares: (X'WX)^-1 X'Wy
     * Uses ridge regularization for stability.
     */
    private double[] weightedLinearRegression(double[][] X, double[] y, double[] w) {
        int n = X.length;
        int p = X[0].length;
        double ridge = 0.01;

        // Compute X'WX + ridge*I
        double[][] XtWX = new double[p][p];
        double[] XtWy = new double[p];

        for (int i = 0; i < n; i++) {
            for (int j = 0; j < p; j++) {
                XtWy[j] += X[i][j] * w[i] * y[i];
                for (int k = 0; k < p; k++) {
                    XtWX[j][k] += X[i][j] * w[i] * X[i][k];
                }
            }
        }
        for (int j = 0; j < p; j++) XtWX[j][j] += ridge;

        // Solve using Gaussian elimination
        return solveLinearSystem(XtWX, XtWy);
    }

    private double[] solveLinearSystem(double[][] A, double[] b) {
        int n = A.length;
        double[][] aug = new double[n][n + 1];
        for (int i = 0; i < n; i++) {
            System.arraycopy(A[i], 0, aug[i], 0, n);
            aug[i][n] = b[i];
        }
        for (int col = 0; col < n; col++) {
            int maxRow = col;
            for (int row = col + 1; row < n; row++)
                if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
            double[] tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp;
            if (Math.abs(aug[col][col]) < 1e-12) continue;
            for (int row = col + 1; row < n; row++) {
                double factor = aug[row][col] / aug[col][col];
                for (int j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
            }
        }
        double[] x = new double[n];
        for (int i = n - 1; i >= 0; i--) {
            x[i] = aug[i][n];
            for (int j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
            if (Math.abs(aug[i][i]) > 1e-12) x[i] /= aug[i][i];
        }
        return x;
    }

    private int argmax(double[] arr) {
        int idx = 0;
        for (int i = 1; i < arr.length; i++) if (arr[i] > arr[idx]) idx = i;
        return idx;
    }

    /** Represents a single feature's contribution to a prediction */
    public static class FeatureContribution {
        public final String featureName;
        public final double weight;
        public final double featureValue;

        public FeatureContribution(String featureName, double weight, double featureValue) {
            this.featureName = featureName;
            this.weight = weight;
            this.featureValue = featureValue;
        }

        @Override
        public String toString() {
            return featureName + " (w=" + String.format("%.4f", weight) + ", val=" + String.format("%.4f", featureValue) + ")";
        }
    }

    public static void main(String[] args) throws Exception {
        // Load model and create explainer
        RiskModelInference inference = new RiskModelInference("data/risk_model.ser");
        LimeExplainer explainer = new LimeExplainer(inference);

        // Explain a high-risk merchant (with LLM-derived features: severity=4/CRITICAL, countryRisk=80)
        double[] highRisk = DataLoader.encodeMerchant("Online", 180000, "Miami", 0.15, 1, 800, 1, 45, 4, 80);
        String prediction = inference.predictFromFeatures(highRisk);
        explainer.printExplanation(highRisk, prediction);

        // Explain a low-risk merchant (severity=0/NONE, countryRisk=25)
        double[] lowRisk = DataLoader.encodeMerchant("Retail", 30000, "NewYork", 0.01, 15, 40, 0, 95, 0, 25);
        prediction = inference.predictFromFeatures(lowRisk);
        explainer.printExplanation(lowRisk, prediction);
    }
}

