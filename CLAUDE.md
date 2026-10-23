# Leez — consignes pour Claude Code

Lis `docs/SPEC.md` avant toute tâche. Travaille phase par phase (section 20 de la spec) ; ne déclare une phase terminée que si tous ses critères d'acceptation passent, tests compris. La section 21 de la spec dit comment elle se greffe sur ce dépôt : c'est elle qui fait foi pour la stack.

## Ce dépôt

- Serveur Express en JavaScript CommonJS (`server/`), Postgres (embarqué en local via `server/localPostgres.js`, géré sur Render), migrations `node-pg-migrate` dans `server/migrations/`, front sans framework dans `public/`. `npm run dev` lance tout (nodemon redémarre à chaque changement sous `server/` ou `packages/`).
- **La plateforme** (deals, documents, faits, livrables… : la spec) vit dans `server/plateforme/`, `packages/*`, `templates/`, le schéma Postgres `plateforme` et `public/js/plateforme.js`. Onglet « Dossiers ».
- **La Prospection** (`server/prospection/`, `server/routes/prospection.js`, `public/js/prospection*.js`, tables `prospection_*`) est un module indépendant, documenté dans `server/prospection/CLAUDE.md`. Il reste dans le menu mais **n'est lié à rien** de la plateforme : ne pas l'y brancher, ne pas le modifier au passage.
- **La vitrine** (`public/vitrine.html`, `vitrine.css`, `vitrine.js`) est la page publique à la racine. Elle ne change pas sauf demande explicite.
- **Le Simulateur** (`public/js/app.js`, `server/routes/documents.js`, `server/services/`) est l'outil historique d'analyse d'OM. Il reste tel quel tant que la plateforme ne le remplace pas.
- Une organisation (`org_id`) = un `workspaces.id`. Le rôle d'un membre est `users.role` (`owner`, `admin`, `analyst`, `viewer`).
- Toute requête SQL de la plateforme passe par `avecOrg(orgId, role, fn)` de `server/plateforme/db.js`, qui pose `app.org_id` et `app.role` pour la RLS. Jamais de `pool.query` direct sur une table `plateforme.*`.
- Les jobs sont dans pg-boss (`server/plateforme/file.js`). Chaque job reçoit `org_id` dans ses données et le filtre explicitement.
- Code, commentaires, messages d'erreur et interface en français. Noms de fichiers et de fonctions en français dans la plateforme, sauf les noms imposés par la spec (tables, clés, routes).
- Tests : `npm test` (tout), `npm run test:plateforme`, `npm run test:core`, `npm run test:parsing`. Les tests de base de données créent une base jetable sur le Postgres pointé par `DATABASE_URL`, sinon sur le Postgres embarqué (sans pgvector). Pour exercer pgvector en local : `docker compose up -d` (image `pgvector/pgvector:pg16`) et `DATABASE_URL=postgres://leez:leez@localhost:5432/leez`.
- Parseurs : `packages/parsing` (pdfjs pour les pages à couche texte, Tesseract pour les scans, décision page par page par `couchesTexte` / `decider`). Benchmark : `npm run bench:parse`, rapport dans `eval/results/`.

## Principes non négociables (spec, section 0)

1. **Le fait sourcé est l'unité de base.** Toute valeur affichée, calculée ou exportée vient de la table `facts`. Jamais d'un texte brut ni d'une sortie LLM directe.
2. **Le LLM ne calcule jamais.** Il lit, classe, extrait, rédige et orchestre. Tout nombre dérivé (rendement, conversion mensuel → annuel, indexation) vient de `packages/calc`.
3. **Pas de citation, pas de fait.** Une valeur dont l'extrait n'est pas retrouvé dans le texte source est stockée en `unverified`. Elle n'entre dans aucun calcul, critère ni livrable.
4. **Les templates sont des données.** Aucun champ métier n'est codé en dur dans le pipeline d'extraction. Tout vient de `extraction_templates`.
5. **Rien ne part sans validation humaine.** Aucun email envoyé, aucun livrable validé, aucun fait modifié par l'IA sans action d'un utilisateur.
6. **Tout est traçable.** Chaque appel LLM est journalisé (`llm_calls`), chaque fait est versionné, chaque action utilisateur est dans `audit_events`.
7. **Multi-tenant strict.** Toute table métier porte `org_id` et est protégée par RLS. Le worker filtre toujours explicitement par `org_id`.
8. **Idempotence.** Tout job peut être relancé sans créer de doublon.
9. **Donnée introuvable = « — ».** Jamais d'estimation à la place d'une valeur manquante.
10. **Les statuts de conformité sont** Conforme, À discuter, Incomplet, Non conforme. Aucun autre vocabulaire.

## Argent et typage (décision A3)

Dans `packages/calc`, `packages/rules` et `packages/core`, tout montant passe par decimal.js (`Decimal`), jamais par un `number`, et toute fonction exportée est typée en JSDoc (`@param`, `@returns`, types de `packages/core/types.js`). `npm run typecheck` (TypeScript en mode `checkJs` strict sur ces trois dossiers) doit passer ; la CI échoue sinon.

## Règle de dépendances

`packages/core`, `packages/calc` et `packages/rules` ne font aucune I/O (ni base, ni réseau, ni disque) et se testent seuls. `server/*` dépend de `packages/*`, jamais l'inverse. Aucun package ne dépend de `server/prospection`.

## Avancement

- Phase 0 (fondations) : livrée le 23 octobre 2026. Voir `server/plateforme/README.md`.
- Phases 1 à 8 : à faire, dans l'ordre.
