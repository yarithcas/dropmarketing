import type { Category } from "../types";

/**
 * Deterministic text heuristics used at ingestion. Their output is always
 * stored as an ESTIMATE (product_match_basis / category_basis = 'estimate'),
 * never as a measured fact:
 *
 * - matchProduct: links an ad to a tracked product when enough of the
 *   product's name tokens appear in the ad text (token overlap).
 * - classifyCategory: keyword vote over a small multilingual lexicon.
 *
 * Both are pure, accent/case-insensitive and return null when the evidence
 * is missing or ambiguous rather than guessing.
 */

export interface MatchableProduct {
  id: string;
  name: string;
  tags: string[];
  category: Category;
}

const STOPWORDS = new Set(
  (
    "the and for with your you our this that from are was now new get all more can will its it's out off how why who what " +
    "les des une pour avec votre vos nos notre sur dans est pas plus qui que son ses aux par mon mes ton tes cette ces tout tous " +
    "los las del con para por una uno tus sus mas este esta como " +
    "der die das und mit fur ein eine einen ihr ihre sie nicht auf von zum zur ist sind dein deine " +
    "gli della delle dei per una uno tuo tua che non piu nel nella sono questo questa " +
    // Marketing qualifiers that say nothing about the product itself.
    "pro max plus ultra premium original edition version set kit pack shop buy offer sale deal free today best"
  ).split(" "),
);

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Light plural folding shared by every language we support: "chargers" ≈ "charger", but "dress" stays. */
const stem = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);

/** Significant tokens: folded, ≥ 3 characters, stop words removed, plurals folded. */
export function tokens(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(stem);
}

/** Minimum share of a product's name tokens that must appear in the ad text. */
export const MATCH_MIN_COVERAGE = 0.6;

/**
 * Links ad text to at most one tracked product. A product qualifies when
 * ≥ 60 % of its name tokens (and at least two, or one plus a tag for
 * single-word names) occur in the text; the best score wins and ties are
 * treated as ambiguous (no link).
 */
