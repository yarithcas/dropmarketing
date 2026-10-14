import type {
  AdLanguage,
  Advertisement,
  CallToAction,
  Category,
  Country,
  CreativeFormat,
  Platform,
  Product,
  ProductObservation,
  SourceRef,
  Store,
  StoreProduct,
  StoreSnapshot,
  TrendShape,
} from "../types";
import { addDays, daysBetween, isoDate } from "../dates";
import { ARCHETYPES, BRAND_PREFIXES, BRAND_SUFFIXES, type Archetype } from "./catalog";

/**
 * Fixed snapshot date of the demo dataset. Freshness, growth and "new" labels
 * are all computed relative to this date so the demo never pretends to be a
 * live feed.
 */
export const DEMO_SNAPSHOT = "2026-10-12";
export const DEMO_HISTORY_DAYS = 180;

export function demoSource(observedAt: string = DEMO_SNAPSHOT): SourceRef {
  return { connector: "demo", kind: "demo", observedAt: `${observedAt}T06:00:00Z` };
}

/** mulberry32: small deterministic PRNG. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function pickSome<T>(rand: () => number, arr: readonly T[], min: number, max: number): T[] {
  const n = Math.min(arr.length, min + Math.floor(rand() * (max - min + 1)));
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Relative ad-launch intensity over normalized time x in [0, 1] for each trend shape. */
function intensity(shape: TrendShape, x: number): number {
  switch (shape) {
    case "rising":
      return 0.15 + Math.pow(x, 1.6);
    case "emerging":
      return Math.pow(x, 4);
    case "declining":
      return x < 0.35 ? 0.4 + x * 1.7 : Math.max(0.03, Math.pow(1 - (x - 0.35) / 0.65, 2.2));
    case "spike":
      return 0.05 + Math.exp(-Math.pow((x - 0.82) / 0.07, 2));
    default:
      return 1;
  }
}

/** Samples a day offset (0 = oldest day of history) at which an ad starts, following the shape's intensity. */
function startOffset(rand: () => number, shape: TrendShape, firstOffset: number): number {
  const span = DEMO_HISTORY_DAYS - firstOffset;
  // Rejection sampling against the (bounded) intensity curve.
  for (let k = 0; k < 200; k++) {
    const x = rand();
    if (rand() * 1.2 <= intensity(shape, x)) return Math.min(DEMO_HISTORY_DAYS - 1, firstOffset + Math.floor(x * span));
  }
  return DEMO_HISTORY_DAYS - 1;
}

function durationDays(rand: () => number, shape: TrendShape): number {
  const base = shape === "spike" ? 12 : 22;
  return Math.max(3, Math.floor(base * (0.4 + rand() * 1.2)));
}

const CHANNEL_WEIGHTS: Record<Category, Platform[]> = {
  fitness: ["meta", "tiktok", "meta", "pinterest"],
  home: ["meta", "pinterest", "tiktok", "pinterest"],
  kitchen: ["meta", "pinterest", "tiktok"],
  beauty: ["tiktok", "meta", "tiktok", "pinterest"],
  pets: ["meta", "tiktok", "meta"],
  tech: ["meta", "google", "tiktok"],
  outdoor: ["meta", "pinterest", "google"],
  baby: ["meta", "pinterest", "meta"],
  fashion: ["tiktok", "meta", "pinterest", "snapchat"],
  wellness: ["meta", "tiktok", "pinterest"],
  auto: ["meta", "google", "tiktok"],
  office: ["meta", "google", "pinterest"],
};

const COUNTRY_LANG: Record<Country, AdLanguage> = {
  FR: "fr", BE: "fr", US: "en", GB: "en", CA: "en", AU: "en", DE: "de", ES: "es", IT: "it", NL: "en",
};

const CTAS: CallToAction[] = ["shop_now", "shop_now", "learn_more", "get_offer", "order_now", "sign_up"];
const FORMATS: CreativeFormat[] = ["video", "video", "video", "image", "carousel"];

