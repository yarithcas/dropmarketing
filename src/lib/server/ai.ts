import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env, features } from "./env";
import type { AnalystIntent, AnalystResponse } from "../analyst/types";
import { ANALYST_INTENTS } from "../analyst/types";
import type { CreativeAnalysis } from "../analyst/creative";
import { HOOK_TYPES, STRUCTURES, TRIGGERS } from "../analyst/creative";
import type { Advertisement, ProductWithMetrics } from "../types";
import { LOCALE_LABEL, type Locale } from "../i18n/config";

/**
 * Server-side AI provider (Anthropic Claude). The API key never reaches the
 * browser. The model only sees records we pass in and must cite them by id;
 * any recommendation referencing an unknown id is dropped.
 */

let client: Anthropic | null = null;
function anthropic() {
  if (!features().ai) return null;
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, timeout: 90_000, maxRetries: 2 });
  return client;
}

const recSchema = z.object({
  productId: z.string(),
  why: z.array(z.string()),
  evidence: z.array(z.string()),
  risks: z.array(z.string()),
  missing: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  validation: z.array(z.string()),
});

const analystSchema = z.object({
  intent: z.enum(ANALYST_INTENTS),
  summary: z.string(),
  recommendations: z.array(recSchema),
  sections: z.array(z.object({ title: z.string(), items: z.array(z.string()) })),
});

function compactRecord(p: ProductWithMetrics) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    description: p.description,
    tags: p.tags,
    dataKind: p.source.kind,
    priceEstimate: p.priceEstimate,
    supplierCostEstimate: p.supplierCostEstimate,
    currency: p.currency,
    estimatedGrossMarginPct: p.metrics.grossMargin == null ? null : Math.round(p.metrics.grossMargin * 100),
    firstDetected: p.firstDetected,
    lastDetected: p.lastDetected,
    adsObserved: p.metrics.adsObserved,
    adsActiveLatestDay: p.metrics.adsActive,
    advertisersObserved: p.metrics.advertisersObserved,
    storesObserved: p.metrics.storesObserved,
    activeAdsGrowth30dPct: p.metrics.trendGrowth,
    competition: p.metrics.competition,
    saturationEstimate: p.metrics.saturation,
    opportunityScore: p.score.overall,
    scoreConfidence: p.score.confidence,
    scoreComponents: Object.fromEntries(p.score.components.map((c) => [c.key, c.value])),
    shippingVerified: p.shipping.verified,
    channels: p.channels,
    countries: p.countries,
  };
}

const SYSTEM = `You are TrendHunter's product research analyst for e-commerce entrepreneurs.
Ground rules:
- Use ONLY the product records provided in <records>. Never invent products, numbers, sales figures, revenue, conversion rates, ad spend, ROAS or sources.
- Refer to products by their exact "id" in recommendations. Do not recommend products that are not in the records.
- Distinguish clearly between observed data (ads, stores, dates), third-party estimates (prices, costs, margins, saturation) and your own conclusions.
- If records have dataKind "demo", say the data is demo sample data, not real market observations.
- Opportunity scores are heuristics, never guarantees of sales or profit.
- For each recommendation explain why, cite evidence from the record fields, list risks, list missing information, give a confidence level and concrete validation tests.
- When asked for advertising angles, propose original concepts; never copy third-party ad copy.
- Be concise and practical.`;

export async function claudeAnalyst(question: string, locale: Locale, records: ProductWithMetrics[], intentHint: AnalystIntent): Promise<AnalystResponse | null> {
  const c = anthropic();
  if (!c) return null;
  const response = await c.beta.messages.parse({
    model: env.anthropicModel,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(analystSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `<records>\n${JSON.stringify(records.map(compactRecord))}\n</records>\n\nSuggested intent: ${intentHint}\nAnswer in ${LOCALE_LABEL[locale]}.\n\nQuestion: ${question}`,
      },
    ],
  } as Parameters<typeof c.beta.messages.parse>[0]);
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  const out = response.parsed_output as z.infer<typeof analystSchema>;
  const byId = new Map(records.map((r) => [r.id, r]));
  return {
    engine: "claude",
    intent: out.intent,
    summary: out.summary,
    recommendations: out.recommendations
      .filter((r) => byId.has(r.productId))
      .map((r) => ({ ...r, productName: byId.get(r.productId)!.name, score: byId.get(r.productId)!.score.overall })),
    sections: out.sections,
    sources: out.recommendations.filter((r) => byId.has(r.productId)).map((r) => ({ label: byId.get(r.productId)!.name, href: `/app/products/${r.productId}` })),
    disclaimer: { key: "analyst.disclaimer" },
  };
}

const creativeSchema = z.object({
  hook: z.string(),
  hookType: z.enum(HOOK_TYPES),
  problem: z.string(),
  benefit: z.string(),
  audience: z.string(),
  valueProposition: z.string(),
  cta: z.string(),
  triggers: z.array(z.enum(TRIGGERS)),
  structure: z.enum(STRUCTURES),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  variations: z.array(z.string()),
});

export async function claudeCreative(ad: Advertisement, product: ProductWithMetrics | null, locale: Locale): Promise<CreativeAnalysis | null> {
  const c = anthropic();
  if (!c) return null;
  const response = await c.beta.messages.parse({
    model: env.anthropicModel,
    max_tokens: 6000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: betaZodOutputFormat(creativeSchema) },
    system: `${SYSTEM}
For creative analysis: identify the hook, the problem addressed, the benefit, a target-audience HYPOTHESIS, value proposition, call to action, emotional triggers, persuasive structure, strengths and weaknesses.
Never claim an ad is profitable because it has been observed for a long time. Suggest 5 ORIGINAL creative variations that do not reuse the ad's wording.`,
    messages: [
      {
        role: "user",
        content: `<ad>${JSON.stringify({ advertiser: ad.advertiser, platform: ad.platform, format: ad.format, language: ad.language, headline: ad.headline, copy: ad.copy, cta: ad.cta, firstSeen: ad.firstSeen, lastSeen: ad.lastSeen, dataKind: ad.source.kind })}</ad>
<product>${product ? JSON.stringify(compactRecord(product)) : "null"}</product>
Answer in ${LOCALE_LABEL[locale]}.`,
      },
    ],
  } as Parameters<typeof c.beta.messages.parse>[0]);
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return { engine: "claude", ...(response.parsed_output as z.infer<typeof creativeSchema>), disclaimer: { key: "creative.disclaimer" } };
}