export function matchProduct(text: string, products: MatchableProduct[]): { productId: string; score: number } | null {
  const words = new Set(tokens(text));
  if (!words.size) return null;
  let best: { productId: string; score: number } | null = null;
  let tie = false;
  for (const p of products) {
    const name = Array.from(new Set(tokens(p.name)));
    if (!name.length) continue;
    const hits = name.filter((t) => words.has(t)).length;
    const tagHits = Array.from(new Set(tokens(p.tags.join(" ")))).filter((t) => !name.includes(t) && words.has(t)).length;
    const coverage = hits / name.length;
    const enough = name.length === 1 ? hits === 1 && tagHits >= 1 : hits >= 2 && coverage >= MATCH_MIN_COVERAGE;
    if (!enough) continue;
    const score = Math.round((coverage + 0.05 * Math.min(tagHits, 4)) * 1000) / 1000;
    if (!best || score > best.score) {
      best = { productId: p.id, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return tie ? null : best;
}

/** Multilingual (fr, en, es, de, it) keywords per category, written unaccented and singular. */
const CATEGORY_KEYWORDS: Record<Category, string> = {
  fitness:
    "fitness workout gym training entrainement musculation exercise exercice yoga pilates abdo muscle cardio deporte gimnasio entrenamiento ejercicio ubung allenamento palestra esercizio dumbbell haltere kettlebell stretching jogging",
  home: "home house maison decor deco decoration lamp lampe furniture meuble cushion coussin rug tapis curtain rideau sofa canape bedroom chambre hogar casa lampara mueble wohnung zuhause mobel haus arredamento cleaning nettoyage limpieza pulizia storage rangement",
  kitchen:
    "kitchen cuisine cocina cucina kuche cooking recipe recette receta ricetta rezept knife couteau cuchillo coltello messer blender mixeur licuadora frullatore sarten padella pfanne coffee cafe caffe kaffee oven horno forno ofen airfryer fryer friteuse freidora friggitrice utensil ustensile utensilio spatula spatule",
  beauty:
    "beauty beaute belleza bellezza schonheit skin peau piel skincare makeup maquillage maquillaje trucco serum cream creme hair cheveux cabello capelli haare lash cils nail ongle lipstick mascara facial visage viso gesicht wrinkle acne cosmetic cosmetique cosmetico kosmetik",
  pets: "pet dog chien chiot chaton perro gato katze gatto hund kitten puppy cachorro welpe cucciolo leash laisse correa guinzaglio leine litter litiere lettiera veterinaire aquarium hamster croquette kibble pienso crocchette",
  tech: "tech gadget phone smartphone iphone android telephone telefono charger chargeur cargador caricatore ladegerat wireless bluetooth usb cable cavo kabel headphone earbud ecouteur auricular cuffie kopfhorer speaker enceinte altavoz altoparlante lautsprecher laptop ordinateur computer ordenador tablet tablette smartwatch drone webcam battery batterie bateria batteria powerbank projector projecteur proyector proiettore gaming console keyboard clavier teclado tastiera tastatur",
  outdoor:
    "outdoor camping hiking randonnee senderismo escursionismo wandern trekking tent tente zelt garden jardin giardino garten backpack mochila zaino rucksack fishing pesca angeln bbq barbecue grill beach plage playa spiaggia bike velo bicicleta bicicletta fahrrad cycling kayak picnic lantern lanterne linterna",
  baby: "baby bebe bambino neonato infant toddler nourrisson enfant kleinkind stroller poussette cochecito passeggino kinderwagen diaper panal pannolino windel nursery maternite maternity pregnancy grossesse embarazo gravidanza schwangerschaft crib berceau cuna culla pacifier tetine chupete ciuccio schnuller biberon",
  fashion:
    "fashion moda dress vestido vestito kleid shoe chaussure zapato scarpa schuh sneaker jacket veste chaqueta giacca jacke jean shirt chemise camisa camicia hemd handbag bolso borsa tasche jewelry jewellery bijou bijoux joya gioiello schmuck necklace collier bracelet earring sunglasses outfit clothing vetement ropa abbigliamento kleidung",
  wellness:
    "wellness wellbeing bienestar benessere wohlbefinden sleep sommeil sueno sonno schlaf stress relax relaxation detente relajacion rilassamento entspannung massage masaje massaggio posture postura haltung meditation meditacion meditazione aromatherapy aromatherapie diffuser diffuseur difusor diffusore supplement vitamin vitamine vitamina anxiety anxiete ansiedad ansia relief douleur dolor dolore schmerz migraine health sante salud salute gesundheit",
  auto: "car voiture coche auto vehicle vehicule vehiculo veicolo fahrzeug driving dashcam windshield parabrisas parabrezza windschutzscheibe tire tyre pneu neumatico pneumatico reifen motor moteur motore garage parking aparcamiento parcheggio",
  office:
    "office bureau oficina ufficio buro desk escritorio scrivania schreibtisch workspace ergonomic ergonomique ergonomico ergonomisch stationery papeterie papeleria cancelleria notebook carnet cuaderno quaderno notizbuch planner agenda productivity productivite productividad produttivita produktivitat printer imprimante impresora stampante drucker stylo boligrafo penna",
};
const LEXICON = new Map<string, Category[]>();
for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS) as [Category, string][])
  for (const w of words.split(" ")) LEXICON.set(stem(w), [...(LEXICON.get(stem(w)) ?? []), cat]);

/** Category with the most keyword hits; null when nothing matches or two categories tie. */
export function classifyCategory(text: string): Category | null {
  const votes = new Map<Category, number>();
  for (const t of new Set(tokens(text))) for (const c of LEXICON.get(t) ?? []) votes.set(c, (votes.get(c) ?? 0) + 1);
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return null;
  return ranked[0][0];
}
