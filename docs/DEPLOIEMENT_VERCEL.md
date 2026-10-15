# Mettre TrendHunter en ligne sur Vercel — pas à pas

Le projet Vercel **trendhunter** existe déjà sur ton compte (équipe `ycg35`).
Il manque une seule chose : autoriser Vercel à lire le dépôt GitHub
`yarithcas/dropmarketing`. Sans cette autorisation, chaque déploiement échoue
avec l'erreur `git_info_fail`.

---

## Étape 1 — Relier GitHub à Vercel (obligatoire, environ 2 minutes)

1. Ouvre https://vercel.com/ycg35/trendhunter/settings/git et connecte-toi à Vercel.
2. Dans **Connected Git Repository**, clique sur **Connect Git Repository**, puis sur **GitHub**.
3. Une fenêtre GitHub s'ouvre pour installer l'application **Vercel**.
   - Choisis ton compte `yarithcas`.
   - Choisis **Only select repositories**, puis sélectionne `dropmarketing`.
   - Clique sur **Install** (ou **Save**).
4. De retour sur Vercel, sélectionne le dépôt `yarithcas/dropmarketing` pour le relier au projet.
5. Sur la même page, dans **Production Branch**, écris
   `claude/trendhunter-ecommerce-saas-upa037`, puis clique sur **Save**.
   Cette branche contient tout le code ; `main` est presque vide.

Dis-moi ensuite simplement « c'est fait » : je relance le déploiement et je te
donne le lien. Tu peux aussi le faire toi-même : onglet **Deployments**,
bouton **Redeploy** sur le dernier déploiement, ou **Create Deployment** avec
la branche ci-dessus.

Le site sera alors accessible à l'adresse **https://trendhunter-ycg35.vercel.app**.

Aucune variable d'environnement n'est nécessaire pour cette première version.
Le site tourne en **mode démo** : données d'exemple signalées comme telles,
facturation simulée, et Shopify en mode test.

---

## Étape 2 (facultative) — Créer un jeton Vercel

Ce jeton n'est utile que si tu veux qu'une future session Claude déploie avec
l'outil en ligne de commande de Vercel. Cette session utilise déjà la
connexion Vercel de ton compte, donc ce n'est pas nécessaire maintenant.

1. Ouvre https://vercel.com/account/tokens.
2. Clique sur **Create Token**.
   - Nom : `claude-code`
   - Scope : ton équipe `ycg35`
   - Expiration : par exemple 30 jours
3. Clique sur **Create** et copie le jeton (il ne sera plus affiché ensuite).
4. Dans l'application Claude, ouvre le menu de l'environnement cloud en haut de
   la session, puis **Edit**. Ajoute le jeton :
   - dans **Network secrets** (ou **API credentials**) si la section existe,
   - sinon comme variable d'environnement.
   Nom de la variable : `VERCEL_TOKEN`. Valeur : le jeton.
5. Enregistre, puis ouvre une **nouvelle session** : les secrets ne sont pris en
   compte qu'au démarrage d'une session.

⚠️ Ne colle jamais le jeton dans le chat ni dans un fichier du dépôt.

---

## Étape 3 (plus tard) — Passer en mode réel

Pour de vrais comptes, des paiements, l'IA, Shopify et les e-mails, ajoute les
variables listées dans `.env.example`. Le détail est dans `docs/DEPLOYMENT.md`.
Pour chaque variable : Vercel → projet → **Settings** → **Environment Variables**,
puis **Redeploy**.

| Service | Variables principales |
|---|---|
| Supabase (comptes, base de données) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Stripe (paiements) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS` |
| IA (analyste) | `ANTHROPIC_API_KEY` |
| Shopify | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `ENCRYPTION_KEY` |
| E-mails | `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL` |
| Tâches planifiées | `CRON_SECRET` |
| Adresse du site | `NEXT_PUBLIC_APP_URL=https://trendhunter-ycg35.vercel.app` |

Avec Supabase, applique les migrations de `supabase/migrations/` **dans l'ordre**
(0001 → 0006) avant le déploiement.

Le plan gratuit Vercel (Hobby) n'accepte que des tâches planifiées quotidiennes.
`vercel.json` est déjà réglé pour ça : une tâche par jour et une par semaine.
