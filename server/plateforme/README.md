# server/plateforme — la plateforme Leez (docs/SPEC.md)

Phase 0 livrée le 23 octobre 2026 : fondations. Voir la section 21 de la spec pour la correspondance avec la stack d'origine.

## Fichiers

- `db.js` : `avecOrg(orgId, role, fn)` ouvre une transaction qui porte `app.org_id` et `app.role`, lus par la RLS du schéma `plateforme`. `avecSysteme(fn)` pour les objets à `org_id NULL` (templates système, seeds). Jamais de `pool.query` direct sur `plateforme.*`.
- `routes.js` : `/api/deals`, `/api/deals/:id/uploads` (multipart `files`), `/api/deals/:id/documents`, `/api/documents/:id/reprocess`, `/api/documents/:id/file` (lien signé), `/api/storage/:jeton` (public, 5 minutes), `/api/org/settings`, `/api/org/members`, `/api/jobs`. Erreurs en `{ error: { code, message } }`. Monté **avant** l'ancien routeur `documents.js` : `GET /documents/:id/file` passe la main (`next()`) quand l'id n'est pas un document de la plateforme.
- `stockage.js` : disque sous `UPLOAD_DIR/plateforme/<org>/<deal>/<document>/<fichier>`, liens signés HMAC (`SESSION_SECRET`).
- `file.js` : pg-boss (schéma `pgboss`), une file par job de la section 4, reprises 3 × (30 s, puis exponentiel jusqu'à 10 min). `envoyer(nom, { org_id, … })` pose le groupe pg-boss = `org_id`.
- `worker.js` : consomme les files du registre `jobs/index.js`. Dans le processus web par défaut ; `WORKER_INLINE=false` + `npm run worker` pour le séparer.
- `jobs/ingest.js` : `document.ingest` (liste blanche, sha256, doublons → `duplicate`, zip et `.eml` → documents enfants, puis `document.parse`).
- `audit.js` : `journaliser(client, …)` dans `audit_events`, même transaction que l'action.
- `observabilite.js` : Sentry si `SENTRY_DSN`.
- `test-utils.js`, `plateforme.test.js` : base jetable + serveur enfant ; `npm run test:plateforme`.
- Migration : `../migrations/020_create_plateforme.js`.
- Écran : `public/js/plateforme.js`, `public/css/plateforme.css` (onglet « Dossiers », vues `#deals` et `#deals/<id>`).

## Rôles

`users.role` : `owner`, `admin` (réglages, membres), `analyst` (dossiers), `viewer` (lecture). Un visiteur du mode démo est `viewer` et, de toute façon, limité à la Prospection par `limiterInvite`.

## Ce que la phase 0 ne fait pas encore

`document.parse` et la suite (phase 1) : les jobs `document.parse` restent en attente dans pg-boss. Les écrans n'affichent que la Boîte d'entrée et les documents d'un dossier.
