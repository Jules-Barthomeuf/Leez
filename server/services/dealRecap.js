// Récapitulatif exécutif du dossier (onglet Sommaire) -- PAS une extraction :
// aucune nouvelle donnée lue dans le PDF ici, uniquement une mise en prose
// des données DÉJÀ extraites/vérifiées (fiche d'identité) et DÉJÀ calculées
// (indicateurs, verdict de l'Audit Leez) fournies dans le prompt. Le modèle
// ne fait donc que reformuler des faits déjà établis par du code
// déterministe ailleurs dans l'app -- jamais une nouvelle affirmation non
// vérifiée, jamais un chiffre inventé, estimé ou arrondi différemment de ce
// qui est fourni.
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();
const MODEL = 'claude-opus-5';

const recapSchema = {
  type: 'object',
  properties: {
    paragraphs: { type: 'array', items: { type: 'string' } },
  },
  required: ['paragraphs'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Tu rédiges le récapitulatif exécutif ("Sommaire") d'un dossier d'analyse immobilière, à partir UNIQUEMENT des données déjà extraites/vérifiées et des indicateurs déjà calculés fournis ci-dessous -- jamais une nouvelle donnée, jamais un chiffre inventé, estimé ou arrondi différemment de ce qui est fourni.

Consignes :
- 3 à 4 paragraphes courts en français, ton d'analyste (factuel, direct, jamais promotionnel/commercial).
- Paragraphe 1 : présente le bien (type, localisation, taille) et l'opération (prix demandé, rendement).
- Paragraphe 2 : situation locative (occupation, résultat net d'exploitation, points marquants si fournis).
- Paragraphe 3 : verdict de l'analyse Leez (déjà calculé, fourni ci-dessous) et principaux points de vigilance -- reformule fidèlement, n'invente jamais un risque non listé.
- Vocabulaire : reprends TOUJOURS le terme exact tel qu'il t'est fourni ci-dessous (ex: "résultat net d'exploitation (NOI)", jamais "résultat opérationnel net" ou une autre reformulation ; "TOP" pour le taux d'occupation physique) -- jamais de synonyme personnel qui introduirait une incohérence de vocabulaire avec le reste de l'application.
- Si une donnée clé manque (ex: prix non communiqué), dis-le dans le paragraphe concerné en termes que lira l'ANALYSTE (ex: "le prix n'est pas communiqué dans le document", "aucune alerte supplémentaire n'a été identifiée") -- jamais en référence au fait que CETTE donnée "n'a pas été fournie/transmise" à toi : ce serait une fuite du mécanisme de génération dans un texte destiné au lecteur final, qui n'a aucune idée de ce qui t'a été donné en entrée. Si une information est réellement absente, ne construis simplement PAS de phrase à son sujet plutôt que de signaler son absence de façon abstraite.
- Jamais de puces, jamais de titres de section : uniquement des paragraphes de prose.`;

async function generateDealRecap({ dataBlock }) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1536,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: recapSchema } },
    messages: [{ role: 'user', content: `=== DONNÉES VÉRIFIÉES/CALCULÉES DU DOSSIER ===\n${dataBlock}` }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('Le modèle a refusé cette requête (stop_reason=refusal).');
  }
  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error(`Aucune réponse structurée du modèle (stop_reason=${message.stop_reason}).`);
  }
  const { paragraphs } = JSON.parse(textBlock.text);
  return { paragraphs: (paragraphs || []).filter(p => typeof p === 'string' && p.trim()) };
}

// Bloc texte labellisé en français a partir du document "shaped" (meme
// forme que la reponse de GET /documents/:id) -- seuls les champs VERIFIES
// (citation retrouvee dans le document reel) ou EDITES (corriges a la main
// par l'analyste, donc fiables) sont inclus ; un champ absent/non verifie
// est simplement omis, jamais complete par une valeur devinee.
function buildDealRecapDataBlock(doc) {
  const fi = doc.ficheIdentite || {};
  const ind = doc.indicateurs || {};
  const trustedFieldVal = f => (f && f.value != null && (f.verified === true || f.edited === true)) ? f.value : null;
  const lines = [];
  const push = (label, v, suffix = '') => { if (v != null && v !== '') lines.push(`${label} : ${v}${suffix}`); };
  push('Adresse', trustedFieldVal(fi.adresse));
  push('Ville / code postal', trustedFieldVal(fi.codePostalVille));
  push("Type d'actif", trustedFieldVal(fi.typeActif));
  push('Sous-marché', trustedFieldVal(fi.sousMarche));
  push('Surface locative', trustedFieldVal(fi.surfaceLocativeGLA), ' m²');
  push('Année de construction', trustedFieldVal(fi.anneeConstruction));
  push('Classe DPE', trustedFieldVal(fi.classeDPE));
  push('Nombre de lots', trustedFieldVal(fi.nombreLots));
  push('Prix demandé (HD/AEM non précisé par le document)', trustedFieldVal(fi.prixDemande), ' €');
  push('Rendement affiché par le vendeur (base hors droits/AEM non précisée, non vérifié indépendamment)', trustedFieldVal(fi.rendementAffiche), ' %');
  push('Taux de capitalisation recalculé (calcul Leez)', ind.capRateRecalcule, ' %');
  push("TOP — Taux d'occupation physique (calculé sur les surfaces)", ind.tauxOccupation, ' %');
  push("Résultat net d'exploitation recalculé (NOI)", ind.resultatNetExploitation, ' €');
  push('Prix au m²', ind.prixM2, ' €/m²');
  push('WALB — durée ferme moyenne pondérée (jusqu\'à la prochaine échéance triennale)', ind.walb, ' ans');
  push('WALT — durée résiduelle moyenne pondérée (jusqu\'à fin de bail contractuelle)', ind.walt, ' ans');
  if (doc.audit?.summary) {
    lines.push(`\nVerdict de l'analyse Leez (déjà calculé, ne jamais recalculer) : ${doc.audit.summary.verdictLabel}`);
    if (doc.audit.summary.phrase) lines.push(`Détail du verdict : ${doc.audit.summary.phrase}`);
  }
  return lines.length ? lines.join('\n') : 'Aucune donnée vérifiée disponible pour ce dossier.';
}

module.exports = { generateDealRecap, buildDealRecapDataBlock };
