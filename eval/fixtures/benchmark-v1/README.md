# Jeu de benchmark Leez v1

Vingt documents d'immobilier commercial **entièrement fictifs**, avec leurs valeurs attendues. Le jeu sert d'abord à comparer les parseurs PDF. Il sert ensuite d'amorce au jeu d'évaluation de l'extraction (section 18 de la spec).

- 20 documents, 6 dossiers, 386 champs attendus, dont 24 champs volontairement absents.
- Chaque citation attendue a été retrouvée automatiquement dans le texte du PDF natif, à la bonne page, avant la livraison.
- Aucune donnée réelle. Les SIREN commencent tous par 999, les emails sont en `.example`, les téléphones en `00 00 00`. Les valeurs d'indices INSEE sont plausibles mais **inventées** : ne jamais s'en servir pour tester un calcul d'indexation réel.

## Contenu

```
documents/                 les 20 fichiers à donner aux parseurs (et seulement eux)
attendu/<ID>.json          valeurs attendues par document
manifest.json              liste des documents : type, dossier, format, défauts introduits
anomalies_attendues.json   incohérences entre documents (pour la phase 2)
reference/natifs/          versions natives des documents scannés  ⚠ ne jamais donner aux parseurs
reference/texte_natif/     texte exact de chaque page, pour mesurer la fidélité de l'OCR
generateur/                scripts Python qui régénèrent tout (graine fixe : python3 build.py <dossier>)
```

## Les documents

| ID | Type | Dossier | Format | Ce qu'il teste |
|---|---|---|---|---|
| T01 | Teaser | A Lyon | PDF natif | cas propre, rendement net vendeur et acte en main |
| T02 | Teaser | D Nice | Scan moyen | OCR simple |
| T03 | Teaser | E Bordeaux | Email .eml | teaser dans le corps du mail, ancien prix dans le fil transféré |
| T04 | Teaser | B Marseille | PDF natif | multi-lots, tableau, lot vacant, valeur locative qui n'est pas un loyer |
| T05 | Teaser | C Paris | PDF natif | immeuble multilocataire, tableau, prix hors droits |
| T06 | Teaser | F Toulouse | Scan couleur | tampon CONFIDENTIEL sur le titre, page 2 scannée à 90° |
| B01 | Bail | A Lyon | PDF natif | bail propre, indice ICC (changé ensuite par A01) |
| B02 | Bail | B Marseille | Scan correct | pas de dépôt de garantie, garantie bancaire à la place |
| B03 | Bail | D Nice | Scan dégradé couleur | tampons, perforations, annotation manuscrite qui contredit le loyer imprimé |
| B04 | Bail + avenants | F Toulouse | PDF mixte | bail natif, avenant 1 scanné, avenant 2 natif, dans un seul fichier |
| B05 | Bail | C Paris | PDF natif | bureaux, ILAT, franchise, renonciation à la 1re triennale |
| B06 | Bail | E Bordeaux | PDF natif | espaces insécables dans les montants, bail ferme 10 ans, terme échu, sans TVA |
| A01 | Avenant | A Lyon | PDF natif | change l'indice (ICC → ILC) |
| A02 | Avenant | D Nice | Scan moyen | renouvellement : change la durée et le loyer |
| A03 | Avenant | F Toulouse | PDF natif | baisse de loyer et prorogation, renvoie aux avenants 1 et 2 |
| Q01 | Quittance | A Lyon | PDF natif | avec refacturation de taxe foncière |
| Q02 | Quittance | B Marseille | Scan moyen | mensuelle, sans taxe foncière, perforations |
| Q03 | Avis d'échéance | C Paris | PDF natif | n'est pas une quittance ; en-tête sur deux colonnes ; loyer volontairement faux |
| E01 | État locatif | B Marseille | Excel | en-tête en ligne 5, totaux en formules, lot vacant, 2e onglet |
| E02 | État locatif | C Paris | PDF natif paysage | tableau à 9 colonnes, surface volontairement différente du bail |

