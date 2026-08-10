// Insere (ou remplace) UN dossier de demonstration clairement marque comme
// tel (isDemo=true dans l'API), pour explorer l'application sans avoir a
// importer un vrai PDF. Les donnees sont fictives mais internement
// coherentes : chaque citation correspond a un vrai texte de page stocke
// dans pages_json, donc "Voir dans le document" fonctionne normalement.
// Idempotent : peut etre relance sans dupliquer le dossier.
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { computeIndicateurs, computeMix } = require('../services/indicators');
const { runConsistencyChecks } = require('../services/consistency');

const pageTexts = {};
function cf(value, page, quote) {
  const q = quote != null ? quote : String(value);
  if (value != null && q) pageTexts[page] = (pageTexts[page] ? pageTexts[page] + ' ' : '') + q;
  return { value, page, quote: value != null ? q : '' };
}

let pool = null;

async function seedDemo() {
  // require() différé après la résolution de DATABASE_URL -- en local sans
  // Postgres installé, démarre (ou rejoint) le Postgres embarqué.
  if (!process.env.DATABASE_URL) await require('../localPostgres').ensureLocalPostgres();
  const db = require('../db');
  pool = db.pool;
  const { createDocument, updateDocument, clearDemoDocuments, findOrCreateWorkspace } = db;

  // Meme nom que le workspace de bootstrap cree par la migration
  // 008_add_workspace_scoping.js : un compte local cree sans --workspace
  // explicite (voir create-user.js) atterrit dans ce meme espace et voit
  // donc le dossier demo directement.
  const workspaceId = await findOrCreateWorkspace('Espace par défaut');
  await clearDemoDocuments(workspaceId);

  const id = uuidv4();
  await createDocument({ id, filename: 'Exemple — Meridian Office Park (démonstration).pdf', workspaceId });

  const ficheIdentite = {
    adresse: cf('10 Place de la Démonstration', 3, '10 Place de la Démonstration'),
    codePostalVille: cf('75013 Paris', 3, '75013 Paris'),
    sousMarche: cf('Paris Sud', 3, 'Paris Sud'),
    typeActif: cf('Bureau', 2, 'Bureau'),
    anneeConstruction: cf('2016', 4, '2016'),
    anneeRenovation: cf(null, 1, ''),
    surfacePonderee: cf('6 200 m²', 5, '6 200 m²'),
    surfaceUtile: cf('5 900 m²', 5, '5 900 m²'),
    surfaceLocativeGLA: cf('6 400 m²', 5, '6 400 m²'),
    nombreNiveaux: cf('4', 5, '4'),
    placesParking: cf('60', 6, '60'),
    classeDPE: cf('B', 6, 'Diagnostic de performance énergétique : classe B'),
    nombreLots: cf('5', 7, '5'),
    tauxOccupation: cf('96 %', 7, '96 %'),
    prixDemande: cf('42 000 000 €', 2, '42 000 000 €'),
    rendementAffiche: cf('6,20 %', 2, '6,20 %'),
    taxeFonciere: cf('95000', 8, '95 000 €'),
    chargesCoproPropriete: cf('50000', 8, '50 000 €'),
    regimeTVA: cf('Option TVA exercée', 8, 'Option TVA exercée'),
    courtierVendeur: cf('Exemple Conseil Immobilier', 1, 'Exemple Conseil Immobilier'),
  };

  const etatLocatif = [
    { suite: '101', locataire: 'Atelier Créatif SAS', activite: 'Design', surfaceSf: cf(1800, 10), dateDebutBail: cf('2019', 10), dateFinBail: cf('2030', 10), prochaineOptionSortie: cf('2027', 10), typeIndexation: cf('ILAT', 10), loyerFacialPsf: cf(380, 10), loyerEconomiquePsf: cf(370, 10), loyerAnnuel: cf(684000, 10), periodeFranchise: cf('2 mois', 10), depotGarantie: cf('3 mois', 10), chargesRecuperablesPct: cf(100, 10), tvaPct: cf(20, 10), statut: 'actif' },
    { suite: '102', locataire: 'Nova Consulting', activite: 'Conseil', surfaceSf: cf(1500, 11), dateDebutBail: cf('2018', 11), dateFinBail: cf('2028', 11), prochaineOptionSortie: cf('2025', 11), typeIndexation: cf('ILAT', 11), loyerFacialPsf: cf(400, 11), loyerEconomiquePsf: cf(390, 11), loyerAnnuel: cf(600000, 11), periodeFranchise: cf('1 mois', 11), depotGarantie: cf('3 mois', 11), chargesRecuperablesPct: cf(100, 11), tvaPct: cf(20, 11), statut: 'actif' },
    { suite: '201', locataire: 'Lumen Digital', activite: 'Technologie', surfaceSf: cf(1200, 12), dateDebutBail: cf('2017', 12), dateFinBail: cf('2026', 12), prochaineOptionSortie: cf('2026', 12), typeIndexation: cf('ILAT', 12), loyerFacialPsf: cf(410, 12), loyerEconomiquePsf: cf(400, 12), loyerAnnuel: cf(492000, 12), periodeFranchise: cf('0 mois', 12), depotGarantie: cf('3 mois', 12), chargesRecuperablesPct: cf(100, 12), tvaPct: cf(20, 12), statut: 'echeance_proche' },
    { suite: '202', locataire: 'Cabinet Ferrand & Associés', activite: 'Juridique', surfaceSf: cf(900, 13), dateDebutBail: cf('2020', 13), dateFinBail: cf('2029', 13), prochaineOptionSortie: cf('2026', 13), typeIndexation: cf('ILAT', 13), loyerFacialPsf: cf(420, 13), loyerEconomiquePsf: cf(410, 13), loyerAnnuel: cf(378000, 13), periodeFranchise: cf('0 mois', 13), depotGarantie: cf('3 mois', 13), chargesRecuperablesPct: cf(100, 13), tvaPct: cf(20, 13), statut: 'actif' },
    { suite: '301', locataire: 'Studio Kappa', activite: 'Communication', surfaceSf: cf(1000, 14), dateDebutBail: cf('2015', 14), dateFinBail: cf('2025', 14), prochaineOptionSortie: cf('Échu', 14), typeIndexation: cf('ILAT', 14), loyerFacialPsf: cf(400, 14), loyerEconomiquePsf: cf(400, 14), loyerAnnuel: cf(400000, 14), periodeFranchise: cf('0 mois', 14), depotGarantie: cf('3 mois', 14), chargesRecuperablesPct: cf(90, 14), tvaPct: cf(20, 14), statut: 'maintien_en_place' },
  ];

  const t12 = [
    { lineItem: 'Revenus locatifs de base', montant: cf(2554000, 20) },
    { lineItem: 'Refacturations de charges', montant: cf(220000, 20) },
    { lineItem: 'Autres revenus', montant: cf(15000, 20) },
    { lineItem: 'Vacance et pertes de créances', montant: cf(-60000, 20) },
    { lineItem: 'Taxes foncières', montant: cf(-95000, 21) },
    { lineItem: 'Assurance', montant: cf(-18000, 21) },
    { lineItem: 'Charges communes / fluides', montant: cf(-180000, 21) },
    { lineItem: 'Honoraires de property management', montant: cf(-50000, 21) },
    { lineItem: "Honoraires d'asset management", montant: cf(-20000, 21) },
    { lineItem: 'Entretien courant', montant: cf(-30000, 21) },
    { lineItem: 'GER (gros entretien et renouvellement)', montant: cf(-15000, 21) },
  ];

  const redFlags = {
    locatairesRisque: [],
    capexTechniques: [
      { sujet: 'Système CVC', montantEstime: cf(250000, 34, '250 000 €'), echeance: cf('2027', 34, '2027'), mention: cf('Le rapport technique indique un remplacement du système de climatisation (CVC) recommandé à horizon 2027, estimé à 250 000 €.', 34) },
    ],
  };

  const indicateurs = computeIndicateurs({ ficheIdentite, etatLocatif, t12 });
  const mix = computeMix(etatLocatif);
  const consistencyChecks = runConsistencyChecks({ ficheIdentite, etatLocatif, t12 });

  const maxPage = Math.max(...Object.keys(pageTexts).map(Number), 40);
  const pages = [];
  for (let n = 1; n <= maxPage; n++) {
    pages.push({ pageNumber: n, text: pageTexts[n] || `Texte factice de démonstration — page ${n}.` });
  }

  await updateDocument(id, {
    status: 'complete',
    page_count: pages.length,
    fiche_identite_json: ficheIdentite,
    etat_locatif_json: etatLocatif,
    t12_json: t12,
    mix_json: mix,
    indicateurs_json: indicateurs,
    consistency_json: consistencyChecks,
    red_flags_json: redFlags,
    pages_json: pages,
    is_demo: true,
  }, workspaceId);

  console.log('Dossier de démonstration créé : ' + id);
}

seedDemo()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => pool?.end()); // sans ca, le Pool pg garde le process ouvert indefiniment
