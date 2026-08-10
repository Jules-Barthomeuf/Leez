// Catalogue fixe des categories/types de documents annexes acceptes sur la
// page Importer. Duplique cote frontend (public/js/app.js) faute de module
// partage entre serveur et client dans ce projet -- garder les deux listes
// identiques en cas de modification. Sert uniquement a valider category/type
// a l'upload : aucune extraction n'est faite sur ces fichiers, ils sont
// stockes tels quels.
const SUPPORTING_CATALOG = [
  { id: 'photos', label: 'Photos & visuels', types: [
    'Photo de couverture',
    'Photos du bien',
    'Plans / vues aériennes',
    'Carte de situation',
  ] },
  { id: 'commercialisation', label: 'Commercialisation', types: [
    'Teaser / dossier anonymisé',
    'Fiche de commercialisation du broker',
  ] },
  { id: 'locatif', label: 'Locatif', types: [
    'Baux commerciaux (3/6/9) complets',
    'Avenants aux baux',
    'État locatif détaillé (rent roll du property manager)',
    'États des lieux',
    'Décomptes et régularisations de charges locatives',
    'Cautions / garanties / dépôts de garantie',
    "Franchises et mesures d'accompagnement",
  ] },
  { id: 'financier', label: 'Financier / comptable', types: [
    "Comptes d'exploitation réels (3 derniers exercices)",
    'Budget prévisionnel',
    "Pro forma / modèle d'underwriting du vendeur",
    'Avis de taxe foncière',
    'Budgets et appels de charges de copropriété',
    "Contrats de gestion, d'assurance, de maintenance",
  ] },
  { id: 'technique', label: 'Technique', types: [
    'DPE (diagnostic de performance énergétique)',
    'Audit énergétique',
    'Diagnostics réglementaires (amiante, plomb, électricité, gaz, termites)',
    "Rapport d'audit technique du bâti (structure, toiture, façades)",
    'Plan pluriannuel de travaux / CapEx',
    'Plans et surfaces (mesurage, attestation de surface)',
  ] },
  { id: 'reglementaire', label: 'Réglementaire / urbanisme', types: [
    "PLU (plan local d'urbanisme)",
    'Permis de construire / déclarations',
    "Certificat d'urbanisme",
    'ERP (état des risques et pollutions)',
    "Autorisations d'exploitation (ICPE, ERP si applicable)",
  ] },
  { id: 'juridique', label: 'Juridique / administratif', types: [
    'Titre de propriété',
    'État hypothécaire',
    'Règlement de copropriété + état descriptif de division',
    "Procès-verbaux d'assemblées générales de copropriété",
    'Contentieux / litiges locatifs en cours',
    'Servitudes et baux emphytéotiques éventuels',
  ] },
  { id: 'esg', label: 'ESG', types: [
    'Attestations de conformité environnementale',
    'Certifications (BREEAM, HQE, etc.)',
    'Données de consommation énergétique réelles',
  ] },
];

// L'Offering Memorandum reste un cas particulier : c'est le fichier "file"
// de la route /documents existante, celui qui declenche le vrai pipeline
// d'extraction. Il n'est donc PAS dans le catalogue des annexes (stockage
// seul) mais reste affiche comme premiere case a cocher sous
// "Commercialisation" cote frontend, avec sa propre logique.
const OM_LABEL = 'Offering Memorandum (OM) / dossier de présentation complet';

function isValidCategoryType(category, type) {
  const cat = SUPPORTING_CATALOG.find(c => c.id === category);
  return !!cat && cat.types.includes(type);
}

module.exports = { SUPPORTING_CATALOG, OM_LABEL, isValidCategoryType };
