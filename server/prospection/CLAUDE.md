# Prospection cession-bail (V2)

Ce module trouve, département par département, les entreprises françaises qui sont propriétaires des murs qu'elles occupent. Chaque cible est une entreprise et l'ensemble de ses murs. On la classe pour un **mandat SCPI** (ticket, types d'actifs, zone, bail ferme, rendement, pondération des scores), puis on la suit dans un pipeline.

L'onglet « Prospection » se trouve sous Simulateur. La mise en page suit celle de DealGround, avec le thème Leez. La spec V2 (21 oct. 2026) fixe le périmètre. Les lots 1 et 2 sont livrés en partie (voir « État » en bas).

## Principes (spec V2), à respecter dans tout changement
1. **Source cliquable.** Chaque chiffre renvoie à sa source (DGFiP, DVF, BODACC, RNE). Une donnée introuvable s'affiche « — » et n'est jamais estimée en silence.
2. **L'IA rédige, le code décide.** Scores, filtres et valeurs viennent de règles déterministes. Ici, rien n'est calculé par un modèle.
3. **Une estimation affiche sa fourchette** (basse, centrale, haute) et le nombre de comparables.
4. **Peu mais juste.** Par défaut, on montre les 20 meilleures cibles du mandat actif ; le reste s'obtient par filtre.
5. **Tout se fait depuis la fiche** : liste, étape, vérification, commentaire, export.
6. **Rien ne part sans un clic** de l'utilisateur.

## Fichiers
- `sources.js` : lecture et cache disque des sources, dans `data/prospection/cache` (ignoré par git).
- `pipeline.js` : le pipeline d'un département. Il écrit `data/prospection/out/<dept>.json` (format V2, `stats.version = 2` ; un fichier V1 est ignoré) et le CSV correspondant.
- `jobs.js` : la file d'attente des analyses, une à la fois, dans le serveur.
- `liste-noire.json` : les SIREN ou dénominations jamais proposés, tenus à la main, chacun avec sa raison.
- `contact.js` : CEO et DAF via Apollo, au clic (`APOLLO_API_KEY`, optionnelle).
- `zip.js`, `geo.js` : lecture d'une entrée zip sans dépendance, et géométrie GPS minimale.
- `../routes/prospection.js` : `/api/prospection/*`. Les données métier sont filtrées par `req.workspaceId`.
- `../migrations/019_create_prospection.js` : tables `prospection_mandats`, `_listes`, `_liste_cibles`, `_suivis` (étape du pipeline par mandat), `_verifications` (jeu du lot 1), `_journal` (qui a vu, exporté ou contacté quoi).
- `../scripts/prospection.js` : `npm run prospection -- --dept 06`, même pipeline qu'en tâche de fond.
- `../../public/js/prospection-scores.js` : les trois scores, la phrase « pourquoi elle vendrait », le cash libérable, la fusion multi-départements. Le serveur et le navigateur partagent ce fichier ; **c'est la seule source des règles**.
- `../../public/js/prospection-mandat.js` : régions et départements, lecture d'une phrase libre en critères (déterministe), normalisation des critères. Partagé lui aussi.
- `../../public/js/prospection.js`, `../../public/css/prospection.css` : l'écran.
- Tests : `npm run test:prospection`.

## Sources (ouvertes, sans clé sauf Apollo et Google Maps)
| Donnée | Source | Notes |
|---|---|---|
| Propriétaire de chaque local (SIREN, forme, groupe, droit, niveau, adresse) | DGFiP, fichier des locaux des personnes morales, millésime 2025 | Zip national d'environ 200 Mo, un fichier par département. **Ni nature ni surface du local.** |
| Contour, contenance, emprise bâtie | Cadastre Etalab, par commune | Un bâtiment est rattaché à la parcelle où tombe son centroïde. Le contour est gardé (6 décimales) pour la carte de la fiche. |
| Comparables de valeur, dernière vente d'une parcelle | DVF géolocalisé (Etalab) | 5 ans seulement. Pas d'Alsace-Moselle ni de Mayotte. Ni acheteur ni vendeur. |
| Établissements actifs sur la parcelle, dirigeants (année de naissance), comptes, effectif | API Recherche d'entreprises (SIRENE + RNE) | Environ 5,5 appels/s. Cache de 30 jours (`cache/api-<dept>.json`), qui permet de reprendre une analyse interrompue. |
| Annonces des 24 derniers mois | BODACC (DILA) | Recherche par SIREN. |
| Carte, Street View, vignettes | Google Maps JavaScript et Street View Static (`GOOGLE_MAPS_API_KEY`) | Si la clé manque ou est refusée, on bascule sur Leaflet avec les tuiles CARTO, et la photo satellite vient d'Esri. |
| Contact DAF / dirigeant | Apollo (`APOLLO_API_KEY`) | Un crédit par email révélé, deux au plus par clic. |

## Pipeline (`pipeline.js`), dans l'ordre
1. **DGFiP.** On garde le droit `P` des groupes `0` et `8`. On exclut :
   - les formes juridiques 4xxx et 7xxx (droit public) ;
   - les noms de bailleurs, foncières, SCPI, OPCI et crédit-bailleurs (`EXCLUS_NOM`) ;
   - la liste noire.
2. **Cadastre.** Surface estimée = emprise × niveaux distincts DGFiP (de 1 à 10) × part des locaux détenue.
3. **Valeur d'un mur.** On prend les ventes DVF « Local industriel. commercial ou assimilé » : au moins 100 m², aucun logement dans la mutation, entre 150 et 15 000 €/m². On cherche dans un rayon croissant de **2, 5, 10 puis 20 km** jusqu'à trouver **5 comparables**. Fourchette = 1er quartile, médiane, 3e quartile ; on garde les 8 ventes les plus proches. Sans 5 comparables à 20 km, pas de valeur. On ne vérifie l'occupation que des murs de **2,5 à 60 M€**, au plus 4 000 par département (les plus gros d'abord). Le mandat filtre ensuite sur la valeur totale de l'entreprise.
4. **Occupation.** On regarde les établissements actifs autour de la parcelle (`near_point`). Ils comptent **dans la parcelle** (point dans le contour ou même numéro et nom de voie) ou **à proximité**. Il faut ensuite un lien avec le propriétaire :
   - `meme_siren` ;
   - `gerant_sci` (l'exploitant dirige la SCI) ;
   - `proprietaire_dirige` ;
   - `holding_commune` ;
   - `dirigeant_commun` : même nom et même premier prénom. **Deux années de naissance publiées et différentes, ce sont des homonymes : pas de lien.**
   
   Sont exclus comme occupants : l'immobilier (68), les holdings (64.20), les fonds (64.30), les SCI et le droit public.
5. **Confiance du lien.**
   - **Fort** : lien structurel (même SIREN, ou une société dirige l'autre) et établissement dans la parcelle.
   - **Moyen** : lien structurel mais établissement seulement à proximité, ou holding / dirigeant à année vérifiée dans la parcelle.
   - **Faible** : le reste.
6. **Regroupement par entreprise occupante** (SIREN) : `cible.murs[]`, `cible.totaux`. Le navigateur fusionne une entreprise présente dans plusieurs départements (`Scores.fusionner`).
7. **Enrichissement.** Comptes, dirigeants (âge = année courante − année de naissance publiée), fonds probables, BODACC 24 mois (exploitant et propriétaires), dernière vente DVF de chaque parcelle.

**Commissaires aux comptes.** Après l'audit du 21 oct. 2026 sur le 06, on ne retire que deux cas :
- toute personne dont la **qualité** est commissaire, contrôleur ou auditeur ;
- une **société** au nom de cabinet d'audit (KPMG, Deloitte…) **sans fonction de direction**.

Une personne nommée Ernst ou Mazars, ou la holding d'un groupe comptable qui préside sa SCI, reste un dirigeant.

**Fonds probables.** Ce sont des dirigeants personnes morales dont le nom évoque un fonds (CAPITAL, EQUITY, PARTNERS, ou une liste de fonds français connus), hors holding du groupe (même premier mot que la société). Ils sont affichés « probable », jamais comme certains.

## Scores (sur 100, `prospection-scores.js`, recalculés par mandat)
Les points sont un point de départ, à recaler avec KV Capital sur 20 cibles qu'ils jugent eux-mêmes. Un changement se fait dans ce fichier, avec sa raison.

**Fit**
- valeur centrale dans le ticket : +35 (+15 à moins de 20 %) ;
- type d'actif visé : +25 ;
- zone visée : +20 ;
- lien occupant : fort +20, moyen +10 ;
- copropriété probable : −15 ;
- secteur NAF exclu par le mandat : exclu.

**Motivation**
- fonds probable au capital : +30 ;
- changement de dirigeant sous 18 mois (BODACC) : +20 ;
- dirigeant **exécutif** de 60 ans et plus (président, gérant, directeur général) : +15 ;
- propriétaire créé avant 2005 et aucune vente depuis 5 ans : +15. C'est une approximation de « achat avant 2005 » : DVF ne remonte qu'à 5 ans ;
- plus-value latente d'au moins 50 % sur une vente DVF connue : +10 ;
- modification du capital sous 24 mois : +10 ;
- opération de cession ou d'acquisition sous 24 mois : +10 ;
- recrutement de DAF : affiché « non mesuré ».

**Locataire**
- procédure collective de l'occupant (24 mois) : exclu, global à 0 ;
- ancienneté : plus de 10 ans +20, de 5 à 10 ans +10 ; inférieure au bail ferme du mandat −10 ;
- résultat positif sur 3 exercices : +30 (sur le dernier seulement : +15) ;
- CA en hausse : +15 ;
- CA d'au moins 10 M€ : +15 (au moins 2 M€ : +8) ;
- effectif : au moins 50 +10, au moins 10 +5 ;
- comptes absents : « données partielles ».

**Global** = moyenne des trois scores pondérée par le mandat (par défaut 40 / 35 / 25).

**Phrase « pourquoi elle vendrait »** : les trois signaux les plus forts, assemblés par le code.

**Cash libérable** : la fourchette de valeur, la dette affichée « — » (pas de source ouverte), et le loyer induit au rendement du mandat.

## Mandat en phrase libre
`lirePhrase` reconnaît :
- le ticket (« 8 à 30 M€ », « entre 5 et 20 millions », « plus de 10 M€ ») ;
- les types et les exclusions (« hors restauration ») ;
- les régions et leurs alias (PACA, AURA, IDF…), les départements par nom ou par code ;
- le bail ferme, le rendement, le client (« SCPI Xxx »).

Le texte d'une région reconnue est retiré avant de chercher les départements, pour que « Rhône » ne soit pas lu dans « Auvergne-Rhône-Alpes ». Ce qui n'est pas reconnu reste vide, et le formulaire permet de corriger. La spec prévoit une IA pour cette lecture : à brancher quand Leez aura sa clé Anthropic, en gardant le formulaire de validation.

## État (21 oct. 2026)
**Livré**
- Lot 1, côté données : confiance du lien, homonymes, filtre des commissaires corrigé, liste noire, valeur par comparables avec « — ».
- L'écran de vérification du jeu de 50 (`#prospection/verification/06`).
- Les mandats (phrase libre et formulaire, pondérations), la file d'analyses multi-départements.
- Explorer (top 20, filtres en pastilles, carte avec regroupement, recherche en déplaçant la carte), tableau, fiche (carte satellite, contours, Street View), listes, pipeline (motif d'écart obligatoire, relance à J+7), journal, export CSV.

**Pas encore fait**
- Lot 3 : message pré-rédigé, séquence J0/J+7/J+21, dossier PDF du mandat.
- Lot 4 : veille de nuit, assistant.
- Géocodage par la Base Adresse Nationale ; offres d'emploi DAF ; dessin libre d'une zone ; export vers le CRM de KV Capital.

**À faire avant une démo externe** (spec, hors code)
- Une clé Google Maps propre à Leez : l'actuelle vient de Klocka.
- Un compte et une adresse Leez à la place de `sourcing@klocka.immo`.
- La vérification à la main des 50 cibles du 06.

## Vitrine et accès sans compte (22 oct. 2026)
- `/` sert `public/vitrine.html` : la page vitrine (FR / EN, `public/js/vitrine.js`, `public/css/vitrine.css`), structurée comme celle de DealGround. Les captures de `public/img/vitrine/` sont prises dans l'outil, **noms, adresses et phrases floutés** : une page publique ne doit jamais laisser deviner qu'une société réelle vendrait ses murs. Aucune capture de carte zoomée sur un site. L'ancienne page de l'analyse d'OM reste sur `/landing.html`.
- « Accéder à l'outil » ouvre la Prospection **sans compte** si `LEEZ_ACCES_LIBRE=true` (sinon : la page de connexion). `POST /api/auth/invite` ouvre une session sur un compte partagé « Visiteur », dans l'espace « Démo Leez ». `limiterInvite` (`auth/middleware.js`) ne laisse passer que la Prospection et les lectures du démarrage. Un visiteur ne peut pas :
  - lancer une analyse, y compris en enregistrant des critères ;
  - utiliser Apollo, importer un document ou l'assistant ;
  - changer le mot de passe ou les préférences du compte.
- La file des analyses est gardée dans `data/prospection/file.json` : un redémarrage du serveur la reprend.
