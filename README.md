# Leez — extraction réelle de mémorandums de vente

Backend local qui reçoit un vrai PDF (mémorandum de vente / OM), en extrait le
texte réel page par page, demande à l'API Claude d'en extraire des données
structurées **avec citation obligatoire** (page + citation verbatim), puis
**vérifie chaque citation contre le texte réel du document** avant de
l'afficher. Un champ dont la citation ne correspond pas au texte réel est
affiché comme absent — jamais comme une valeur inventée.

Voir `dapper-wiggling-dove.md` (dans les plans Claude) pour l'architecture
complète et les choix de conception.

## Prérequis

- Node.js 18+ (testé avec Node 22)
- Une clé API Anthropic (https://console.anthropic.com)

## Installation

```bash
npm install
cp .env.example .env
# puis éditer .env et renseigner :
#   ANTHROPIC_API_KEY=sk-ant-...
```

## Lancer le serveur

```bash
npm run dev      # avec rechargement automatique (nodemon)
# ou
npm start
```

Ouvrir http://localhost:3000 — l'en-tête indique si la clé API est bien
détectée. Déposez un PDF texte natif (pas un scan) de plusieurs dizaines de
pages ; le statut se met à jour automatiquement pendant l'extraction.

## Déploiement (pilote multi-utilisateurs, Render)

Un `render.yaml` est fourni (région Frankfurt/EU) : Web Service Node + Postgres
managé avec sauvegardes automatiques + Disk persistant pour les PDF importés.

**Prérequis avant de déployer** : ce dossier n'est pas encore un dépôt Git —
Render déploie à partir d'un dépôt GitHub/GitLab connecté, donc il faut
d'abord `git init`, committer, et pousser vers un dépôt distant (à créer par
vous — ce n'est pas une étape que l'agent effectue seul).