/** Ad copy templates per language. {p} = product, {b} = benefit, {t} = tag. Purely synthetic. */
const COPY: Record<AdLanguage, { hooks: string[]; bodies: string[]; headlines: string[]; benefits: string[] }> = {
  en: {
    hooks: [
      "Still dealing with {t} every single day?",
      "I didn't expect this to change my routine.",
      "Stop scrolling if {t} is on your list this month.",
      "The {t} upgrade nobody told you about.",
      "3 reasons people are switching to the {p}.",
    ],
    bodies: [
      "The {p} is designed to {b}. Simple setup, no subscriptions.",
      "Meet the {p}: built to {b} without the usual hassle.",
      "Small change, big difference. The {p} helps you {b}.",
    ],
    headlines: ["Try the {p}", "Your new {t} essential", "Made to {b}"],
    benefits: ["save time every day", "make your routine easier", "keep things organised", "feel better at home", "get results with less effort"],
  },
  fr: {
    hooks: [
      "Encore galère avec {t} au quotidien ?",
      "Je ne pensais pas que ça changerait ma routine.",
      "Arrêtez de scroller si {t} est sur votre liste ce mois-ci.",
      "L'astuce {t} dont personne ne parle.",
      "3 raisons de passer au {p}.",
    ],
    bodies: [
      "Le {p} est conçu pour {b}. Installation simple, sans abonnement.",
      "Découvrez le {p} : pensé pour {b} sans prise de tête.",
      "Un petit changement, une grande différence. Le {p} vous aide à {b}.",
    ],
    headlines: ["Essayez le {p}", "Votre nouvel essentiel {t}", "Fait pour {b}"],
    benefits: ["gagner du temps chaque jour", "simplifier votre routine", "garder tout organisé", "vous sentir mieux chez vous", "obtenir des résultats sans effort"],
  },
  de: {
    hooks: [
      "Immer noch jeden Tag Ärger mit {t}?",
      "Ich hätte nicht gedacht, dass das meine Routine verändert.",
      "Nicht weiterscrollen, wenn {t} diesen Monat auf deiner Liste steht.",
      "Das {t}-Upgrade, von dem dir niemand erzählt hat.",
    ],
    bodies: [
      "Der {p} hilft dir, {b}. Einfache Einrichtung, kein Abo.",
      "Lerne den {p} kennen: gemacht, um {b}.",
    ],
    headlines: ["Teste den {p}", "Dein neues {t}-Essential"],
    benefits: ["jeden Tag Zeit zu sparen", "deine Routine zu vereinfachen", "Ordnung zu halten"],
  },
  es: {
    hooks: [
      "¿Sigues luchando con {t} cada día?",
      "No esperaba que esto cambiara mi rutina.",
      "Deja de hacer scroll si {t} está en tu lista este mes.",
      "La mejora de {t} que nadie te contó.",
    ],
    bodies: [
      "El {p} está diseñado para {b}. Fácil de usar, sin suscripciones.",
      "Conoce el {p}: pensado para {b} sin complicaciones.",
    ],
    headlines: ["Prueba el {p}", "Tu nuevo esencial de {t}"],
    benefits: ["ahorrar tiempo cada día", "simplificar tu rutina", "mantener todo organizado"],
  },
  it: {
    hooks: [
      "Ancora alle prese con {t} ogni giorno?",
      "Non pensavo che avrebbe cambiato la mia routine.",
      "Fermati se {t} è nella tua lista questo mese.",
      "L'upgrade per {t} di cui nessuno parla.",
    ],
    bodies: [
      "Il {p} è pensato per {b}. Facile da usare, nessun abbonamento.",
      "Scopri il {p}: creato per {b} senza stress.",
    ],
    headlines: ["Prova il {p}", "Il tuo nuovo essenziale per {t}"],
    benefits: ["risparmiare tempo ogni giorno", "semplificare la tua routine", "tenere tutto in ordine"],
  },
};

function fill(tpl: string, p: string, b: string, t: string) {
  return tpl.replaceAll("{p}", p).replaceAll("{b}", b).replaceAll("{t}", t);
}

export interface DemoDataset {
  snapshot: string;
  products: Product[];
  ads: Advertisement[];
  stores: Store[];
  storeProducts: StoreProduct[];
  storeSnapshots: Record<string, StoreSnapshot[]>;
  observations: Record<string, ProductObservation[]>;
}

const STORE_WORDS = ["Lumen", "Habitat", "Kinetic", "Hearth", "Pawsome", "Glow", "Trail", "Nest", "Pulse", "Atelier", "Orbit", "Haven", "Drift", "Bloom", "Forge", "Tidy"];
const STORE_TAILS = ["Market", "House", "Corner", "Lab", "Collective", "Depot", "Studio", "Store"];

