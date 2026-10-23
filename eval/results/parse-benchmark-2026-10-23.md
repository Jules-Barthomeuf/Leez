# Benchmark des parseurs — 2026-10-23

Commande : `npm run bench:parse -- --parseurs=pdfjs,tesseract,docling,mistral,azure,claude` · Machine : Apple M3, 8 cœurs, 9 Go, Node v22.23.1 (darwin arm64) · Durée totale : 24.2 s.

Protocole : `eval/fixtures/benchmark-v1/README.md`. Seul `documents/` est donné aux parseurs. Citations comparées après normalisation (NFKC, espaces, apostrophes, tirets, casse), similarité floue ≥ 0,90. Coordonnées de référence : pdfjs sur le PDF natif (`reference/natifs/` pour les scans). Coûts : mesurés sur les pages facturées × prix unitaire **configuré** (jamais en dur ; sans variable, « non mesuré »).

## Parseurs

| Parseur | Statut | Description |
| --- | --- | --- |
| pdfjs | testé | Couche texte native (pdfjs-dist), coordonnées par bloc, sans OCR ni tableaux |
| tesseract | testé | OCR Tesseract 5 (tesseract.js, langue fra, 250 dpi, rendu MuPDF), rotation automatique, boîtes par paragraphe |
| docling | testé (ok) | Docling (IBM, open source) : mise en page, OCR RapidOCR fr, tableaux structurés, en local via Python |
| mistral | non testé, clé manquante : MISTRAL_API_KEY | Mistral OCR (mistral-ocr-latest), API hébergée dans l'UE par défaut, markdown + boîtes de blocs |
| azure | non testé, clé manquante : AZURE_DI_ENDPOINT, AZURE_DI_KEY | Azure AI Document Intelligence, prebuilt-layout (2024-11-30), région UE à choisir à la création de la ressource |
| claude | non testé, clé manquante : ANTHROPIC_API_KEY | Claude (claude-sonnet-5-5) avec le PDF en entrée : transcription page par page, tableaux en markdown, sans coordonnées |

Prix configurés : USD→EUR — · Mistral OCR — $/1000 pages · Azure DI — $/1000 pages · Claude claude-sonnet-5-5 — $/Mtok entrée, — $/Mtok sortie (voir .env.example pour les sources).

## Jeu benchmark-v1

### Synthèse par type de document

**Tous les PDF** (A01, A02, A03, B01, B02, B03, B04, B05, B06, E02, Q01, Q02, Q03, T01, T02, T04, T05, T06)

| Parseur | Citations bonne page | Autre page | CER | WER | Coord. présentes | Coord. correctes | Tableaux (structure) | Tableaux (lignes texte) | Temps/page | €/page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdfjs | 70.3 % | 1.6 % | 33.7 % | 33.8 % | 100 % | 100 % | 0 % | 95 % | 25 ms | 0.0000 € |
| tesseract | 96.8 % | 0.0 % | 2.6 % | 6.0 % | 100 % | 20 % | 0 % | 89 % | 2.7 s | 0.0000 € |
| docling | 99.0 % | 0.0 % | 6.0 % | 9.3 % | 60 % | 98 % | 100 % | 100 % | 6.1 s | 0.0000 € |
| mistral | non testé |  |  |  |  |  |  |  |  |  |
| azure | non testé |  |  |  |  |  |  |  |  |  |
| claude | non testé |  |  |  |  |  |  |  |  |  |

**PDF natifs** (A01, A03, B01, B05, B06, E02, Q01, Q03, T01, T04, T05)

| Parseur | Citations bonne page | Autre page | CER | WER | Coord. présentes | Coord. correctes | Tableaux (structure) | Tableaux (lignes texte) | Temps/page | €/page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdfjs | 100.0 % | 0.0 % | 0.0 % | 0.1 % | 100 % | 100 % | 0 % | 100 % | 45 ms | 0.0000 € |
| tesseract | 94.8 % | 0.0 % | 1.1 % | 2.1 % | 100 % | 23 % | 0 % | 88 % | 2.2 s | 0.0000 € |
| docling | 100.0 % | 0.0 % | 3.6 % | 6.1 % | 51 % | 99 % | 100 % | 100 % | 2.8 s | 0.0000 € |
| mistral | non testé |  |  |  |  |  |  |  |  |  |
| azure | non testé |  |  |  |  |  |  |  |  |  |
| claude | non testé |  |  |  |  |  |  |  |  |  |

