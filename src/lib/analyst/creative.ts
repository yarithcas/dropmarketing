import type { Advertisement, ProductWithMetrics } from "../types";
import type { Text } from "./types";

export const HOOK_TYPES = ["question", "problem", "curiosity", "listicle", "personal", "pattern_interrupt", "statement"] as const;
export type HookType = (typeof HOOK_TYPES)[number];
export const TRIGGERS = ["frustration", "curiosity", "convenience", "self_improvement", "fomo", "belonging", "value", "relief"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const STRUCTURES = ["PAS", "AIDA", "BAB", "listicle", "testimonial", "direct"] as const;
export type Structure = (typeof STRUCTURES)[number];

export interface CreativeAnalysis {
  engine: "claude" | "rules";
  hook: Text;
  hookType: HookType;
  problem: Text;
  benefit: Text;
  audience: Text;
  valueProposition: Text;
  cta: Text;
  triggers: Trigger[];
  structure: Structure;
  strengths: Text[];
  weaknesses: Text[];
  variations: Text[];
  disclaimer: Text;
  notice?: Text;
}

const LEX: Record<Trigger, RegExp> = {
  frustration: /(still|struggl|galère|encore|sigues|luchando|ancora|alle prese|immer noch|ärger|hassle|prise de tête|complicaciones|stress)/i,
  curiosity: /(nobody|personne|nadie|nessuno|niemand|didn't expect|pensais pas|esperaba|pensavo|gedacht|secret|astuce)/i,
  convenience: /(simple|easy|facile|fácil|einfach|setup|installation|sans|without|no subscription|sin suscrip|kein abo|nessun abbonamento)/i,
  self_improvement: /(better|mieux|results|résultats|resultados|risultati|routine|upgrade|mejora)/i,
  fomo: /(this month|ce mois|este mes|questo mese|diesen monat|limited|limité|now|maintenant|ahora|ora|jetzt)/i,
  belonging: /(people are|switching|passer au|everyone|tout le monde|todos|tutti|alle)/i,
  value: /(save|gagner|ahorrar|risparmiare|sparen|price|prix|offer|offre)/i,
  relief: /(feel better|sentir mieux|sentirte mejor|stress|calm|relax)/i,
};

function firstSentence(copy: string) {
  const m = copy.match(/^(.+?[.?!])(\s|$)/);
  return (m ? m[1] : copy).trim();
}

export function classifyHook(hook: string): HookType {
  const h = hook.toLowerCase();
  if (/^\d/.test(h)) return "listicle";
  if (/^(stop|arrêtez|deja de|fermati|nicht weiter)/i.test(h)) return "pattern_interrupt";
  if (/(nobody|personne|nadie|nessuno|niemand)/i.test(h)) return "curiosity";
  if (/^(i |je |yo |ich |non pensavo|no esperaba)/i.test(h)) return "personal";
  if (/\?$/.test(h)) return /(still|encore|sigues|ancora|immer noch)/i.test(h) ? "problem" : "question";
  return "statement";
}

export function rulesCreativeAnalysis(ad: Advertisement, product: ProductWithMetrics | null): CreativeAnalysis {
  const hook = firstSentence(ad.copy);
  const hookType = classifyHook(hook);
  const triggers = (Object.keys(LEX) as Trigger[]).filter((k) => LEX[k].test(ad.copy));
  const hasProblem = triggers.includes("frustration") || hookType === "problem";
  const hasBenefit = triggers.includes("convenience") || triggers.includes("self_improvement") || triggers.includes("value");
  const structure: CreativeAnalysis["structure"] =
    hookType === "listicle" ? "listicle" : hookType === "personal" ? "testimonial" : hasProblem && hasBenefit ? "PAS" : hookType === "curiosity" || hookType === "question" ? "AIDA" : "direct";
  const tag = product?.tags[0] ?? ad.category;
  const name = product?.name ?? ad.headline;

  const strengths: Text[] = [];
  const weaknesses: Text[] = [];
  if (hook.length <= 70) strengths.push({ key: "creative.strengths.shortHook" });
  else weaknesses.push({ key: "creative.weaknesses.longHook" });
  if (hasProblem) strengths.push({ key: "creative.strengths.problemFirst" });
  if (triggers.includes("convenience")) strengths.push({ key: "creative.strengths.objection" });
  if (ad.format === "video") strengths.push({ key: "creative.strengths.videoDemo" });
  if (!/\d/.test(ad.copy)) weaknesses.push({ key: "creative.weaknesses.noSpecifics" });
  if (!triggers.includes("fomo")) weaknesses.push({ key: "creative.weaknesses.noUrgency" });
  if (ad.cta === "learn_more") weaknesses.push({ key: "creative.weaknesses.softCta" });
  if (!ad.landingDomain) weaknesses.push({ key: "creative.weaknesses.noLanding" });
  weaknesses.push({ key: "creative.weaknesses.genericClaims" });

  return {
    engine: "rules",
    hook: hook,
    hookType,
    problem: hasProblem ? { key: "creative.problem.detected", params: { tag } } : { key: "creative.problem.implicit", params: { tag } },
    benefit: hasBenefit ? { key: "creative.benefit.detected" } : { key: "creative.benefit.unclear" },
    audience: { key: "creative.audience.hypothesis", params: { tag, country: ad.country } },
    valueProposition: { key: "creative.value.summary", params: { name } },
    cta: { key: `creative.cta.${ad.cta}` },
    triggers,
    structure,
    strengths,
    weaknesses,
    variations: [
      { key: "creative.variations.ugcProblem", params: { tag } },
      { key: "creative.variations.splitScreen", params: { tag } },
      { key: "creative.variations.myth", params: { tag } },
      { key: "creative.variations.threeUses", params: { name } },
      { key: "creative.variations.founder", params: { tag } },
    ],
    disclaimer: { key: "creative.disclaimer" },
    notice: { key: "analyst.rulesNotice" },
  };
}
