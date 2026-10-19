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

Le site est accessible à l'adresse **https://trendhunter-one.vercel.app**.

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
| Adresse du site | `NEXT_PUBLIC_APP_URL=https://trendhunter-one.vercel.app` |

Avec Supabase, applique les migrations de `supabase/migrations/` **dans l'ordre**
(0001, 0002, … jusqu'au dernier numéro) avant le déploiement.

Le plan gratuit Vercel (Hobby) n'accepte que des tâches planifiées quotidiennes.
`vercel.json` est déjà réglé pour ça : une tâche par jour et une par semaine.

---

## Activer les vraies publicités (Meta) — pas à pas

En mode démo, les annonceurs, leurs pubs et leurs sites sont inventés. Pour voir
les vraies pubs des concurrents (Facebook et Instagram), il faut trois choses :
une base Supabase, une clé de la bibliothèque publicitaire Meta et quelques
variables dans Vercel. Ne colle jamais une clé dans un chat ou un e-mail.

### A. La base de données (Supabase, gratuit pour démarrer)

1. Crée un compte sur https://supabase.com, puis **New project**. Choisis une
   région en Europe et note le mot de passe de la base.
2. Dans le projet : **SQL Editor** → **New query**. Copie le contenu de
   `supabase/migrations/0001_init.sql` (sur GitHub, bouton « Copy raw file »),
   colle-le, puis **Run**. Recommence avec chaque fichier du dossier
   `supabase/migrations/`, **dans l'ordre**, jusqu'à `0008_active_advertisers.sql`.
3. **Project Settings** → **API** (ou **API Keys**) : note
   - l'URL du projet → `NEXT_PUBLIC_SUPABASE_URL`
   - la clé `anon` (ou `publishable`) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - la clé `service_role` (ou `secret`) → `SUPABASE_SERVICE_ROLE_KEY`. Elle est
     secrète : elle ne va que dans Vercel.
4. **Authentication** → **URL Configuration** : mets
   `https://trendhunter-one.vercel.app` comme **Site URL**.

### B. La clé de la bibliothèque publicitaire Meta

1. Va sur https://www.facebook.com/ads/library/api et suis « Commencer ». Meta
   demande de confirmer ton identité (pièce d'identité) : la validation peut
   prendre un ou deux jours.
2. Sur https://developers.facebook.com : **Mes apps** → **Créer une app**
   (type « Autre » puis « Entreprise »).
3. Ouvre l'**Explorateur de l'API Graph**
   (https://developers.facebook.com/tools/explorer), choisis ton app, puis
   **Generate Access Token**.
4. Ce jeton expire vite : colle-le dans le **Débogueur de jeton d'accès**
   (https://developers.facebook.com/tools/debug/accesstoken) et clique
   **Prolonger le jeton d'accès**. Le jeton prolongé dure environ 60 jours :
   il faudra le renouveler ensuite (même manipulation).
5. Ce jeton prolongé est ta valeur `META_AD_LIBRARY_ACCESS_TOKEN`.

Ce que Meta fournit : les pubs diffusées dans l'Union européenne (le pays de
recherche par défaut est la France), avec le nom de l'annonceur, les textes, les
dates de diffusion et le domaine affiché dans la pub. Meta ne fournit pas le
fichier vidéo : le bouton « Voir dans la bibliothèque publicitaire Meta » ouvre
la vraie pub, avec sa vidéo, sur Facebook ; « Voir le site » ouvre le domaine
affiché dans la pub.

### C. Les variables dans Vercel

Vercel → projet **trendhunter** → **Settings** → **Environment Variables**. Pour
chaque ligne : nom, valeur, environnement **Production**, coche **Sensitive**
pour les clés secrètes, puis **Save**.

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | l'URL du projet Supabase (A.3) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la clé anon / publishable (A.3) |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé service_role / secret (A.3) — secrète |
| `META_AD_LIBRARY_ACCESS_TOKEN` | le jeton prolongé (B.4) — secret |
| `CRON_SECRET` | une longue suite aléatoire (40 caractères ou plus, par exemple tirée d'un générateur de mots de passe) — secrète |
| `TRACKED_KEYWORDS` | les produits à surveiller, séparés par des virgules, par exemple `corde à sauter, brosse lissante, lampe coucher de soleil` |
| `NEXT_PUBLIC_APP_URL` | `https://trendhunter-one.vercel.app` |

Puis **Deployments** → menu « … » du dernier déploiement → **Redeploy**.

### D. Vérifier

1. Sur le site, crée ton compte (**Créer un compte**) : en mode réel,
   l'espace de travail est enregistré dans ta base.
2. La recherche des pubs tourne chaque jour à **05:15 UTC** (07:15 à Paris en
   heure d'été, 06:15 en hiver). Le lendemain, la page **Alertes** →
   « Actualisation des données » indique la dernière exécution, et
   **Paramètres** → onglet **Intégrations** l'état du connecteur Meta.
3. Dans **Ad Spy**, les pubs réelles portent le badge « Mesuré » (et non plus
   « Données démo ») et les boutons « Voir dans la bibliothèque publicitaire Meta » et
   « Voir le site ».

---

## Actualisation quotidienne

**En mode démo (aucune variable configurée)**, rien à faire : le jeu de données
de démonstration se régénère automatiquement chaque jour. Son instantané est la
dernière journée UTC complète (la veille) ; il change à 00:00 UTC, sans
redéploiement. Chaque jour ajoute une journée d'historique (nouvelles
observations, nouvelles publicités vues « hier », tendances qui évoluent), sans
modifier les jours précédents : les graphiques s'allongent simplement d'un jour.
Ces données restent synthétiques et sont signalées partout comme
« Données de démonstration, régénérées chaque jour », avec leur date. Ce ne sont
jamais des observations réelles du marché. Pour figer la démo sur un jour
précis (tests), définir `DEMO_SNAPSHOT=AAAA-MM-JJ`.

**Pour des données réelles**, il faut :

1. Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`) avec les migrations appliquées ;
2. `CRON_SECRET` (une longue valeur aléatoire), pour autoriser la tâche planifiée ;
3. au moins un connecteur de données configuré (par exemple Meta Ad Library, ou
   des boutiques publiques à suivre — voir `docs/DATA_SOURCES.md`).

Puis **Redeploy**. Chaque jour à **05:15 UTC**, Vercel appelle `/api/cron/scan`
(déclaré dans `vercel.json`) : la tâche ingère les nouvelles données des
connecteurs, recalcule les agrégats et les scores, évalue les règles d'alerte
(notifications et e-mails) puis purge les données expirées. La page
**Alertes** → « Actualisation des données » indique le mécanisme actif, la date
des données affichées et la prochaine exécution prévue. Sans `CRON_SECRET`, la
page signale qu'aucune actualisation automatique n'a lieu.

Remarque : des données démo importées dans Supabase avec `npm run seed:demo`
gardent la date du jour de l'import ; elles ne se régénèrent pas.