**Scans corrects** (A02, B02, Q02, T02)

| Parseur | Citations bonne page | Autre page | CER | WER | Coord. présentes | Coord. correctes | Tableaux (structure) | Tableaux (lignes texte) | Temps/page | €/page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdfjs | 0.0 % | 0.0 % | 100.0 % | 100.0 % | — | — | 0 % | 0 % | 2 ms | 0.0000 € |
| tesseract | 100.0 % | 0.0 % | 2.7 % | 7.8 % | 100 % | 19 % | 0 % | 100 % | 2.7 s | 0.0000 € |
| docling | 100.0 % | 0.0 % | 5.1 % | 8.1 % | 69 % | 97 % | 100 % | 100 % | 8.8 s | 0.0000 € |
| mistral | non testé |  |  |  |  |  |  |  |  |  |
| azure | non testé |  |  |  |  |  |  |  |  |  |
| claude | non testé |  |  |  |  |  |  |  |  |  |

**Scans dégradés** (B03, T06)

| Parseur | Citations bonne page | Autre page | CER | WER | Coord. présentes | Coord. correctes | Tableaux (structure) | Tableaux (lignes texte) | Temps/page | €/page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdfjs | 0.0 % | 0.0 % | 100.0 % | 100.0 % | — | — | — | — | 1 ms | 0.0000 € |
| tesseract | 100.0 % | 0.0 % | 9.5 % | 22.8 % | 100 % | 3 % | — | — | 4.3 s | 0.0000 € |
| docling | 90.6 % | 0.0 % | 17.3 % | 26.0 % | 59 % | 94 % | — | — | 18.0 s | 0.0000 € |
| mistral | non testé |  |  |  |  |  |  |  |  |  |
| azure | non testé |  |  |  |  |  |  |  |  |  |
| claude | non testé |  |  |  |  |  |  |  |  |  |

**PDF mixte (natif + scan)** (B04)

| Parseur | Citations bonne page | Autre page | CER | WER | Coord. présentes | Coord. correctes | Tableaux (structure) | Tableaux (lignes texte) | Temps/page | €/page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdfjs | 75.0 % | 13.9 % | 17.4 % | 17.4 % | 100 % | 100 % | — | — | 10 ms | 0.0000 € |
| tesseract | 100.0 % | 0.0 % | 1.7 % | 2.1 % | 100 % | 17 % | — | — | 2.5 s | 0.0000 € |
| docling | 100.0 % | 0.0 % | 5.4 % | 6.5 % | 100 % | 97 % | — | — | 2.3 s | 0.0000 € |
| mistral | non testé |  |  |  |  |  |  |  |  |  |
| azure | non testé |  |  |  |  |  |  |  |  |  |
| claude | non testé |  |  |  |  |  |  |  |  |  |

**Documents à tableaux** (E02, Q01, Q02, Q03, T04, T05)

| Parseur | Citations bonne page | Autre page | CER | WER | Coord. présentes | Coord. correctes | Tableaux (structure) | Tableaux (lignes texte) | Temps/page | €/page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdfjs | 91.2 % | 0.0 % | 10.4 % | 10.4 % | 100 % | 100 % | 0 % | 95 % | 10 ms | 0.0000 € |
| tesseract | 91.2 % | 0.0 % | 3.3 % | 7.1 % | 100 % | 29 % | 0 % | 89 % | 1.6 s | 0.0000 € |
| docling | 100.0 % | 0.0 % | 11.8 % | 20.7 % | 25 % | 97 % | 100 % | 100 % | 5.2 s | 0.0000 € |
| mistral | non testé |  |  |  |  |  |  |  |  |  |
| azure | non testé |  |  |  |  |  |  |  |  |  |
| claude | non testé |  |  |  |  |  |  |  |  |  |

### Par document

Citations retrouvées à la bonne page / attendues ; entre parenthèses, le CER quand le texte natif de référence existe.

