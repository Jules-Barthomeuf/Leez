# Documents réels (hors git)

Rangez ici les vrais documents dont l'usage est autorisé, avec la même structure que `benchmark-v1` :

```
reels/
├── documents/<ID>_<nom>.pdf      les fichiers donnés aux parseurs
├── attendu/<ID>.json             valeurs attendues, même format que benchmark-v1/attendu/
├── manifest.json                 facultatif : { "documents": [{ "id", "fichier", "doc_type", "format", "defauts", "natif_reference" }] }
└── reference/texte_natif/<ID>.json   facultatif : texte exact par page, pour le CER/WER des scans
```

`npm run bench:parse` prend ce dossier en compte dès qu'il contient au moins un `attendu/*.json` dont le `fichier` existe (`--sans-reels` pour l'ignorer). Tout ce dossier est ignoré par git sauf ce fichier.
