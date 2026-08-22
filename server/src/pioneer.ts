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

export interface ClassificationResult {
  text: string;
  labels: { label: string; confidence: number }[];
}

/** Classifies each text description against `classifications` via Pioneer's GLiNER2 inference endpoint. */
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
      schema: { classifications },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Pioneer inference failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { result?: unknown };
  const results = Array.isArray(data.result) ? data.result : [];

  return texts.map((text, i) => ({
    text,
    labels: normalizeLabels(results[i]),
  }));
}

/**
 * Pioneer's classification response shape isn't nailed down in the docs we have, so this
 * accepts either `{ classifications: [{label, confidence}] }` or a bare array of the same,
 * and tolerates `entity`/`score` as aliases for `label`/`confidence`.
 *
 * Note: a real Pioneer call using a `structures` schema (not `classifications`) has been
 * observed to return a flat, typed pose-attribute object instead (e.g. `trunk_position`,
 * `knee_flexion_near_deg`) with no per-field confidence score. If you switch FORM_CLASSIFICATIONS
 * over to a `structures` request, this parsing (and compareClassifications below) needs rework
 * to diff field values directly rather than average confidences.
 */
function normalizeLabels(entry: unknown): { label: string; confidence: number }[] {
  if (!entry) return [];

  const classifications = (entry as { classifications?: unknown }).classifications;
  const source = Array.isArray(classifications) ? classifications : entry;
  if (!Array.isArray(source)) return [];

  const labels: { label: string; confidence: number }[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const label = record.label ?? record.entity;
    const confidence = record.confidence ?? record.score;
    if (typeof label === "string" && typeof confidence === "number") {
      labels.push({ label, confidence });
    }
  }
  return labels;
}

/** Average confidence per classification across a set of frame results. */
function averageConfidence(
  results: ClassificationResult[],
  classifications: string[],
): Record<string, number> {
  const sums: Record<string, number> = Object.fromEntries(classifications.map((c) => [c, 0]));
  for (const result of results) {
    for (const { label, confidence } of result.labels) {
      if (label in sums) sums[label] += confidence;
    }
  }
  const count = results.length || 1;
  return Object.fromEntries(classifications.map((c) => [c, sums[c] / count]));
}

const SIGNIFICANT_DELTA = 0.2;

export interface FormComparison {
  feedback: string;
  referenceScores: Record<string, number>;
  userScores: Record<string, number>;
}

/** Compares reference vs. user classification averages and writes plain-language feedback. */
export function compareClassifications(
  referenceResults: ClassificationResult[],
  userResults: ClassificationResult[],
  classifications: string[],
): FormComparison {
  const referenceScores = averageConfidence(referenceResults, classifications);
  const userScores = averageConfidence(userResults, classifications);

  const lines: string[] = [];
  for (const label of classifications) {
    const delta = userScores[label] - referenceScores[label];
    if (Math.abs(delta) < SIGNIFICANT_DELTA) continue;

    const readable = label.replace(/_/g, " ");
    const refPct = Math.round(referenceScores[label] * 100);
    const userPct = Math.round(userScores[label] * 100);

    lines.push(
      delta > 0
        ? `Your attempt shows more "${readable}" (${userPct}%) than the reference (${refPct}%) — work on correcting this.`
        : `Your attempt shows less "${readable}" (${userPct}%) than the reference (${refPct}%) — good control here.`,
    );
  }

  const feedback =
    lines.length > 0
      ? lines.join("\n")
      : "Your form closely matches the reference across all tracked categories. Nice work!";

  return { feedback, referenceScores, userScores };
}
