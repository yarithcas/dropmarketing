# TrendHunter — e-commerce intelligence SaaS

TrendHunter helps dropshippers, Shopify merchants, media buyers and marketers answer five questions:
which products have the most potential, which are gaining traction, which creatives perform, which
competitors to study, and which opportunities to test before saturation.

It combines **product discovery**, **Ad Spy**, a **creative analyzer**, **trend detection**,
**store & competitor intelligence**, an **AI product analyst**, a **profit calculator**,
**collections & watchlists**, **alerts**, **market reports** and **subscriptions** — with a hard rule:
*no fabricated metrics*. Every value is labelled **Measured**, **Estimate**, **AI-generated** or **Demo**,
and carries its source and observation date.

> The original static landing page that lived in this repository is preserved in [`legacy/`](legacy/).

## Quick start (demo mode — no credentials needed)

```bash
npm install
npm run dev            # http://localhost:3000  (French by default; FR / EN / ES / DE / IT)
```

Without environment variables the app runs fully in **demo mode**: a deterministic synthetic dataset
(54 products, ~1,500 ads, 28 stores, 180+ days of observations; all domains end in `.example`) that
regenerates every day — its snapshot is the last complete UTC day and each day appends one day of history
(`DEMO_SNAPSHOT=YYYY-MM-DD` pins it),
a browser-stored workspace seeded with example collections, demo billing and a mock Shopify store.
A banner and badges make the demo status explicit everywhere.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint (next/core-web-vitals + typescript) |
| `npm test` | Vitest unit tests (scoring, profitability, filters, alerts, analyst, i18n parity) |
| `npm run test:e2e` | Playwright end-to-end journeys (starts `next start` on port 3100) |
| `npm run seed:demo` | Loads the demo dataset into Supabase (rows flagged `is_demo`) |

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS with shadcn-style components ·
Recharts · i18next/react-i18next · Supabase (PostgreSQL, Auth, RLS) · Stripe · Anthropic Claude ·
Zod · Vitest · Playwright.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — modules, data flow, scoring, security model
- [Data sources & connectors](docs/DATA_SOURCES.md) — what each connector may collect, limits, retention
- [Production deployment](docs/DEPLOYMENT.md) — **every external credential and service required**
