import { config } from "./config.js";

/** Exercise-form categories a frame description is classified against. */
export const FORM_CLASSIFICATIONS = [
  "good_alignment",
  "knee_valgus",
  "excessive_forward_lean",
  "limited_range_of_motion",
  "asymmetric_weight_distribution",
  "poor_tempo_control",
];

const CLASSIFICATION_TASK = "exercise_form";

export interface ClassificationResult {
  text: string;
  label: string;
  confidence: number;
}

/**
 * Classifies each text description against `classifications` via Pioneer's standard (not
 * fine-tuned) GLiNER2 inference endpoint. Confirmed live response shape:
 *   { result: [{ data: { [task]: { label: string, confidence: number } } }, ...] }
 * Pioneer picks a single winning label per text — not a score per category — so comparison
 * below tallies how often each label wins across reference vs. user frames.
 */
export async function classifyDescriptions(
  texts: string[],
  classifications: string[],
): Promise<ClassificationResult[]> {
  if (!config.pioneerApiKey) {
    throw new Error("pioneerApiKey is not configured in secrets.yaml");
  }

  const response = await fetch(`${config.pioneerBaseUrl}/inference`, {
    method: "POST",
    headers: {
      "X-API-Key": config.pioneerApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: config.pioneerModelId,
      text: texts,
      schema: { classifications: [{ task: CLASSIFICATION_TASK, labels: classifications }] },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Pioneer inference failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { result?: unknown };
  const results = Array.isArray(data.result) ? data.result : [];

  return texts.map((text, i) => ({ text, ...parseClassification(results[i]) }));
}

function parseClassification(entry: unknown): { label: string; confidence: number } {
  const data = (entry as { data?: Record<string, unknown> } | undefined)?.data;
  const picked = data?.[CLASSIFICATION_TASK] as { label?: unknown; confidence?: unknown } | undefined;

  return {
    label: typeof picked?.label === "string" ? picked.label : "unclassified",
    confidence: typeof picked?.confidence === "number" ? picked.confidence : 0,
  };
}

/** Fraction of results whose winning label was each classification. */
function labelDistribution(
  results: ClassificationResult[],
  classifications: string[],
): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(classifications.map((c) => [c, 0]));
  for (const result of results) {
    if (result.label in counts) counts[result.label] += 1;
  }
  const total = results.length || 1;
  return Object.fromEntries(classifications.map((c) => [c, counts[c] / total]));
}

const SIGNIFICANT_DELTA = 0.2;

export interface FormComparison {
  feedback: string;
  referenceScores: Record<string, number>;
  userScores: Record<string, number>;
}

/** Compares reference vs. user label distributions and writes plain-language feedback. */
export function compareClassifications(
  referenceResults: ClassificationResult[],
  userResults: ClassificationResult[],
  classifications: string[],
): FormComparison {
  const referenceScores = labelDistribution(referenceResults, classifications);
  const userScores = labelDistribution(userResults, classifications);

  const lines: string[] = [];
  for (const label of classifications) {
    const delta = userScores[label] - referenceScores[label];
    if (Math.abs(delta) < SIGNIFICANT_DELTA) continue;

    const readable = label.replace(/_/g, " ");
    const refPct = Math.round(referenceScores[label] * 100);
    const userPct = Math.round(userScores[label] * 100);

    lines.push(
      delta > 0
        ? `Your attempt shows more "${readable}" (${userPct}% of frames) than the reference (${refPct}%) — work on correcting this.`
        : `Your attempt shows less "${readable}" (${userPct}% of frames) than the reference (${refPct}%) — good control here.`,
    );
  }

  const feedback =
    lines.length > 0
      ? lines.join("\n")
      : "Your form closely matches the reference across all tracked categories. Nice work!";

  return { feedback, referenceScores, userScores };
}