export function generateDemoDataset(): DemoDataset {
  const start = addDays(DEMO_SNAPSHOT, -(DEMO_HISTORY_DAYS - 1));
  const products: Product[] = [];
  const ads: Advertisement[] = [];

  // ---- Products & ads
  ARCHETYPES.forEach((a: Archetype, idx: number) => {
    const id = slugify(a.name);
    const rand = prng(hashString(id));
    const firstOffset =
      a.shape === "emerging" ? 120 + Math.floor(rand() * 35) : a.sparse ? 160 + Math.floor(rand() * 10) : Math.floor(rand() * 60);
    const channels = Array.from(new Set(pickSome(rand, CHANNEL_WEIGHTS[a.category], 1, 3)));
    const countries = pickSome(rand, ["FR", "US", "GB", "DE", "ES", "IT", "CA", "BE"] as Country[], 2, 5);

    const productAds: Advertisement[] = [];
    const advertisers = Array.from({ length: Math.max(1, Math.round(a.ads / (1.5 + rand() * 2.5))) }, () =>
      `${pick(rand, BRAND_PREFIXES)} ${pick(rand, BRAND_SUFFIXES)}`,
    );
    const adCount = Math.round(a.ads * (a.sparse ? 1 : 1.8));
    for (let i = 0; i < adCount; i++) {
      const so = startOffset(rand, a.shape, firstOffset);
      const dur = durationDays(rand, a.shape);
      const eo = Math.min(DEMO_HISTORY_DAYS - 1, so + dur);
      const country = pick(rand, countries);
      const language = COUNTRY_LANG[country];
      const tpl = COPY[language];
      const tag = a.tags[Math.floor(rand() * a.tags.length)];
      const benefit = pick(rand, tpl.benefits);
      const advertiser = pick(rand, advertisers);
      const domain = `${slugify(advertiser).replace(/-/g, "")}.example`;
      const hook = fill(pick(rand, tpl.hooks), a.name, benefit, tag);
      productAds.push({
        id: `ad-${id}-${i}`,
        productId: id,
        advertiser,
        platform: pick(rand, channels),
        country,
        language,
        format: pick(rand, FORMATS),
        headline: fill(pick(rand, tpl.headlines), a.name, benefit, tag),
        copy: `${hook} ${fill(pick(rand, tpl.bodies), a.name, benefit, tag)}`,
        cta: pick(rand, CTAS),
        landingDomain: rand() > 0.15 ? domain : null,
        landingUrl: null,
        category: a.category,
        firstSeen: addDays(start, so),
        lastSeen: addDays(start, eo),
        source: demoSource(addDays(start, eo)),
        hue: (idx * 37 + i * 11) % 360,
      });
    }
    for (const ad of productAds) ad.landingUrl = ad.landingDomain ? `https://${ad.landingDomain}/products/${id}` : null;
    ads.push(...productAds);

    const first = productAds.length ? productAds.map((x) => x.firstSeen).sort()[0] : addDays(start, firstOffset);
    const last = productAds.length ? productAds.map((x) => x.lastSeen).sort().at(-1)! : first;
    const shipVerified = rand() > 0.6;
    products.push({
      id,
      name: a.name,
      category: a.category,
      description: a.description,
      productType: a.type ?? "physical",
      tags: a.tags,
      priceEstimate: a.price,
      supplierCostEstimate: a.cost,
      currency: "EUR",
      channels,
      countries,
      shipping: shipVerified
        ? { verified: true, warehouse: pick(rand, ["EU", "EU", "US", "CN"] as const), deliveryDays: [3 + Math.floor(rand() * 3), 7 + Math.floor(rand() * 6)] }
        : { verified: false },
      differentiation: a.differentiation,
      firstDetected: first,
      lastDetected: last,
      source: demoSource(last),
      hue: (idx * 47) % 360,
    });
  });

  // ---- Stores
  const stores: Store[] = [];
  const storeProducts: StoreProduct[] = [];
  const storeSnapshots: Record<string, StoreSnapshot[]> = {};
  const srand = prng(424242);
  const usedNames = new Set<string>();
  for (let i = 0; i < 28; i++) {
    let name = "";
    do name = `${pick(srand, STORE_WORDS)} ${pick(srand, STORE_TAILS)}`;
    while (usedNames.has(name));
    usedNames.add(name);
    const id = slugify(name);
    const categories = pickSome(srand, ["fitness", "home", "kitchen", "beauty", "pets", "tech", "outdoor", "baby", "fashion", "wellness", "auto", "office"] as Category[], 1, 2);
    const country = pick(srand, ["FR", "US", "GB", "DE", "ES", "IT", "BE"] as Country[]);
    const currency = country === "US" ? "USD" : country === "GB" ? "GBP" : "EUR";
    const firstSeen = addDays(start, Math.floor(srand() * 120));
    const isShopify = srand() > 0.25;
    stores.push({
      id,
      name,
      domain: `${id.replace(/-/g, "")}.example`,
      description: `Independent online store focused on ${categories.join(" & ")} products. (Demo profile)`,
      categories,
      currency,
      productCount: null,
      socials: pickSome(srand, ["instagram", "tiktok", "facebook", "pinterest"] as const, 1, 3).map((network) => ({
        network,
        url: `https://${network}.example/${id}`,
      })),
      technology: { platform: isShopify ? "shopify" : srand() > 0.5 ? "woocommerce" : "unknown", verified: isShopify ? srand() > 0.3 : false },
      country,
      firstSeen,
      source: demoSource(),
      hue: (i * 53) % 360,
    });
    // Products carried: mostly from its categories.
    const catalog = products.filter((p) => categories.includes(p.category));
    const carried = pickSome(srand, catalog.length ? catalog : products, 2, Math.min(8, Math.max(2, catalog.length)));
    const fx = currency === "USD" ? 1.08 : currency === "GBP" ? 0.86 : 1;
    for (const p of carried) {
      if (p.priceEstimate == null) continue;
      const added = p.firstDetected > firstSeen ? addDays(p.firstDetected, Math.floor(srand() * 20)) : addDays(firstSeen, Math.floor(srand() * 30));
      storeProducts.push({
        storeId: id,
        productId: p.id,
        title: p.name,
        price: (Math.round(p.priceEstimate * fx * (0.85 + srand() * 0.35)) * 100 - 1) / 100,
        currency,
        firstSeen: added > DEMO_SNAPSHOT ? DEMO_SNAPSHOT : added,
      });
    }
    // A few unmatched listings (not linked to a tracked product)
    const extra = 3 + Math.floor(srand() * 10);
    for (let k = 0; k < extra; k++) {
      storeProducts.push({
        storeId: id,
        productId: null,
        title: `${pick(srand, ["Classic", "Essential", "Premium", "Travel", "Mini"])} ${pick(srand, ["Bundle", "Set", "Kit", "Pack", "Edition"])} ${k + 1}`,
        price: Math.round((9 + srand() * 70) * 100) / 100,
        currency,
        firstSeen: addDays(firstSeen, Math.floor(srand() * Math.max(1, daysBetween(firstSeen, DEMO_SNAPSHOT)))),
      });
    }
    const mine = storeProducts.filter((sp) => sp.storeId === id);
    stores[stores.length - 1].productCount = mine.length;
    // Weekly snapshots of public listing counts
    const snaps: StoreSnapshot[] = [];
    for (let d = firstSeen; d <= DEMO_SNAPSHOT; d = addDays(d, 14)) {
      const visible = mine.filter((sp) => sp.firstSeen <= d);
      if (!visible.length) continue;
      snaps.push({
        date: d,
        productCount: visible.length,
        minPrice: Math.min(...visible.map((v) => v.price)),
        maxPrice: Math.max(...visible.map((v) => v.price)),
        source: demoSource(d),
      });
    }
    storeSnapshots[id] = snaps;
  }

  // Link a fraction of ads to stores' domains so "associated ads" exist.
  const arand = prng(777);
  for (const ad of ads) {
    const carriers = storeProducts.filter((sp) => sp.productId === ad.productId);
    if (carriers.length && arand() > 0.45) {
      const sp = pick(arand, carriers);
      const store = stores.find((s) => s.id === sp.storeId)!;
      ad.advertiser = store.name;
      ad.landingDomain = store.domain;
      ad.landingUrl = `https://${store.domain}/products/${ad.productId}`;
    }
  }

  // ---- Daily observations derived from ads and store listings
  const observations: Record<string, ProductObservation[]> = {};
  for (const p of products) {
    const pAds = ads.filter((a) => a.productId === p.id);
    const pStores = storeProducts.filter((sp) => sp.productId === p.id);
    const rand = prng(hashString(`obs-${p.id}`));
    const seenAdvertisers = new Set<string>();
    const rows: ProductObservation[] = [];
    let noise = 0;
    for (let i = 0; i < DEMO_HISTORY_DAYS; i++) {
      const date = addDays(start, i);
      if (date < p.firstDetected) continue;
      let newAdv = 0;
      for (const a of pAds) {
        if (a.firstSeen === date && !seenAdvertisers.has(a.advertiser)) {
          seenAdvertisers.add(a.advertiser);
          newAdv++;
        }
      }
      const active = pAds.filter((a) => a.firstSeen <= date && a.lastSeen >= date).length;
      noise = noise * 0.8 + (rand() - 0.5) * 6;
      rows.push({
        productId: p.id,
        date,
        adsActive: active,
        newAdvertisers: newAdv,
        storesObserved: pStores.filter((s) => s.firstSeen <= date).length,
        searchInterest: Math.max(0, Math.min(100, Math.round(active * 3.2 + 12 + noise))),
        source: demoSource(date),
      });
    }
    observations[p.id] = rows;
  }

  return { snapshot: DEMO_SNAPSHOT, products, ads, stores, storeProducts, storeSnapshots, observations };
}

let cached: DemoDataset | null = null;
export function getDemoDataset(): DemoDataset {
  if (!cached) cached = generateDemoDataset();
  return cached;
}

export { isoDate };
