# eval — jeux de référence et benchmark des parseurs

- `fixtures/benchmark-v1/` : 20 documents fictifs d'immobilier commercial avec leurs valeurs attendues (voir son `README.md` : contenu, pièges, protocole de notation). `correspondance-spec.json` relie ses champs aux clés de `docs/SPEC.md` et liste ceux qui n'y existent pas encore.
- `fixtures/reels/` : vos vrais documents, même structure, jamais commités (voir son `README.md`).
- `bench/parse.js` : le benchmark des parseurs PDF. `npm run bench:parse [-- --parseurs=pdfjs,tesseract,docling,mistral,azure,claude] [--docs=T01,B03] [--force] [--sans-reels]`.
- `bench/notation.js` : les mesures (citations à la bonne page, CER/WER, coordonnées, tableaux). `bench/rapport.js` : le Markdown.
- `bench/recommandation.md` : la recommandation, reprise telle quelle dans le rapport.
- `results/parse-benchmark-<date>.md` et `.json` : les rapports (commités). `results/raw/` : les sorties brutes des parseurs, cache des exécutions suivantes (hors git ; `--force` pour tout refaire). `results/captures/` : les pages qu'aucun parseur ne lit.
- `.cache/` : données de langue de Tesseract (hors git).

Les parseurs eux-mêmes sont dans `packages/parsing/` (interface `DocumentParser`, sortie normalisée `ParsedDocument` typée dans `packages/core/types.js`). Docling demande un Python avec `pip install docling` et la variable `DOCLING_PYTHON` ; Mistral, Azure et Claude demandent leurs clés (`.env.example`) ; sans clé, le parseur est « non testé, clé manquante » et le reste du benchmark tourne.
