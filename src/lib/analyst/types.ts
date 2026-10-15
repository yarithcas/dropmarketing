import { z } from "zod";
import type { Confidence } from "../types";

/** Either literal text (AI engine, already in the user's language) or an i18n key (rule engine). */
export type Text = string | { key: string; params?: Record<string, string | number> };

export const ANALYST_INTENTS = ["find", "analyze", "compare", "angles", "risks", "checklist"] as const;
export type AnalystIntent = (typeof ANALYST_INTENTS)[number];

export interface Recommendation {
  productId: string;
  productName: string;
  score: number | null;
  why: Text[];
  evidence: Text[];
  risks: Text[];
  missing: Text[];
  confidence: Confidence;
  validation: Text[];
}

export interface AnalystSection {
  title: Text;
  items: Text[];
}

/** A comparison needs between COMPARE_MIN and COMPARE_MAX products chosen by the user. */
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 5;

export interface AnalystResponse {
  engine: "claude" | "rules";
  intent: AnalystIntent;
  summary: Text;
  recommendations: Recommendation[];
  sections: AnalystSection[];
  sources: { label: string; href: string }[];
  disclaimer: Text;
  notice?: Text;
  /** Says which records the answer used when the user selected none, and why they were picked. */
  contextNote?: Text;
  /** Set instead of an answer when the question needs products the user has not selected yet. */
  needsProducts?: { min: number; max: number; selected: number };
  /** Records the user can add as context; each carries the reason it is suggested. */
  suggestions?: { id: string; name: string; score: number | null; reason: Text }[];
}

export const analystRequestSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  productIds: z.array(z.string().max(120)).max(COMPARE_MAX).default([]),
  locale: z.enum(["fr", "en", "es", "de", "it"]).default("fr"),
});
export type AnalystRequest = z.infer<typeof analystRequestSchema>;