| Document | Type | Pages | pdfjs | tesseract | docling |
| --- | --- | --- | --- | --- | --- |
| A01 | avenant · natif | 1 | 10/10 (0 %) | 10/10 (0 %) | 10/10 (12 %) |
| A02 | avenant · scan_correct | 1 | 0/11 (100 %) | 11/11 (2 %) | 11/11 (12 %) |
| A03 | avenant · natif | 1 | 9/9 (0 %) | 9/9 (0 %) | 9/9 (14 %) |
| B01 | bail_commercial · natif | 3 | 18/18 (0 %) | 18/18 (1 %) | 18/18 (0 %) |
| B02 | bail_commercial · scan_correct | 3 | 0/18 (100 %) | 18/18 (2 %) | 18/18 (1 %) |
| B03 | bail_commercial · scan_degrade | 3 | 0/18 (100 %) | 18/18 (11 %) | 16/18 (11 %) |
| B04 | bail_commercial · mixte | 5 | 27/36 (17 %) | 36/36 (2 %) | 36/36 (5 %) |
| B05 | bail_commercial · natif | 3 | 19/19 (0 %) | 19/19 (1 %) | 19/19 (0 %) |
| B06 | bail_commercial · natif | 3 | 18/18 (0 %) | 18/18 (1 %) | 18/18 (0 %) |
| E02 | etat_locatif · natif · tableau | 1 | 24/24 (0 %) | 23/24 (7 %) | 24/24 (21 %) |
| Q01 | quittance · natif · tableau | 1 | 11/11 (0 %) | 10/11 (2 %) | 11/11 (16 %) |
| Q02 | quittance · scan_correct · tableau | 1 | 0/10 (100 %) | 10/10 (6 %) | 10/10 (28 %) |
| Q03 | quittance · natif · tableau | 1 | 10/10 (0 %) | 9/10 (4 %) | 10/10 (17 %) |
| T01 | teaser · natif | 1 | 15/15 (0 %) | 15/15 (1 %) | 15/15 (1 %) |
| T02 | teaser · scan_correct | 1 | 0/13 (100 %) | 13/13 (7 %) | 13/13 (2 %) |
| T04 | teaser · natif · tableau | 1 | 33/33 (0 %) | 29/33 (1 %) | 33/33 (4 %) |
| T05 | teaser · natif · tableau | 1 | 26/26 (0 %) | 23/26 (4 %) | 26/26 (5 %) |
| T06 | teaser · scan_degrade | 2 | 0/14 (100 %) | 14/14 (5 %) ↻ | 13/14 (37 %) |

### Robustesse

| Parseur | T06 p.2 tournée (citations p.2, CER p.2, rotation) | T06 tampon sur le titre (citations p.1) | B03 scan dégradé (citations, CER, loyer imprimé) | Q03 en-tête 2 colonnes (WER, citations) | B04 mixte (bail natif, avenant scanné p.4, avenant natif p.5, CER p.4) |
| --- | --- | --- | --- | --- | --- |
| pdfjs | 0 %, 100 %, non | 0 % | 0 %, 100 %, loyer non trouvé | 0 %, 100 % | 100 %, 0 %, 100 %, 100 % |
| tesseract | 100 %, 4 %, oui | 100 % | 100 %, 11 %, 36 000 € trouvé | 5 %, 90 % | 100 %, 100 %, 100 %, 6 % |
| docling | 100 %, 66 %, non | 92 % | 89 %, 11 %, 36 000 € trouvé | 24 %, 100 % | 100 %, 100 %, 100 %, 16 % |

Toutes les citations sont retrouvées par au moins un parseur testé.

## Lecteurs Excel et mail (hors comparaison)

| Fichier | Valeurs correctes | Dont formules |
| --- | --- | --- |
| benchmark-v1/E01 | 34/34 | 2/2 |

