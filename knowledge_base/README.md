# Base de connaissances (RAG)

Placez ici vos PDF de référence (bail commercial 3/6/9, indexation ILAT/ILC/IRL,
article 606, fiscalité, DPE/ESG, méthode d'analyse financière, urbanisme...).

Donnez-leur des noms de fichiers explicites — ils servent de source citée
telle quelle dans l'application (ex. `bail_commercial_369.pdf`,
`indexation_ilat.pdf`).

Une fois les PDF en place, lancez :

```
npm run kb:ingest
```

Cela (re)construit entièrement la base de connaissances : lecture des PDF,
découpage en sections logiques vérifiées, génération des embeddings
(Voyage AI — nécessite `VOYAGE_API_KEY` dans `.env`), stockage en base.
Relançable à tout moment sans créer de doublons.
