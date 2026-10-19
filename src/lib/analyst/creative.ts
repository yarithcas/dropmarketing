import type { AdLanguage, Advertisement, CreativeFormat, ProductWithMetrics } from "../types";
import { LANGUAGES } from "../types";
import type { Text } from "./types";

export const HOOK_TYPES = ["question", "problem", "curiosity", "listicle", "personal", "pattern_interrupt", "statement"] as const;
export type HookType = (typeof HOOK_TYPES)[number];
export const TRIGGERS = ["frustration", "curiosity", "convenience", "self_improvement", "fomo", "belonging", "value", "relief"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const STRUCTURES = ["PAS", "AIDA", "BAB", "listicle", "testimonial", "direct"] as const;
export type Structure = (typeof STRUCTURES)[number];

/** A phrase quoted verbatim from the headline or copy, with what it expresses. */
export interface CopyCue {
  kind: "benefit" | "offer" | "ease" | "problem" | "proof";
  quote: string;
}

export interface CreativeAnalysis {
  engine: "claude" | "rules";
  /** True when the record has no ad copy: copy-derived fields then say so instead of being guessed. */
  noCopy?: boolean;
  hook: Text;
  /** Null when not determinable (no copy). */
  hookType: HookType | null;
  problem: Text;
  benefit: Text;
  audience: Text;
  valueProposition: Text;
  /** Rule engine only: the phrases the value proposition was derived from. */
  valueEvidence?: CopyCue[];
  /** Rule engine only: the creative format as recorded by the source, or explicitly unknown. */
  format?: Text;
  cta: Text;
  triggers: Trigger[];
  /** Null when not determinable (no copy). */
  structure: Structure | null;
  strengths: Text[];
  weaknesses: Text[];
  variations: Text[];
  disclaimer: Text;
  notice?: Text;
}

/**
 * Trigger lexicon. Every entry must start at a word boundary, and short words
 * that are also fragments of other words ("now", "ora", "alle") must end at
 * one, so that e.g. "organised" or "ancora" never count as urgency.
 */
const lex = (words: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join("|")})`, "iu");
const END = "(?![\\p{L}])";
const LEX: Record<Trigger, RegExp> = {
  frustration: lex([`still${END}`, "struggl", "galère", `encore${END}`, "sigues", "luchando", `ancora${END}`, "alle prese", "immer noch", "ärger", "hassle", "prise de tête", "complicaciones", "stress"]),
  curiosity: lex(["nobody", `personne${END}`, "nadie", "nessuno", "niemand", "didn't expect", "pensais pas", "esperaba", "pensavo", "gedacht", "secret", "astuce"]),
  convenience: lex([`simple${END}`, "easy", "facile", "fácil", "einfach", "setup", "installation", `sans${END}`, `without${END}`, "no subscription", "sin suscrip", "kein abo", "nessun abbonamento"]),
  self_improvement: lex(["better", `mieux${END}`, "results", "résultats", "resultados", "risultati", "routine", "upgrade", "mejora"]),
  fomo: lex(["this month", "ce mois", "este mes", "questo mese", "diesen monat", "limited", "limité", `now${END}`, "maintenant", `ahora${END}`, `ora${END}`, `jetzt${END}`]),
  belonging: lex(["people are", "switching", "passer au", "everyone", "tout le monde", `todos${END}`, `tutti${END}`, `alle(?!\\s+prese)${END}`]),
  value: lex(["save", "saving", "gagner", "ahorrar", "risparmiare", "sparen", `price${END}`, `prix${END}`, "offer", "offre"]),
  relief: lex(["feel better", "sentir mieux", "sentirte mejor", "stress", `calm${END}`, "relax"]),
};

/** Triggers that express what the buyer gains; used when the copy states no explicit promise. */
const APPEAL_TRIGGERS: readonly Trigger[] = ["convenience", "value", "self_improvement", "relief"];

/*
 * Copy cues per language. Benefit patterns capture the promise that follows a
 * "designed to / helps you" construction; the other kinds match the phrase
 * itself. Every cue is quoted from the ad, so the analysis never states a
 * promise, offer or problem the copy does not contain.
 */
type CueSet = { benefit: string[]; offer: string[]; ease: string[]; problem: string[]; proof: string[]; benefitStop: string };
const CUES: Record<AdLanguage, CueSet> = {
  en: {
    benefit: ["designed to", "built to", "made to", "engineered to", "helps you(?: to)?", "lets you", "so you can", "perfect for", "ideal for"],
    benefitStop: "without|with no|while",
    offer: ["no subscriptions?", "no monthly fees?", "free (?:shipping|delivery|returns)", "\\d+ ?% off", "money-back guarantee", "\\d+-day (?:guarantee|trial)", "risk-free", "buy (?:one|1) get (?:one|1)(?: free)?", "limited-time offer"],
    ease: ["simple setup", "easy setup", "easy to use", "no setup", "without the usual hassle", "hassle-free", "in (?:seconds|minutes)", "no tools needed"],
    problem: ["still (?:dealing|struggling|fighting) with", "tired of", "sick of", "struggling with", "no more"],
    proof: ["reviews?", "rated", "\\d(?:[.,]\\d)? ?(?:stars?|★)", "tested", "certified", "clinically", "customers"],
  },
  fr: {
    benefit: ["conçue? pour", "pensée? pour", "faite? pour", "vous aide à", "permet de", "idéale? pour"],
    benefitStop: "sans|tout en",
    offer: ["sans abonnement", "sans engagement", "livraison (?:gratuite|offerte)", "retours? gratuits?", "- ?\\d+ ?%", "\\d+ ?% de réduction", "satisfait ou remboursé", "garantie \\d+ (?:jours|ans)"],
    ease: ["installation simple", "simple à (?:installer|utiliser)", "facile à (?:installer|utiliser)", "sans prise de tête", "en quelques (?:secondes|minutes)", "sans outils?"],
    problem: ["encore galère", "galère avec", "marre d[eu']", "ras-le-bol", "fini les"],
    proof: ["avis", "clients", "testée?", "certifiée?", "étoiles"],
  },
  de: {
    benefit: ["hilft (?:dir|Ihnen),?", "gemacht,? um", "entwickelt,? um", "damit du", "sorgt dafür,? dass"],
    benefitStop: "ohne",
    offer: ["kein abo", "ohne abo", "kostenlose[rn]? (?:versand|rücksendung)", "gratis versand", "\\d+ ?% rabatt", "geld-zurück-garantie"],
    ease: ["einfache einrichtung", "einfach zu (?:bedienen|installieren)", "ohne aufwand", "in (?:sekunden|minuten)", "ohne werkzeug"],
    problem: ["immer noch", "ärger mit", "genervt von", "schluss mit"],
    proof: ["bewertungen", "kunden", "getestet", "zertifiziert", "sterne"],
  },
  es: {
    benefit: ["diseñad[oa] para", "pensad[oa] para", "hech[oa] para", "cread[oa] para", "te ayuda a", "ideal para"],
    benefitStop: "sin",
    offer: ["sin suscripci(?:ón|ones)", "sin permanencia", "envío (?:gratis|gratuito)", "devoluciones gratis", "\\d+ ?% de descuento", "garantía de devolución"],
    ease: ["fácil de (?:usar|instalar)", "sin complicaciones", "en (?:segundos|minutos)"],
    problem: ["sigues luchando", "luchando con", "cansad[oa] de", "basta de"],
    proof: ["reseñas", "opiniones", "clientes", "probad[oa]", "certificad[oa]", "estrellas"],
  },
  it: {
    benefit: ["pensat[oa] per", "creat[oa] per", "progettat[oa] per", "fatt[oa] per", "ti aiuta a", "ideale per"],
    benefitStop: "senza",
    offer: ["nessun abbonamento", "senza abbonamento", "spedizione gratuita", "reso gratuito", "\\d+ ?% di sconto", "soddisfatti o rimborsati"],
    ease: ["facile da (?:usare|installare)", "senza stress", "in pochi (?:secondi|minuti)"],
    problem: ["ancora alle prese", "alle prese con", "stanc[oa] di", "basta con"],
    proof: ["recensioni", "clienti", "testat[oa]", "certificat[oa]", "stelle"],
  },
};

const NOT_LETTER = "(?:^|[^\\p{L}\\p{N}])";
const MAX_QUOTE = 90;

function clean(s: string) {
  const t = s.replace(/\s+/g, " ").replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, "").trim();
  return t.length > MAX_QUOTE ? `${t.slice(0, MAX_QUOTE - 1).trimEnd()}…` : t;
}

function sentences(text: string): string[] {
  return text
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Extracts benefit, offer, ease, problem and proof cues from the headline and
 * copy with fixed patterns: the ad's language first, then the other supported
 * languages (feeds sometimes mislabel the language). Quotes are verbatim.
 */
export function extractCopyCues(ad: Pick<Advertisement, "headline" | "copy" | "language">): CopyCue[] {
  const text = [ad.headline, ad.copy].filter(Boolean).join("\n");
  const langs = [ad.language, ...LANGUAGES.filter((l) => l !== ad.language)].filter((l): l is AdLanguage => l != null && l in CUES);
  const out: CopyCue[] = [];
  const seen = new Set<string>();
  const push = (kind: CopyCue["kind"], quote: string) => {
    const q = clean(quote);
    const k = `${kind}:${q.toLowerCase()}`;
    if (q.length < 3 || seen.has(k)) return;
    seen.add(k);
    out.push({ kind, quote: q });
  };
  for (const lang of langs) {
    const c = CUES[lang];
    const benefit = new RegExp(`${NOT_LETTER}(?:${c.benefit.join("|")})\\s+([^.!?:;\\n]+?)(?=\\s+(?:${c.benefitStop})(?![\\p{L}])|[.!?:;\\n]|$)`, "giu");
    for (const m of text.matchAll(benefit)) push("benefit", m[1]);
    for (const kind of ["offer", "ease", "proof"] as const) {
      const re = new RegExp(`${NOT_LETTER}((?:${c[kind].join("|")}))(?![\\p{L}])`, "giu");
      for (const m of text.matchAll(re)) push(kind, m[1]);
    }
    // A problem cue is quoted with its whole sentence, which carries the problem itself.
    const problem = new RegExp(`${NOT_LETTER}(?:${c.problem.join("|")})(?![\\p{L}])`, "iu");
    for (const s of sentences(text)) if (problem.test(s)) push("problem", s);
  }
  return out;
}

const quoteList = (cues: CopyCue[]) => cues.map((c) => `“${c.quote}”`).join(", ");

/**
 * Value proposition derived only from the copy's own cues (quoted), then from
 * the detected appeal triggers; "not determinable" when the copy states none.
 */
export function valuePropositionFrom(cues: CopyCue[], triggers: Trigger[] = []): Text {
  const promise = cues.find((c) => c.kind === "benefit");
  const terms = cues.filter((c) => c.kind === "offer" || c.kind === "ease").slice(0, 3);
  const problem = cues.find((c) => c.kind === "problem");
  const appeals = triggers.filter((tr) => APPEAL_TRIGGERS.includes(tr));
  if (promise && terms.length) return { key: "creative.value.promiseWithTerms", params: { promise: promise.quote, terms: quoteList(terms) } };
  if (promise) return { key: "creative.value.promise", params: { promise: promise.quote } };
  if (terms.length) return { key: "creative.value.termsOnly", params: { terms: quoteList(terms) } };
  if (problem) return { key: "creative.value.problemOnly", params: { problem: problem.quote } };
  if (appeals.length) return { key: "creative.value.appealsOnly", params: { triggers: appeals.join(", ") } };
  return { key: "creative.value.notDeterminable" };
}

/** Triggers detected in the headline and copy (word-bounded lexicon, all supported languages). */
export function detectTriggers(text: string): Trigger[] {
  return TRIGGERS.filter((k) => LEX[k].test(text));
}

const KNOWN_FORMATS: readonly string[] = ["video", "image", "carousel"] satisfies CreativeFormat[];
/**
 * Connectors whose API does not expose the creative format: the stored value is
 * a placeholder, not an observation (see lib/connectors/registry.ts).
 */
const FORMAT_NOT_EXPOSED = new Set(["meta_ad_library"]);

/** The creative format as recorded by the source, or null when the source does not provide it. */
export function recordedFormat(ad: Pick<Advertisement, "format" | "source">): CreativeFormat | null {
  const f = ad.format as string | null | undefined;
  if (!f || !KNOWN_FORMATS.includes(f) || FORMAT_NOT_EXPOSED.has(ad.source?.connector)) return null;
  return f as CreativeFormat;
}

export function formatInfo(ad: Pick<Advertisement, "format" | "source">): Text {
  const f = recordedFormat(ad);
  return f ? { key: "creative.formatInfo.recorded", params: { format: f } } : { key: "creative.formatInfo.unknown" };
}

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
  const copy = (ad.copy ?? "").trim();
  // Category may be unknown for live ads; fall back to what the ad itself names.
  const tag = product?.tags[0] ?? ad.category ?? (ad.headline || ad.advertiser);
  const name = product?.name ?? (ad.headline || ad.advertiser);
  const format = recordedFormat(ad);
  const variations: Text[] = [
      { key: "creative.variations.ugcProblem", params: { tag } },
      { key: "creative.variations.splitScreen", params: { tag } },
      { key: "creative.variations.myth", params: { tag } },
      { key: "creative.variations.threeUses", params: { name } },
      { key: "creative.variations.founder", params: { tag } },
  ];
  const common = {
    engine: "rules" as const,
    audience: { key: "creative.audience.hypothesis", params: { tag, country: ad.country } },
    format: formatInfo(ad),
    cta: { key: `creative.cta.${ad.cta}` },
    variations,
    disclaimer: { key: "creative.disclaimer" },
    notice: { key: "analyst.rulesNotice" },
  };
  // Record facts that do not depend on the copy.
  const recordWeaknesses: Text[] = [];
  if (ad.cta === "learn_more") recordWeaknesses.push({ key: "creative.weaknesses.softCta" });
  if (!ad.landingDomain) recordWeaknesses.push({ key: "creative.weaknesses.noLanding" });

  if (!copy) {
    // Nothing to analyse: say so instead of guessing a hook, a structure or a promise.
    const headlineCues = extractCopyCues({ headline: ad.headline, copy: "", language: ad.language });
    const fromHeadline = headlineCues.length ? valuePropositionFrom(headlineCues, detectTriggers(ad.headline ?? "")) : null;
    const noCopy: Text = { key: "creative.noCopy.field" };
    return {
      ...common,
      noCopy: true,
      hook: { key: "creative.noCopy.hook" },
      hookType: null,
      problem: noCopy,
      benefit: noCopy,
      // A promise stated in the headline is still quoted (the evidence chips show where it comes from).
      valueProposition: fromHeadline ?? noCopy,
      valueEvidence: headlineCues.filter((c) => c.kind !== "proof"),
      triggers: [],
      structure: null,
      strengths: [],
      weaknesses: recordWeaknesses,
    };
  }

  const text = [ad.headline, copy].filter(Boolean).join("\n");
  const hook = firstSentence(copy);
  const hookType = classifyHook(hook);
  const triggers = detectTriggers(text);
  const cues = extractCopyCues(ad);
  const of = (kind: CopyCue["kind"]) => cues.filter((c) => c.kind === kind);
  const problemCue = of("problem")[0];
  const benefitCue = of("benefit")[0] ?? of("ease")[0];
  const hasProblem = Boolean(problemCue) || hookType === "problem";
  const hasBenefit = Boolean(benefitCue) || triggers.some((tr) => APPEAL_TRIGGERS.includes(tr));
  const structure: Structure =
    hookType === "listicle" ? "listicle" : hookType === "personal" ? "testimonial" : hasProblem && hasBenefit ? "PAS" : hookType === "curiosity" || hookType === "question" ? "AIDA" : "direct";

  const strengths: Text[] = [];
  const weaknesses: Text[] = [];
  if (hook.length <= 70) strengths.push({ key: "creative.strengths.shortHook" });
  else weaknesses.push({ key: "creative.weaknesses.longHook" });
  if (hasProblem) strengths.push({ key: "creative.strengths.problemFirst" });
  if (of("offer").length || of("ease").length) strengths.push({ key: "creative.strengths.objection" });
  if (format === "video") strengths.push({ key: "creative.strengths.videoDemo" });
  if (!/\d/.test(copy)) weaknesses.push({ key: "creative.weaknesses.noSpecifics" });
  if (!triggers.includes("fomo")) weaknesses.push({ key: "creative.weaknesses.noUrgency" });
  weaknesses.push(...recordWeaknesses);
  if (!of("proof").length) weaknesses.push({ key: "creative.weaknesses.genericClaims" });

  return {
    ...common,
    hook,
    hookType,
    problem: problemCue ? { key: "creative.problem.quoted", params: { quote: problemCue.quote } } : { key: "creative.problem.notStated" },
    benefit: benefitCue ? { key: "creative.benefit.quoted", params: { quote: benefitCue.quote } } : { key: "creative.benefit.unclear" },
    valueProposition: valuePropositionFrom(cues, triggers),
    valueEvidence: cues.filter((c) => c.kind !== "proof"),
    triggers,
    structure,
    strengths,
    weaknesses,
  };
}