| Fichier | Citations trouvées | Piège : prix attendu présent | Ancien prix (fil transféré) présent |
| --- | --- | --- | --- |
| benchmark-v1/T03 | 15/15 | oui | oui (à ignorer par l'extraction) |

## Coût et temps projetés

| Parseur | €/page mesuré | Temps/page | 2 000 pages/mois | 20 000 pages/mois | Calcul 2 000 p. | Calcul 20 000 p. |
| --- | --- | --- | --- | --- | --- | --- |
| pdfjs | 0.0000 € | 25 ms | 0.00 € | 0.00 € | 0.0 h | 0.1 h |
| tesseract | 0.0000 € | 2.7 s | 0.00 € | 0.00 € | 1.5 h | 14.7 h |
| docling | 0.0000 € | 6.1 s | 0.00 € | 0.00 € | 3.4 h | 33.9 h |

Les parseurs locaux (pdfjs, tesseract, docling) ne coûtent que du temps de calcul sur le worker ; les heures indiquées sont à un seul processus, sur cette machine.

## Recommandation

_Rédigée le 23 octobre 2026 à partir du rapport de ce jour (pdfjs, Tesseract et Docling testés ; Mistral, Azure et Claude non testés, clés absentes). Chiffres : voir les tableaux ci-dessus._

### Combinaison recommandée

**pdfjs pour les pages qui ont une couche texte, Tesseract (tesseract.js, en local, dans le worker) pour les pages scannées.** Règle de décision, page par page (un PDF mixte comme B04 passe donc par les deux) :

1. Extraire la couche texte avec pdfjs. Si la page compte **au moins 50 caractères hors espaces** (seuil déjà prévu par la spec, section 4) et que la part de lettres et chiffres dans ce texte dépasse 60 % (une couche texte parasite ou vide ne compte pas), la page est **native** : texte, blocs et boîtes de pdfjs, `ocr = false`.
2. Sinon la page est rasterisée par MuPDF à 250 dpi et lue par Tesseract (`fra`), avec essai des trois autres orientations quand la confiance moyenne est inférieure à 60 : `ocr = true`.
3. Une page scannée qui porte déjà une couche texte OCR (fréquent sur les data rooms) est traitée comme native mais marquée `ocr = true` par un indicateur de qualité (part de mots du dictionnaire) : à ajouter en phase 1, le jeu actuel n'en contient pas.

**Pourquoi.** Sur les 11 PDF natifs, pdfjs retrouve 100 % des 193 citations à la bonne page, avec des coordonnées exactes, en 45 ms par page et pour 0 €. Sur les 6 scans, Tesseract retrouve 100 % des citations (A02, B02, Q02, T02 : CER 2,7 % ; B03 et T06, dégradés : CER 9,5 %), lit la page tournée de T06 et le loyer imprimé de B03 malgré l'annotation manuscrite, et sur le PDF mixte B04 il lit les 36 citations. Docling fait aussi bien sur les citations (99 % en tout, 100 % sur B04) et nettement mieux sur deux points, les tableaux structurés (100 % des cellules, contre rien pour Tesseract qui ne rend que des lignes de texte) et les boîtes (98 % correctes contre 20 %), mais il est 2 à 3 fois plus lent (6 s par page, 18 s sur les scans dégradés), moins bon sur les scans dégradés (B03 : 2 citations manquées, T06 p. 2 : ordre de lecture bousculé, CER 66 %) et il impose Python, PyTorch et des modèles de 1 Go : sur Render, un service Docker à part, avec au moins 4 Go. Pour la phase 1, l'extraction lit le texte entier de la page (spec, section 5) : des tableaux rendus ligne par ligne (95 à 100 % des cellules retrouvées sur une même ligne de texte pour pdfjs et Tesseract) suffisent au modèle. Je propose donc de garder la stack Node telle quelle et de revenir à Docling, ou à une API, si la phase 2 (grilles, états locatifs) montre que les tableaux en lignes ne suffisent pas.

**Ce qu'il faut corriger côté Tesseract avant la phase 1** (petit) : les boîtes. Le parseur rend aujourd'hui une boîte par « paragraphe » Tesseract, qui couvre souvent la page entière ; il faut descendre aux lignes (Tesseract les donne), ce qui remettra les coordonnées au niveau de pdfjs pour le visualiseur de source.

### Coût mensuel

| Volume | pdfjs + Tesseract (recommandé) | Docling | Mistral OCR (non testé) | Azure DI Layout (non testé) | Claude Sonnet 5.5 (non testé) |
| --- | --- | --- | --- | --- | --- |
| 2 000 pages | 0 € ; au pire 1,5 h de calcul si tout est scanné (0,1 h si tout est natif) | 0 € ; 3,4 h de calcul, service Docker ≥ 4 Go | ≈ 7 € (4 $/1 000 pages) | ≈ 18 € (10 $/1 000 pages) | ≈ 24 € (≈ 2 500 tokens entrée + 800 sortie par page) |
| 20 000 pages | 0 € ; au pire 15 h de calcul par processus worker | 0 € ; 34 h de calcul par processus | ≈ 74 € | ≈ 184 € | ≈ 240 € |

Les coûts locaux sont du temps de calcul sur cette machine (Apple M-series) à un seul processus ; un worker Render `standard` sera du même ordre, en plus lent. Les coûts des API viennent des grilles tarifaires (sources dans `.env.example`), pas d'une mesure : ils seront mesurés dès qu'une clé est fournie (`MISTRAL_API_KEY`, `AZURE_DI_ENDPOINT` + `AZURE_DI_KEY`, `ANTHROPIC_API_KEY`), le benchmark entier coûtant moins de 1 € sur 36 pages.

### Région d'hébergement

| Parseur | Où tournent les données | Source |
| --- | --- | --- |
| pdfjs, Tesseract, Docling | Sur le worker (Render Francfort) : rien ne sort | — |
| Mistral OCR | UE par défaut (endpoint US seulement sur choix explicite) ; certaines fonctions peuvent transiter hors UE selon la liste des sous-traitants du Trust Center | Centre d'aide Mistral, article « where is my data stored » (relu via un résumé de recherche le 23/10/2026 ; la page directe n'a pas répondu : **à vérifier** dans la console avant usage) |
| Azure AI Document Intelligence | Région choisie à la création de la ressource : France Central ou West Europe | Tarifs publics Azure pour `francecentral` (API prices.azure.com, 23/10/2026) |
| Claude (API Anthropic) | `inference_geo` ne connaît que `us` et `global` ; aucune option UE sur l'API directe | platform.claude.com/docs/en/manage-claude/data-residency (23/10/2026) |

