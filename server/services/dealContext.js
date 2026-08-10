// Bloc de contexte du dossier, injecte dans les prompts de recherche web pour
// les rendre "contextuels" (l'agent sait deja de quel bien on parle -- adresse,
// type d'actif, sous-marche -- au lieu de partir d'une question nue). Partage
// par le mode Web de l'Assistant (webSearch.js) et le verificateur
// d'affirmations du vendeur (vendorClaimsVerifier.js). Fonction pure : ne
// contacte jamais l'API, se contente de mettre en forme des champs deja
// extraits+verifies de fiche_identite_json -- aucune nouvelle donnee.
const FIELD_LABELS = {
  adresse: 'Adresse',
  codePostalVille: 'Ville',
  sousMarche: 'Sous-marché / quartier',
  typeActif: "Type d'actif",
  surfaceLocativeGLA: 'Surface locative',
  anneeConstruction: 'Année de construction',
  classeDPE: 'Classe DPE',
  prixDemande: 'Prix demandé',
};

// Ignore les champs absents/vides (value null ou '') -- on ne veut jamais que
// l'absence d'une donnee ressemble a une affirmation ("Prix demandé : null").
function buildDealContextBlock(ficheIdentite) {
  if (!ficheIdentite || typeof ficheIdentite !== 'object') return '';
  const lines = Object.entries(FIELD_LABELS)
    .map(([key, label]) => {
      const v = ficheIdentite[key]?.value;
      return (v !== null && v !== undefined && String(v).trim() !== '') ? `${label} : ${v}` : null;
    })
    .filter(Boolean);
  return lines.join('\n');
}

module.exports = { buildDealContextBlock };