## Format des valeurs attendues

```json
"loyer_annuel_ht_hc": {
  "valeur": "84000.00",          // chaînes décimales pour l'argent, dates ISO, booléens JSON
  "type": "montant",             // montant | surface | date | booleen | enum | texte | adresse | siren | nombre | pourcentage | indice_base
  "unite": "EUR",
  "citation": "loyer annuel de 84 000 € (quatre-vingt-quatre mille euros) hors taxes et hors charges",
  "page": 2,                     // page du fichier distribué (1 = première)
  "pages_autres_occurrences": [] // si la citation apparaît aussi ailleurs
}
"franchise_loyer_mois": { "valeur": null, "absent": true, "note": "Aucune franchise prévue" }
```

- **Champ absent** : le système doit répondre « — » (null). Toute valeur inventée compte comme une hallucination.
- **Excel** : la citation est remplacée par `cellule` (`"Etat locatif!E6"`).
- **Email** : pas de page, `partie: "text/plain"`.
- **B04** : les champs sont rangés dans `segments`, chacun avec son type et sa plage de pages dans le PDF fusionné.
- **`lignes`** : une entrée par lot ou par locataire (teasers multi-lots, états locatifs).
- La comparaison des citations se fait après normalisation : espaces insécables et retours à la ligne ramenés à un espace simple.
- Les noms de champs sont ceux du jeu. Si les templates de `docs/SPEC.md` utilisent d'autres clés, ajouter une table de correspondance plutôt que renommer le jeu.

## Pièges volontaires

- **B03** : l'annotation manuscrite « 41 400 € » n'est pas le loyer du bail. Valeur attendue : 36 000 € imprimés.
- **T03** : le fil transféré contient un ancien prix (1 050 000 €). Prix attendu : 980 000 €.
- **T04** : le potentiel de réversion de 52 800 € est une valeur locative, pas un loyer.
- **T02** : la terrasse de 20 m² n'entre pas dans la surface louée.
- **Q03** : avis d'échéance, pas une quittance (« ne vaut pas quittance »).
- **Teasers** : la taxe foncière n'est souvent pas mentionnée. Elle doit rester absente, pas être devinée.

## Anomalies attendues (`anomalies_attendues.json`)

Deux vraies anomalies (dossier Paris : surface bail ≠ état locatif, loyer appelé ≠ état locatif), trois fausses anomalies qu'un avenant explique (Lyon, Nice, Toulouse) et deux points d'information. Le système doit lever les deux premières et pas les trois suivantes.

## Protocole de notation des parseurs

Pour chaque parseur et chaque document PDF :

1. **Retrouvabilité des citations** (indicateur principal). Part des citations attendues retrouvées dans la sortie du parseur, à la bonne page, après normalisation, avec un seuil de similarité floue de 0,90. C'est ce qui conditionne la vérification des citations de Leez.
2. **Fidélité du texte**, sur les scans : taux d'erreur par caractère (CER) et par mot (WER) par rapport à `reference/texte_natif/`.
3. **Coordonnées** : le parseur donne-t-il une boîte englobante par bloc ou par mot ? Pour chaque citation retrouvée, la boîte tombe-t-elle sur la bonne zone ?
4. **Tableaux** : sur T04, T05, E02, Q01, Q02 et Q03, part des cellules attendues retrouvées dans la bonne ligne.
5. **Robustesse** : page pivotée (T06 p. 2), tampon sur du texte (T06, B03), ordre de lecture d'un en-tête sur deux colonnes (Q03), PDF mixte natif et scan (B04).
6. **Coût par page et temps par page**, mesurés et non tirés d'une grille tarifaire.

## Limites

Des documents générés sont plus réguliers que des vrais : même mise en page de bail, polices propres, pas de pages blanches, pas de doubles colonnes dans les baux. Compléter avec 6 à 8 vrais documents dont l'usage est autorisé, rangés hors du dépôt.
