import type { Category, ProductType, TrendShape } from "../types";

/**
 * Curated archetypes for the DEMO dataset. These are generic product concepts,
 * not real listings. All numbers derived from them are synthetic and labelled
 * as demo data throughout the interface.
 */
export interface Archetype {
  name: string;
  category: Category;
  price: number | null;
  cost: number | null;
  tags: string[];
  shape: TrendShape;
  type?: ProductType;
  differentiation: number | null;
  description: string;
  /** Approximate number of demo ads to generate. */
  ads: number;
  /** Mark as thin-evidence to exercise the "Insufficient data" path. */
  sparse?: boolean;
}

export const ARCHETYPES: Archetype[] = [
  { name: "Posture Corrector Pro Brace", category: "wellness", price: 34.9, cost: 6.2, tags: ["posture", "office", "back pain"], shape: "stable", differentiation: 35, ads: 26, description: "Adjustable upper-back brace with breathable mesh, marketed to remote workers." },
  { name: "Smart Jump Rope with Counter", category: "fitness", price: 29.9, cost: 7.1, tags: ["cardio", "home workout", "smart"], shape: "rising", differentiation: 55, ads: 22, description: "Cordless-capable jump rope with LCD counter for calories and jumps." },
  { name: "Adjustable Ankle Weights (Pair)", category: "fitness", price: 24.9, cost: 5.4, tags: ["pilates", "strength"], shape: "emerging", differentiation: 40, ads: 14, description: "Soft silicone ankle weights popular in at-home pilates routines." },
  { name: "Wall Pilates Bar Kit", category: "fitness", price: 59.0, cost: 16.5, tags: ["pilates", "home workout", "kit"], shape: "emerging", differentiation: 70, ads: 12, description: "Door-mounted bar with resistance bands for wall pilates programs." },
  { name: "Massage Gun Mini", category: "fitness", price: 49.9, cost: 18.0, tags: ["recovery", "massage"], shape: "declining", differentiation: 20, ads: 30, description: "Pocket-sized percussion massager with four heads." },
  { name: "Weighted Hula Hoop (Smart)", category: "fitness", price: 32.0, cost: 8.9, tags: ["cardio", "core"], shape: "spike", differentiation: 45, ads: 18, description: "Segmented hoop with a rotating weighted ball; detachable links." },
  { name: "Grip Strength Trainer Set", category: "fitness", price: 19.9, cost: 3.1, tags: ["strength", "climbing"], shape: "stable", differentiation: 25, ads: 9, description: "Set of adjustable hand grippers and finger stretchers." },

  { name: "Sunset Projection Lamp", category: "home", price: 27.9, cost: 5.0, tags: ["ambience", "decor", "lighting"], shape: "declining", differentiation: 15, ads: 28, description: "USB lamp projecting a sunset halo; popular for content creation." },
  { name: "Cordless Motion-Sensor Cabinet Lights", category: "home", price: 36.0, cost: 8.2, tags: ["lighting", "rechargeable"], shape: "rising", differentiation: 50, ads: 20, description: "Magnetic rechargeable LED strips for wardrobes and kitchen cabinets." },
  { name: "Self-Cleaning Lint Roller Station", category: "home", price: 22.0, cost: 3.6, tags: ["cleaning", "pets"], shape: "emerging", differentiation: 60, ads: 11, description: "Reusable lint brush with a cleaning dock." },
  { name: "Silent Mini Dehumidifier", category: "home", price: 69.0, cost: 24.0, tags: ["air quality", "bedroom"], shape: "spike", differentiation: 45, ads: 15, description: "Compact Peltier dehumidifier for small rooms and closets." },
  { name: "Modular Shoe Rack Cubes", category: "home", price: 45.0, cost: 14.0, tags: ["storage", "organization"], shape: "stable", differentiation: 30, ads: 8, description: "Stackable clear shoe boxes with magnetic doors." },
  { name: "Floating Plant Shelf Set", category: "home", price: 39.0, cost: 9.5, tags: ["decor", "plants"], shape: "stable", differentiation: 35, ads: 6, description: "Wall-mounted shelf set with hidden brackets." },

  { name: "Electric Spice Grinder (USB-C)", category: "kitchen", price: 34.0, cost: 8.0, tags: ["cooking", "rechargeable"], shape: "rising", differentiation: 45, ads: 17, description: "One-hand rechargeable grinder with adjustable coarseness." },
  { name: "Vacuum Sealer Handheld", category: "kitchen", price: 39.9, cost: 9.8, tags: ["food storage", "meal prep"], shape: "stable", differentiation: 35, ads: 13, description: "Handheld vacuum pump with reusable zip bags." },
  { name: "Mini Waffle Maker Duo", category: "kitchen", price: 29.0, cost: 9.0, tags: ["breakfast", "gift"], shape: "declining", differentiation: 20, ads: 10, description: "Two-plate compact waffle maker with non-stick coating." },
  { name: "Portable Blender Bottle 2.0", category: "kitchen", price: 44.0, cost: 12.0, tags: ["smoothie", "fitness", "rechargeable"], shape: "declining", differentiation: 25, ads: 33, description: "USB-rechargeable blender bottle with travel lid." },
  { name: "Herb Keeper Fresh Pod", category: "kitchen", price: 24.0, cost: 4.4, tags: ["food storage", "zero waste"], shape: "emerging", differentiation: 65, ads: 7, description: "Clear herb storage container with water reservoir." },
  { name: "Oil Sprayer Glass Mister", category: "kitchen", price: 16.9, cost: 2.6, tags: ["air fryer", "healthy cooking"], shape: "rising", differentiation: 30, ads: 21, description: "Refillable glass oil mister sized for air-fryer cooking." },

  { name: "Ice Roller Face Massager", category: "beauty", price: 19.9, cost: 2.9, tags: ["skincare", "depuffing"], shape: "stable", differentiation: 20, ads: 24, description: "Stainless ice roller for morning depuffing routines." },
  { name: "Red Light Therapy Wand", category: "beauty", price: 79.0, cost: 21.0, tags: ["skincare", "device"], shape: "rising", differentiation: 55, ads: 25, description: "Handheld LED wand combining red light, warmth and vibration." },
  { name: "Heatless Curling Ribbon", category: "beauty", price: 17.9, cost: 1.9, tags: ["hair", "overnight"], shape: "declining", differentiation: 15, ads: 29, description: "Satin rod for overnight heatless curls." },
  { name: "Scalp Massager Shampoo Brush", category: "beauty", price: 14.9, cost: 1.6, tags: ["hair", "self-care"], shape: "stable", differentiation: 15, ads: 12, description: "Soft silicone brush for scalp care in the shower." },
  { name: "Lash Lift DIY Kit", category: "beauty", price: 39.0, cost: 7.5, tags: ["lashes", "at home"], shape: "emerging", differentiation: 50, ads: 9, description: "At-home lash lift kit with step-by-step program." },
  { name: "Nail Art Stamping Pen Set", category: "beauty", price: 21.0, cost: 3.9, tags: ["nails"], shape: "stable", differentiation: null, ads: 2, description: "Stamping plates and pens for quick nail designs.", sparse: true },

  { name: "Interactive Cat Feather Toy", category: "pets", price: 24.9, cost: 4.5, tags: ["cats", "toy", "automatic"], shape: "rising", differentiation: 45, ads: 23, description: "Auto-rotating feather toy with random motion modes." },
  { name: "Dog Paw Cleaner Cup", category: "pets", price: 19.9, cost: 3.2, tags: ["dogs", "cleaning"], shape: "stable", differentiation: 25, ads: 15, description: "Silicone-bristle cup that cleans muddy paws." },
  { name: "Lick Mat Slow Feeder", category: "pets", price: 15.9, cost: 1.8, tags: ["dogs", "anxiety", "feeding"], shape: "emerging", differentiation: 40, ads: 10, description: "Suction lick mat designed to slow eating and calm pets." },
  { name: "Pet Hair Remover Roller", category: "pets", price: 18.9, cost: 2.7, tags: ["cleaning", "reusable"], shape: "declining", differentiation: 15, ads: 27, description: "Reusable roller that traps pet hair from furniture." },
  { name: "GPS Pet Tag Lite", category: "pets", price: 49.0, cost: 19.0, tags: ["tracking", "dogs"], shape: "rising", differentiation: 60, ads: 12, description: "Lightweight Bluetooth/GPS tag clip for collars." },

  { name: "Magnetic Phone Mount for Car Vents", category: "auto", price: 22.9, cost: 3.9, tags: ["car", "magnetic"], shape: "stable", differentiation: 15, ads: 19, description: "Vent-clip magnetic phone mount with rotation." },
  { name: "Car Seat Gap Organizer", category: "auto", price: 19.0, cost: 3.0, tags: ["car", "organization"], shape: "stable", differentiation: 25, ads: 8, description: "Leather-look filler pockets for seat gaps." },
  { name: "Portable Tire Inflator Cordless", category: "auto", price: 59.0, cost: 19.5, tags: ["car", "emergency", "rechargeable"], shape: "rising", differentiation: 40, ads: 18, description: "Digital cordless inflator with auto shut-off." },

  { name: "Magnetic Wireless Power Bank", category: "tech", price: 39.0, cost: 11.0, tags: ["charging", "magnetic"], shape: "stable", differentiation: 20, ads: 31, description: "Slim magnetic power bank with kickstand." },
  { name: "Mini Thermal Label Printer", category: "tech", price: 49.0, cost: 15.0, tags: ["organization", "small business"], shape: "rising", differentiation: 50, ads: 16, description: "Bluetooth label printer for home and small-business labelling." },
  { name: "Open-Ear Sport Earbuds", category: "tech", price: 69.0, cost: 22.0, tags: ["audio", "running"], shape: "emerging", differentiation: 45, ads: 14, description: "Ear-hook open-ear earbuds for runners." },
  { name: "Ring Light Clip for Phone", category: "tech", price: 15.9, cost: 2.2, tags: ["content creation", "lighting"], shape: "declining", differentiation: 10, ads: 20, description: "Rechargeable clip-on light with three color temperatures." },
  { name: "Smart Plant Sensor", category: "tech", price: 29.0, cost: null, tags: ["plants", "smart home"], shape: "emerging", differentiation: 55, ads: 3, description: "Soil moisture and light sensor with app alerts.", sparse: true },

  { name: "Collapsible Camping Kettle", category: "outdoor", price: 27.0, cost: 6.5, tags: ["camping", "silicone"], shape: "spike", differentiation: 40, ads: 11, description: "Silicone collapsible kettle for camping stoves." },
  { name: "Solar Lantern Inflatable", category: "outdoor", price: 24.0, cost: 4.9, tags: ["camping", "solar"], shape: "stable", differentiation: 35, ads: 9, description: "Packable solar lantern with USB charging." },
  { name: "Cooling Neck Fan Bladeless", category: "outdoor", price: 34.9, cost: 9.4, tags: ["summer", "portable"], shape: "spike", differentiation: 30, ads: 24, description: "Wearable bladeless neck fan with three speeds." },

  { name: "Baby Sleep Sound Machine", category: "baby", price: 39.0, cost: 10.0, tags: ["sleep", "white noise"], shape: "stable", differentiation: 30, ads: 13, description: "Portable white-noise machine with night light." },
  { name: "Silicone Suction Plate Set", category: "baby", price: 26.0, cost: 5.0, tags: ["feeding", "toddler"], shape: "rising", differentiation: 35, ads: 12, description: "Divided suction plate, bowl and spoon set." },
  { name: "Montessori Busy Board", category: "baby", price: 44.0, cost: 12.5, tags: ["learning", "toy"], shape: "emerging", differentiation: 60, ads: 10, description: "Wooden activity board with latches and switches." },

  { name: "Seamless Shapewear Shorts", category: "fashion", price: 32.0, cost: 6.0, tags: ["shapewear", "comfort"], shape: "stable", differentiation: 25, ads: 22, description: "High-waist seamless shorts with anti-chafe design." },
  { name: "Minimalist Card Wallet RFID", category: "fashion", price: 29.0, cost: 4.8, tags: ["wallet", "rfid", "gift"], shape: "declining", differentiation: 20, ads: 17, description: "Aluminium card holder with pop-up mechanism." },
  { name: "Waterproof Crossbody Phone Bag", category: "fashion", price: 27.0, cost: 5.5, tags: ["bags", "travel"], shape: "rising", differentiation: 40, ads: 15, description: "Compact crossbody bag with touch-screen window." },

  { name: "Acupressure Mat & Pillow Set", category: "wellness", price: 44.0, cost: 9.0, tags: ["relaxation", "sleep"], shape: "stable", differentiation: 30, ads: 16, description: "Coconut-fiber acupressure mat with matching pillow." },
  { name: "Mouth Tape for Sleep (30 pack)", category: "wellness", price: 19.0, cost: 2.0, tags: ["sleep", "breathing"], shape: "emerging", differentiation: 35, ads: 13, description: "Hypoallergenic sleep tape strips.", },
  { name: "Weighted Sleep Mask", category: "wellness", price: 29.0, cost: 5.8, tags: ["sleep", "relaxation"], shape: "rising", differentiation: 45, ads: 12, description: "Contoured blackout mask with weighted beads." },

  { name: "Under-Desk Walking Pad", category: "office", price: 249.0, cost: 118.0, tags: ["remote work", "fitness"], shape: "stable", differentiation: 35, ads: 21, description: "Foldable walking pad for standing desks." },
  { name: "Ergonomic Footrest Rocker", category: "office", price: 39.0, cost: 9.0, tags: ["ergonomics", "remote work"], shape: "emerging", differentiation: 45, ads: 8, description: "Rocking under-desk footrest with massage nubs." },
  { name: "Cable Management Box Bamboo", category: "office", price: 29.0, cost: 7.0, tags: ["organization", "desk setup"], shape: "stable", differentiation: 25, ads: 7, description: "Bamboo lid cable box for power strips." },
  { name: "Focus Timer Cube", category: "office", price: 24.0, cost: null, tags: ["productivity"], shape: "emerging", differentiation: null, ads: 1, description: "Flip-to-start pomodoro timer cube.", sparse: true },
];

/** Fictional advertiser name parts (deliberately generic; not real brands). */
export const BRAND_PREFIXES = ["Nova", "Lumi", "Kairo", "Velo", "Mira", "Oki", "Zena", "Brio", "Taro", "Elva", "Pura", "Sola", "Rumi", "Vita", "Arlo", "Nimbo", "Fjor", "Kesi"];
export const BRAND_SUFFIXES = ["Labs", "Home", "Co", "Studio", "Goods", "Supply", "Wellness", "Living", "Gear", "Shop", "Club", "Hub"];