1. Poussez le code sur GitHub/GitLab.
2. Sur [render.com](https://render.com), "New +" → "Blueprint", connectez le
   dépôt. Render détecte `render.yaml` automatiquement et propose de créer le
   service web + la base Postgres.
3. Une fois les ressources créées, dans le dashboard du service **leez**,
   onglet "Environment" : renseignez `ANTHROPIC_API_KEY` et `VOYAGE_API_KEY`
   (marquées `sync: false` dans `render.yaml`, donc jamais committées).
4. Premier déploiement : les migrations s'appliquent automatiquement
   (`preDeployCommand`) avant que le service ne prenne le trafic.
5. Créez les premiers comptes via l'onglet "Shell" du service Render :
   ```bash
   node server/scripts/create-user.js --email vous@fonds.fr --password '...' --workspace "Nom du fonds"
   ```
6. (Optionnel) Analytics — créez un projet sur
   [eu.posthog.com](https://eu.posthog.com), copiez sa clé projet dans
   `POSTHOG_API_KEY` (Environment du service Render), laissez `POSTHOG_HOST`
   tel quel. Sans cette clé, l'app fonctionne normalement, aucun appel
   PostHog n'est jamais tenté.

En local, aucune de ces étapes n'est nécessaire : `npm start` démarre un
Postgres embarqué automatiquement (voir `server/localPostgres.js`).

## Tester le moteur de vérification sans clé API

```bash
npm run test:verification
```

Ce script exécute des cas synthétiques (citation exacte, citation avec faute
mineure, citation absente, valeur divergente de la citation, page hors
bornes) sans appeler l'API Claude — utile pour vérifier que le moteur
anti-hallucination fonctionne avant même de configurer une clé.

## L'application

Six écrans, tous branchés sur le vrai backend (plus aucune donnée de
démonstration statique) :

- **Dashboard** — reprendre le dernier dossier importé ou en importer un nouveau.
- **Dossiers** — liste des documents réellement importés, avec leur statut de traitement.
- **Sommaire** — vue d'ensemble d'un dossier : métriques clés, indice de vérification réel (% de champs cités effectivement vérifiés), avancement, points de vigilance issus des contrôles de cohérence.
- **Données** — fiche d'identité, état locatif, compte de résultat glissant, répartition des surfaces et indicateurs clés, chacun avec sa citation vérifiée et un lien "Voir dans le document".
- **Interprétation** — voir ci-dessous.
- **Présentation** — mémo de comité généré par gabarit à partir des seules données vérifiées.
- **Simulateur** — moteur financier complet (crédit, TVA, revente, négociation), initialisé avec les vraies valeurs du dossier ouvert et entièrement éditable.
- **Réglages du fonds** — critères de mandat (taille, typologie, localisation, rendement cible) utilisés par l'onglet Interprétation.

### Onglet Interprétation

- **Score de correspondance au mandat** : calcul transparent et auditable (pas un jugement de l'IA) — pourcentage des critères configurés dans Réglages qui sont réellement respectés par le dossier, avec le détail de chaque critère. Sans critère configuré, affiche explicitement "aucun critère configuré" plutôt qu'un chiffre.
- **Red flags** classés en 3 catégories (Locatif, Financier, Technique/ESG), tous dérivés de données réelles : seuils de concentration locative et de charges appliqués aux indicateurs déjà calculés, écarts des contrôles de cohérence, DPE énergivore (échelle réglementaire réelle), et mentions réelles de locataires en difficulté financière / CAPEX techniques extraites et citées par un 3ᵉ appel à l'API Claude (même garde-fou de vérification que le reste).
- **Mini stress-test** : recalcul en direct (départ du locataire principal, baisse du prix, inflation des CAPEX identifiés) — pure arithmétique sur les données déjà vérifiées, aucune nouvelle donnée inventée.
- **Matrice pros/cons** prête pour le comité, construite à partir des mêmes signaux réels.
- **Consultation source scindée** : cliquer "Voir la source" sur une alerte ouvre le texte réel de la page citée à côté, avec la citation surlignée.

## Ce qui est réel dans cette v1

- Upload d'un vrai PDF, extraction du texte réel page par page (`pdfjs-dist`).
- Trois appels à l'API Claude (`claude-opus-5`) avec sortie structurée
  (`output_config.format`) imposant une citation `{value, page, quote}` sur
  chaque champ extrait : fiche d'identité + état locatif, compte de résultat
  glissant, et signaux de risque (locataires en difficulté, CAPEX techniques
  mentionnés).
- Vérification déterministe (sans nouvel appel au modèle) de chaque citation
  contre le texte réel de la page annoncée — un champ non vérifié est mis à
  `null`, jamais affiché comme une valeur réelle.
- Contrôles de cohérence croisés (loyers état locatif vs compte de résultat,
  surfaces, rendement recalculé vs affiché).
- Indicateurs clés calculés côté serveur à partir des données déjà vérifiées
  (jamais redemandés au modèle).
- Filtrage mandat, red flags, stress-test et pros/cons de l'onglet
  Interprétation : calculs déterministes côté serveur/client sur des données
  réelles, jamais un score ou un verdict généré librement par le modèle.
- Persistance SQLite, API REST, interface complète avec liens "Voir source"
  ouvrant le texte réel de la page citée.

## Limites connues de cette v1 (volontairement hors périmètre)

- **PDF scannés (image seule) non pris en charge** — le document doit avoir
  une vraie couche de texte. Un document majoritairement scanné est détecté
  et rejeté explicitement plutôt que de produire une extraction non fiable.
- **WALT, WALB et l'échéancier des baux ne sont pas calculés** (y compris le
  "mur d'échéances" de l'onglet Interprétation) — ces indicateurs
  nécessiteraient un parseur de dates en texte libre fiable, qui n'a pas été
  construit ici pour ne pas introduire une nouvelle source d'erreur
  silencieuse.
- **Pas de comparable de marché (ERV)** — aucune source de donnée de marché
  fiable n'étant disponible, le red flag "sur-loyer vs marché" n'est pas
  calculé.
- Non testé dans un vrai navigateur dans cet environnement de développement
  (pas d'outil de navigateur disponible côté agent) — la structure DOM, les
  gestionnaires d'événements et les appels serveur ont été vérifiés via un
  DOM headless (jsdom) avec des dossiers synthétiques, mais un test visuel
  manuel reste à faire par vous en premier lancement.
