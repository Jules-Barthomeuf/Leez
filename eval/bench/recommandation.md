_Rédigée le 23 octobre 2026 à partir du rapport de ce jour (pdfjs, Tesseract et Docling testés ; Mistral, Azure et Claude non testés, clés absentes). Mise à jour le même jour après les deux corrections demandées : boîtes Tesseract au niveau des lignes (boîtes correctes : 20 % → 100 %) et détection des couches texte OCR parasites (`packages/parsing/index.js`, `decider`). Chiffres : voir les tableaux ci-dessus. **Décision de Jules (23 octobre) : pdfjs + Tesseract validés comme défaut de la phase 1, Docling écarté pour la V1 (adaptateur conservé dans le benchmark), choix définitif après les vrais documents ; Mistral OCR à tester dès que `MISTRAL_API_KEY` est renseignée (au moment de cette mise à jour, la variable n'est pas dans `.env`).**_

### Combinaison recommandée

**pdfjs pour les pages qui ont une couche texte, Tesseract (tesseract.js, en local, dans le worker) pour les pages scannées.** Règle de décision, page par page (un PDF mixte comme B04 passe donc par les deux) :

1. Extraire la couche texte avec pdfjs. Si la page compte **au moins 50 caractères hors espaces** (seuil déjà prévu par la spec, section 4) et que la part de lettres et chiffres dans ce texte dépasse 60 % (une couche texte parasite ou vide ne compte pas), la page est **native** : texte, blocs et boîtes de pdfjs, `ocr = false`.
2. Sinon la page est rasterisée par MuPDF à 250 dpi et lue par Tesseract (`fra`), avec essai des trois autres orientations quand la confiance moyenne est inférieure à 60 : `ocr = true`.
3. Une page scannée qui porte déjà une couche texte OCR (fréquent sur les data rooms) est détectée par la présence d'une image qui couvre au moins 80 % de la page sous une couche texte exploitable (`couverture_image`, suivie dans la liste d'opérateurs pdfjs) : verdict `ocr_existant`, la page repasse par Tesseract et la couche existante est gardée en indice. Vérifié par un test sur un PDF « cherchable » produit par Tesseract (`packages/parsing/parsing.test.js`).

**Pourquoi.** Sur les 11 PDF natifs, pdfjs retrouve 100 % des 193 citations à la bonne page, avec des coordonnées exactes, en 45 ms par page et pour 0 €. Sur les 6 scans, Tesseract retrouve 100 % des citations (A02, B02, Q02, T02 : CER 2,7 % ; B03 et T06, dégradés : CER 9,5 %), lit la page tournée de T06 et le loyer imprimé de B03 malgré l'annotation manuscrite, et sur le PDF mixte B04 il lit les 36 citations. Docling fait aussi bien sur les citations (99 % en tout, 100 % sur B04) et nettement mieux sur deux points, les tableaux structurés (100 % des cellules, contre rien pour Tesseract qui ne rend que des lignes de texte) et les boîtes (98 % correctes contre 20 %), mais il est 2 à 3 fois plus lent (6 s par page, 18 s sur les scans dégradés), moins bon sur les scans dégradés (B03 : 2 citations manquées, T06 p. 2 : ordre de lecture bousculé, CER 66 %) et il impose Python, PyTorch et des modèles de 1 Go : sur Render, un service Docker à part, avec au moins 4 Go. Écarté pour la V1 (décision du 23 octobre), adaptateur conservé. Pour la phase 1, l'extraction lit le texte entier de la page (spec, section 5) : des tableaux rendus ligne par ligne (95 à 100 % des cellules retrouvées sur une même ligne de texte pour pdfjs et Tesseract) suffisent au modèle. Je propose donc de garder la stack Node telle quelle et de revenir à Docling, ou à une API, si la phase 2 (grilles, états locatifs) montre que les tableaux en lignes ne suffisent pas.

**Boîtes Tesseract** : corrigé. Le parseur rend une boîte par ligne (au lieu d'une par « paragraphe » Tesseract, qui couvrait souvent la page entière) : 100 % de boîtes correctes sur les scans, au niveau de pdfjs sur les natifs.

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
