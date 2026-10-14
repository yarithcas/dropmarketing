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

export interface AnalystResponse {
  engine: "claude" | "rules";
  intent: AnalystIntent;
  summary: Text;
  recommendations: Recommendation[];
  sections: AnalystSection[];
  sources: { label: string; href: string }[];
  disclaimer: Text;
  notice?: Text;
}

export const analystRequestSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  productIds: z.array(z.string().max(120)).max(5).default([]),
  locale: z.enum(["fr", "en", "es", "de", "it"]).default("fr"),
});
export type AnalystRequest = z.infer<typeof analystRequestSchema>;