Claude en parseur de secours n'est donc pas compatible avec l'engagement d'hébergement européen tant qu'il passe par l'API Anthropic directe ; il le serait via Amazon Bedrock en région UE (Francfort, Paris), non testé ici. Mistral OCR est le candidat API le plus cohérent avec l'hébergement UE et le moins cher ; c'est celui à tester en premier si tu fournis une clé.

### Ce qu'aucun parseur testé ne lit bien

Aucune citation n'est manquée par tous les parseurs. Les points faibles :

- **T06 page 2 (page scannée à 90°)** : Tesseract la lit après rotation (CER 4 %) ; Docling retrouve les citations mais rend l'ordre de lecture bousculé (CER 66 %). Capture : `results/captures/` n'a rien à montrer puisqu'un parseur réussit ; la page est dans `fixtures/benchmark-v1/documents/T06_teaser_toulouse_scan.pdf`.
- **B03 (scan dégradé, annotation manuscrite)** : Tesseract lit tout (CER 11 %, loyer imprimé 36 000 € retrouvé, l'annotation « 41 400 € » apparaît aussi dans le texte : l'extraction devra la distinguer) ; Docling manque 2 citations.
- **Q03 (en-tête sur deux colonnes)** : pdfjs et le texte natif de référence suivent le même ordre « ligne par ligne » (les deux colonnes s'entremêlent : « Foncière Haussmann-Provence – Gestion ALTITUDE CONSEIL »), donc son WER de 0 % est un artefact du jeu, pas un mérite. Tesseract (WER 5 %) et Docling (24 %) reconstruisent mieux les colonnes. L'extraction par le modèle n'en souffre pas sur ce jeu (citations retrouvées : 100 %, 90 %, 100 %), mais un en-tête interclassé reste un risque pour les adresses.
- **Tableaux lus par OCR** : Tesseract perd quelques cellules de surface dans T04, T05 et E02 lus comme images (29/33, 23/26, 23/24) : sur un état locatif scanné, prévoir un passage par Docling ou une API avec tableaux.

### Limites de la mesure

Les scans du jeu sont générés à partir des natifs : même mise en page, polices propres. Les 6 à 8 vrais documents à venir dans `eval/fixtures/reels/` (scans de téléphone, fax, doubles colonnes, pages blanches) sont indispensables avant de figer le choix ; le script les prend en compte automatiquement. Le CER de Docling sur les natifs (3,6 %) vient surtout de l'ordre des titres courants et de la ponctuation normalisée, pas de fautes de lecture.

