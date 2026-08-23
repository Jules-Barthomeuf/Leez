// Appels a l'API Claude pour extraire des donnees structurees et citees a
// partir du PDF. Chaque valeur extraite doit porter { value, page, quote } --
// c'est le contrat impose par le schema JSON ci-dessous. La verite de ces
// citations n'est PAS garantie par le modele : c'est verification.js qui la
// verifie ensuite contre le texte reel du document.
//
// IMPORTANT -- schema sans aucun champ nullable/optionnel. Une premiere
// version utilisait `value: [type, 'null']` (union nullable) sur les champs
// cites, scindee en plusieurs appels pour rester sous un plafond suppose de
// 16 unions. Erreur persistante malgre cette scission : 400 "compiled
// grammar is too large". Ce plafond n'est PAS documente officiellement par
// Anthropic (confirme par recherche live, aout 2026) ; des rapports
// communautaires (issues GitHub sur les SDK Anthropic) indiquent que ce
// n'est pas le nombre de proprietes qui compte mais le nombre de champs
// nullables/optionnels -- chacun double environ l'espace d'etats de la
// grammaire compilee (FSM), et cet effet est multiplie par la repetition
// quand le champ est a l'interieur d'un tableau (etat locatif, T-12,
// signaux). La correction recommandee est de ne JAMAIS rendre un champ
// nullable ou optionnel : `value` est toujours de type `string`, requis,
// avec une chaine vide '' comme sentinelle d'absence (au lieu de null) --
// y compris pour les champs numeriques, dont la valeur est ecrite en texte
// (ex: '452300.5', '-119000') et reconvertie en nombre cote serveur juste
// apres reception (voir toNum/fixCitedNumber ci-dessous). Le reste du code
// (verification.js, indicators.js, interpretation.js, app.js) continue de
// recevoir { value: number|string|null, page, quote } exactement comme
// avant : cette conversion est un choix d'implementation isole ici.
const Anthropic = require('@anthropic-ai/sdk');
const { withRetry } = require('./apiRetry');

const client = new Anthropic();
const { EXTRACTION_MODEL } = require('./models');
const MODEL = EXTRACTION_MODEL;

const citedField = {
  type: 'object',
  properties: {
    value: { type: 'string' },
    page: { type: 'integer' },
    quote: { type: 'string' },
  },
  required: ['value', 'page', 'quote'],
  additionalProperties: false,
};

// Meme forme que citedField -- `value` reste une chaine sur le fil (jamais
// de type number nullable). La distinction "ceci est numerique" vit dans le
// code JS (fixCitedNumber), pas dans le schema envoye au modele.
const citedNumber = {
  type: 'object',
  properties: {
    value: { type: 'string' },
    page: { type: 'integer' },
    quote: { type: 'string' },
  },
  required: ['value', 'page', 'quote'],
  additionalProperties: false,
};

// '' (chaine vide) est la sentinelle d'absence envoyee par le modele --
// jamais null, pour eviter tout champ nullable dans le schema. Ces
// fonctions la reconvertissent en null cote serveur, pour que le reste de
// l'application (deja ecrit avant ce changement) continue de voir null pour
// une valeur absente, exactement comme avec l'ancien schema union.
function fixCitedField(node) {
  if (!node) return node;
  return { ...node, value: node.value === '' ? null : node.value };
}
function fixCitedNumber(node) {
  if (!node) return node;
  if (node.value === '') return { ...node, value: null };
  const n = Number(node.value);
  return { ...node, value: Number.isFinite(n) ? n : null };
}

const FICHE_IDENTITE_FIELDS_1 = [
  'adresse', 'codePostalVille', 'sousMarche', 'typeActif', 'anneeConstruction',
  'anneeRenovation', 'surfacePonderee', 'surfaceUtile', 'surfaceLocativeGLA', 'nombreNiveaux',
  'montantDette', 'fondsPropresProposes', 'tauxHonorairesGestion', 'tauxHonorairesAcquisition', 'tauxDroitsMutation',
];
const FICHE_IDENTITE_FIELDS_2 = [
  'placesParking', 'classeDPE', 'nombreLots', 'tauxOccupation', 'prixDemande',
  'rendementAffiche', 'taxeFonciere', 'chargesCoproPropriete', 'regimeTVA', 'courtierVendeur',
  'triNetAttendu', 'multipleFondsPropresAnnonce', 'cashOnCashAnnonce', 'loyerMarcheReference',
];
// Contexte de la vente (motif, processus, calendrier, historique de
// detention) -- distinct des champs physiques du bien : vocabulaire et
// emplacement dans le document differents (lettre d'introduction / section
// "processus de vente"), d'ou un appel dedie avec son propre guidage.
const FICHE_IDENTITE_FIELDS_3 = ['raisonVente', 'typeProcedure', 'calendrierVente', 'dureeDetention'];
const FICHE_IDENTITE_FIELDS = [...FICHE_IDENTITE_FIELDS_1, ...FICHE_IDENTITE_FIELDS_2, ...FICHE_IDENTITE_FIELDS_3];

function fieldGroupSchema(fields) {
  const properties = {};
  for (const f of fields) properties[f] = citedField;
  return { type: 'object', properties, required: fields, additionalProperties: false };
}

const ETAT_LOCATIF_ROW_FIELDS = [
  'suite', 'locataire', 'activite', 'surfaceSf', 'dateDebutBail', 'dateFinBail',
  'prochaineOptionSortie', 'typeIndexation', 'loyerFacialPsf', 'loyerEconomiquePsf',
  'loyerAnnuel', 'periodeFranchise', 'depotGarantie', 'chargesRecuperablesPct', 'tvaPct', 'statut',
];

// Champs coeur (identite du lot + donnees qui alimentent directement les
// indicateurs calcules : surface, loyers, dates de bail) et champs de
// detail (moins critiques pour les calculs), extraits en deux appels
// distincts pour rester sous la limite de complexite de schema, puis
// fusionnes par numero de lot (suite).
const ETAT_LOCATIF_CORE_FIELDS = ['suite', 'locataire', 'activite', 'statut', 'surfaceSf', 'dateDebutBail', 'dateFinBail', 'loyerFacialPsf', 'loyerEconomiquePsf', 'loyerAnnuel'];
const ETAT_LOCATIF_DETAIL_FIELDS = ['suite', 'prochaineOptionSortie', 'typeIndexation', 'periodeFranchise', 'depotGarantie', 'chargesRecuperablesPct', 'tvaPct', 'clausePlancher'];

const etatLocatifCoreRowSchema = {
  type: 'object',
  properties: {
    suite: { type: 'string' },
    locataire: { type: 'string' },
    activite: { type: 'string' },
    statut: { type: 'string', enum: ['actif', 'echeance_proche', 'maintien_en_place'] },
    surfaceSf: citedNumber,
    dateDebutBail: citedField,
    dateFinBail: citedField,
    loyerFacialPsf: citedNumber,
    loyerEconomiquePsf: citedNumber,
    loyerAnnuel: citedNumber,
  },
  required: ETAT_LOCATIF_CORE_FIELDS,
  additionalProperties: false,
};
const etatLocatifDetailRowSchema = {
  type: 'object',
  properties: {
    suite: { type: 'string' },
    prochaineOptionSortie: citedField,
    typeIndexation: citedField,
    periodeFranchise: citedField,
    depotGarantie: citedField,
    chargesRecuperablesPct: citedNumber,
    tvaPct: citedNumber,
    clausePlancher: citedField,
  },
  required: ETAT_LOCATIF_DETAIL_FIELDS,
  additionalProperties: false,
};

const etatLocatifCoreCallSchema = {
  type: 'object',
  properties: { etatLocatif: { type: 'array', items: etatLocatifCoreRowSchema } },
  required: ['etatLocatif'],
  additionalProperties: false,
};
const etatLocatifDetailCallSchema = {
  type: 'object',
  properties: { etatLocatifDetails: { type: 'array', items: etatLocatifDetailRowSchema } },
  required: ['etatLocatifDetails'],
  additionalProperties: false,
};

// Fusionne les deux extractions par numero de lot (suite) -- cle stable car
// lue directement dans le tableau source par les deux appels. Si les deux
// tableaux ont la meme longueur, sert de filet en cas de suite manquante ou
// dupliquee (meme instruction "dans l'ordre du document" pour les deux
// appels). Un lot du coeur sans correspondance en detail recoit des champs
// vides {value:null} -- jamais une donnee d'un autre lot.
function emptyCitedField() { return { value: null, page: 1, quote: '' }; }
function mergeEtatLocatif(coreRows, detailRows) {
  const bySuite = new Map();
  (detailRows || []).forEach(d => { const key = String(d.suite || '').trim(); if (key) bySuite.set(key, d); });
  const sameLength = (coreRows || []).length === (detailRows || []).length;
  return (coreRows || []).map((row, i) => {
    const detail = bySuite.get(String(row.suite || '').trim()) || (sameLength ? detailRows[i] : null);
    return {
      ...row,
      prochaineOptionSortie: detail?.prochaineOptionSortie ?? emptyCitedField(),
      typeIndexation: detail?.typeIndexation ?? emptyCitedField(),
      periodeFranchise: detail?.periodeFranchise ?? emptyCitedField(),
      depotGarantie: detail?.depotGarantie ?? emptyCitedField(),
      chargesRecuperablesPct: detail?.chargesRecuperablesPct ?? emptyCitedField(),
      tvaPct: detail?.tvaPct ?? emptyCitedField(),
      clausePlancher: detail?.clausePlancher ?? emptyCitedField(),
    };
  });
}

// Vocabulaire aligne sur l'usage des fonds (jamais "Honoraires de gestion"
// seul : property management et asset management sont deux postes
// distincts que les fonds ne confondent jamais ; jamais "Entretien et
// reparations" seul non plus : entretien courant et GER -- gros entretien
// et renouvellement -- repondent a des logiques comptables differentes,
// capex vs opex). Les 4 premiers postes sont des REVENUS (voir
// REVENUE_ITEMS dans indicators.js, liste fermee) ; tous les autres sont
// traites comme des CHARGES quel que soit leur libellé exact (voir
// computeT12Totals) -- ajouter un poste de charge ici n'exige donc aucune
// autre synchronisation.
const T12_LINE_ITEMS = [
  'Revenus locatifs de base', 'Refacturations de charges', 'Autres revenus',
  'Vacance et pertes de créances', 'Taxes foncières', 'Assurance',
  'Charges communes / fluides', 'Charges non récupérables sur locaux vacants',
  'Honoraires de property management', "Honoraires d'asset management",
  'Entretien courant', 'GER (gros entretien et renouvellement)',
];

const callBSchema = {
  type: 'object',
  properties: {
    t12: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lineItem: { type: 'string', enum: T12_LINE_ITEMS },
          montant: citedNumber,
        },
        required: ['lineItem', 'montant'],
        additionalProperties: false,
      },
    },
  },
  required: ['t12'],
  additionalProperties: false,
};

const SYSTEM_A = "Tu es un extracteur de donnees immobilieres. Pour CHAQUE champ demande, tu dois fournir : la valeur, le numero de page (1-indexe, dans le PDF fourni) ou elle apparait, et une citation VERBATIM tiree mot pour mot du texte du document et qui contient cette valeur. N'invente jamais une valeur que tu ne peux pas citer precisement a l'endroit indique. Le champ value est TOUJOURS une chaine de caracteres : pour un champ numerique (surface, loyer, montant, pourcentage, annee), ecris uniquement le nombre en texte, avec un point decimal si besoin et un signe moins pour une valeur negative, sans separateur de milliers ni symbole (ex: '452300.5', '-119000', '12'). Si une information est absente du document, mets value a une chaine vide '' (jamais le mot null) et laisse quote vide, et indique page: 1 par defaut. Ne resume pas et ne reformule pas les citations : copie le texte source tel quel.";

const SYSTEM_A_RENTROLL = SYSTEM_A + " L'etat locatif doit couvrir TOUS les locataires/lots presents dans le document, sans en omettre. Pour dateFinBail : cherche ACTIVEMENT une date d'echeance, d'expiration, de terme ou de fin de bail -- ces informations apparaissent sous des libelles varies ('echeance', 'expiration', 'terme du bail', 'fin de bail', 'date de fin', 'jusqu''au', 'expiry date', 'lease end') et pas seulement dans la colonne dediee d'un tableau recapitulatif : elles peuvent figurer dans une clause narrative du bail, une annexe ou une note de bas de page -- lis ces sections avec la meme attention que le tableau principal. Si le document donne uniquement une duree de bail et une date de prise d'effet SANS indiquer explicitement de date de fin dans le texte, ne calcule et n'invente JAMAIS cette date de fin : laisse value a une chaine vide. Pour prochaineOptionSortie : cherche activement une date de break, d'option de sortie anticipee, ou une mention de structure de bail '3/6/9' (bail commercial francais avec option de sortie triennale) -- si une date de prochaine echeance triennale est explicitement donnee dans le texte (meme dans une phrase narrative, pas seulement un tableau), cite-la precisement. Pour clausePlancher : cherche si le bail mentionne explicitement une clause plancher (floor), une clause de securisation de l'indexation, ou une garantie de non-baisse du loyer indexe -- si le document n'aborde pas du tout ce sujet pour ce bail, laisse value a une chaine vide (ne conclus jamais a son absence : signale seulement ce qui est explicitement ecrit).";

const SYSTEM_B = "Tu es un extracteur de donnees financieres immobilieres, specialise dans les comptes de resultat de memorandums de vente. Le document peut presenter les revenus et charges de deux facons differentes : (1) un compte de resultat glissant sur les douze derniers mois reels (parfois appele 'T-12' ou 'trailing twelve months'), ou (2) un tableau pro forma previsionnel avec PLUSIEURS colonnes, une par annee de detention (souvent intitulees 'Annee 1', 'An 1', 'Year 1', etc., a droite d'une colonne de reference ou 'in-place'). Si le document presente un tableau a plusieurs colonnes d'annees, extrais TOUJOURS la colonne 'Annee 1' / 'An 1' (la premiere annee de detention, generalement la plus proche du T-12 reel) -- jamais une annee ulterieure, jamais une moyenne. Recherche activement ces donnees meme si le tableau n'est pas litteralement intitule 'T-12' : des intitules comme 'Compte d'exploitation', 'Pro forma', 'Revenus et depenses previsionnels', 'Compte de resultat' ou 'Income statement' contiennent generalement les memes informations. Pour chaque poste demande, fournis le montant de cette colonne, le numero de page ou il apparait, et une citation VERBATIM du texte source (copie la citation telle qu'elle apparait, y compris si le montant est ecrit entre parentheses selon la convention comptable -- '(119 000 €)' signifie -119000 : indique alors la VALEUR numerique avec le signe negatif correct, mais la CITATION doit rester le texte source exact, parentheses comprises). Les postes de charges et la vacance/pertes de creances doivent etre retournes en valeurs NEGATIVES, les revenus en valeurs POSITIVES -- reprends le signe du document s'il est explicite, sinon applique cette convention. Le champ value est une chaine de caracteres representant uniquement le nombre (jamais un nombre JSON), par exemple '-119000' ou '452300.5', sans separateur de milliers ni symbole monetaire. Si un poste est reellement absent du document (aucune colonne ne le mentionne), mets value a une chaine vide '' (jamais le mot null).";

const callCSchema = {
  type: 'object',
  properties: {
    locatairesRisque: {
      type: 'array',
      items: {
        type: 'object',
        properties: { locataire: { type: 'string' }, mention: citedField },
        required: ['locataire', 'mention'],
        additionalProperties: false,
      },
    },
    capexTechniques: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sujet: { type: 'string' },
          montantEstime: citedNumber,
          echeance: citedField,
          mention: citedField,
        },
        required: ['sujet', 'montantEstime', 'echeance', 'mention'],
        additionalProperties: false,
      },
    },
  },
  required: ['locatairesRisque', 'capexTechniques'],
  additionalProperties: false,
};

const SYSTEM_C = "Tu es un analyste qui repere des signaux de risque explicitement mentionnes dans un memorandum de vente immobilier. Deux categories : (1) locatairesRisque -- locataires pour lesquels le document mentionne explicitement une procedure collective, un redressement judiciaire, une liquidation, ou des difficultes financieres avouees ; (2) capexTechniques -- travaux ou remplacements techniques mentionnes dans le document (toiture, CVC, ravalement, mise aux normes, etc.) qui ne semblent pas deja provisionnes. Pour CHAQUE element, fournis une citation VERBATIM du texte source et le numero de page, exactement comme pour les autres extractions. N'invente RIEN : si aucun locataire a risque n'est mentionne, renvoie un tableau locatairesRisque vide. Si aucun CAPEX technique n'est mentionne, renvoie un tableau capexTechniques vide. Ne deduis pas une difficulte financiere ou un besoin de travaux a partir d'un indice indirect -- seulement si le document le dit explicitement. Le champ value de montantEstime est une chaine de caracteres representant uniquement le nombre (ex: '25000'), sans separateur ni symbole. Si le montant ou l'echeance d'un CAPEX n'est pas precise dans le texte, mets value a une chaine vide '' (jamais le mot null) et laisse quote vide, page 1 par defaut pour ce champ precis.";

function pdfDocumentBlock(pdfBase64) {
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } };
}

// withRetry() ne reessaie que les erreurs transitoires (429/5xx/reseau) --
// point de passage unique de toutes les extractions (extractFicheEtLocatif,
// extractT12, extractSignaux, extractContexteNarratif, extractVendorClaims),
// donc ce seul wrapper couvre l'ensemble du pipeline.
async function runExtraction({ pdfBase64, schema, systemPrompt, userText, maxTokens }) {
  const message = await withRetry(async () => {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{
        role: 'user',
        content: [pdfDocumentBlock(pdfBase64), { type: 'text', text: userText }],
      }],
    });
    return stream.finalMessage();
  });
  if (message.stop_reason === 'refusal') {
    throw new Error('Le modele a refuse cette requete (stop_reason=refusal).');
  }
  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error(`Aucune reponse structuree du modele (stop_reason=${message.stop_reason}).`);
  }
  return JSON.parse(textBlock.text);
}

// Reconvertit les resultats bruts de l'API (value toujours string, '' pour
// absent) vers la forme attendue par le reste de l'application (value:
// string|number|null). Chaque fonction connait, champ par champ, si la
// valeur d'origine etait citedField (texte) ou citedNumber (numerique) --
// cette connaissance vivait avant dans le schema JSON (union de type),
// elle vit maintenant ici.
function fixFicheGroup(group) {
  const out = {};
  for (const k of Object.keys(group)) out[k] = fixCitedField(group[k]);
  return out;
}
function fixEtatLocatifCoreRow(row) {
  return {
    ...row,
    dateDebutBail: fixCitedField(row.dateDebutBail),
    dateFinBail: fixCitedField(row.dateFinBail),
    surfaceSf: fixCitedNumber(row.surfaceSf),
    loyerFacialPsf: fixCitedNumber(row.loyerFacialPsf),
    loyerEconomiquePsf: fixCitedNumber(row.loyerEconomiquePsf),
    loyerAnnuel: fixCitedNumber(row.loyerAnnuel),
  };
}
function fixEtatLocatifDetailRow(row) {
  return {
    ...row,
    prochaineOptionSortie: fixCitedField(row.prochaineOptionSortie),
    typeIndexation: fixCitedField(row.typeIndexation),
    periodeFranchise: fixCitedField(row.periodeFranchise),
    depotGarantie: fixCitedField(row.depotGarantie),
    chargesRecuperablesPct: fixCitedNumber(row.chargesRecuperablesPct),
    tvaPct: fixCitedNumber(row.tvaPct),
    clausePlancher: fixCitedField(row.clausePlancher),
  };
}

async function extractFicheEtLocatif(pdfBase64) {
  const [group1, group2, group3, rentrollCore, rentrollDetail] = await Promise.all([
    runExtraction({
      pdfBase64,
      schema: fieldGroupSchema(FICHE_IDENTITE_FIELDS_1),
      systemPrompt: SYSTEM_A,
      userText: `Extrais les champs suivants de ce memorandum de vente : ${FICHE_IDENTITE_FIELDS_1.join(', ')}. La plupart figurent dans la fiche technique du bien, mais montantDette, fondsPropresProposes, tauxHonorairesGestion, tauxHonorairesAcquisition et tauxDroitsMutation se trouvent generalement dans une page distincte de structure de financement, "emplois et ressources" ou "sources and uses" -- cherche-les specifiquement la si absents de la fiche technique.`,
      maxTokens: 4096,
    }),
    runExtraction({
      pdfBase64,
      schema: fieldGroupSchema(FICHE_IDENTITE_FIELDS_2),
      systemPrompt: SYSTEM_A,
      userText: `Extrais les champs suivants de ce memorandum de vente : ${FICHE_IDENTITE_FIELDS_2.join(', ')}. La plupart figurent dans la fiche technique du bien, mais triNetAttendu, multipleFondsPropresAnnonce et cashOnCashAnnonce se trouvent generalement dans une synthese de l'investissement ou un encadre de rendement, pas dans la description physique du bien. Ce sont des chiffres ANNONCES PAR LE VENDEUR : extrais-les tels quels avec leur citation exacte, sans les recalculer ni les corriger. Pour loyerMarcheReference : cherche UNIQUEMENT si le document lui-meme mentionne un loyer de marche estime (par exemple par un expert, un evaluateur ou une etude de marche citee dans le memorandum) -- si cette donnee n'est mentionnee nulle part dans le document, laisse value a une chaine vide ; ne cherche jamais cette information en dehors du texte fourni et n'estime jamais toi-meme un loyer de marche.`,
      maxTokens: 4096,
    }),
    runExtraction({
      pdfBase64,
      schema: fieldGroupSchema(FICHE_IDENTITE_FIELDS_3),
      systemPrompt: SYSTEM_A,
      userText: `Extrais les champs suivants concernant le CONTEXTE DE LA VENTE de ce memorandum (pas la description physique du bien) : ${FICHE_IDENTITE_FIELDS_3.join(', ')}. Ces informations se trouvent generalement dans l'introduction, la lettre du vendeur/courtier, ou une section "processus de vente" / "opportunite d'investissement" du document. raisonVente : le motif explicitement donne par le vendeur pour la mise en vente (ex : arbitrage patrimonial, reorganisation de portefeuille, fin de vie du fonds). typeProcedure : la nature du processus de vente si mentionnee (gre a gre, procedure structuree, encheres). calendrierVente : les dates cles explicitement annoncees pour la vente (date limite de remise des offres indicatives ou fermes, date de signature/closing envisagee) -- regroupe-les dans une seule citation si elles apparaissent ensemble. dureeDetention : la duree ou l'annee d'acquisition du bien par le vendeur actuel, si mentionnee. N'invente rien : si une de ces informations n'est pas explicitement donnee dans le document, laisse value a une chaine vide.`,
      maxTokens: 4096,
    }),
    runExtraction({
      pdfBase64,
      schema: etatLocatifCoreCallSchema,
      systemPrompt: SYSTEM_A_RENTROLL,
      userText: "Extrais l'integralite de l'etat locatif (tous les locataires/lots, dans l'ordre du document, sans en omettre) de ce memorandum de vente : numero de lot, locataire, activite, statut, surface, dates de bail, loyers facial et economique.",
      maxTokens: 16000,
    }),
    runExtraction({
      pdfBase64,
      schema: etatLocatifDetailCallSchema,
      systemPrompt: SYSTEM_A_RENTROLL,
      userText: "Extrais, pour l'integralite des locataires/lots de l'etat locatif (dans le meme ordre que le tableau, sans en omettre) de ce memorandum de vente, le numero de lot (suite, identique a celui du tableau) et : prochaine option de sortie, type d'indexation, periode de franchise, depot de garantie, charges recuperables, TVA.",
      maxTokens: 12000,
    }),
  ]);
  const ficheIdentite = fixFicheGroup({ ...group1, ...group2, ...group3 });
  const coreRows = (rentrollCore.etatLocatif || []).map(fixEtatLocatifCoreRow);
  const detailRows = (rentrollDetail.etatLocatifDetails || []).map(fixEtatLocatifDetailRow);
  return { ficheIdentite, etatLocatif: mergeEtatLocatif(coreRows, detailRows) };
}

async function extractT12(pdfBase64) {
  const result = await runExtraction({
    pdfBase64,
    schema: callBSchema,
    systemPrompt: SYSTEM_B,
    userText: `Extrais les postes suivants du compte de resultat de ce memorandum de vente (colonne "Annee 1" / premiere annee si le tableau presente plusieurs colonnes d'annees) : ${T12_LINE_ITEMS.join(', ')}. Cherche ce tableau meme s'il n'est pas intitule "T-12" -- "Pro forma", "Compte d'exploitation" ou equivalent contiennent generalement les memes postes. Si le document ne mentionne qu'un honoraire de gestion global (sans distinguer property et asset management), classe-le en "Honoraires de property management" par defaut. Si le document ne distingue pas entretien courant et GER, classe la depense en "Entretien courant" par defaut.`,
    maxTokens: 4096,
  });
  return { t12: (result.t12 || []).map(row => ({ ...row, montant: fixCitedNumber(row.montant) })) };
}

async function extractSignaux(pdfBase64) {
  const result = await runExtraction({
    pdfBase64,
    schema: callCSchema,
    systemPrompt: SYSTEM_C,
    userText: "Repere dans ce memorandum de vente les mentions explicites de locataires en difficulte financiere et de travaux techniques (CAPEX) non provisionnes. Renvoie des tableaux vides si aucune mention reelle n'existe.",
    maxTokens: 4096,
  });
  return {
    locatairesRisque: (result.locatairesRisque || []).map(row => ({ ...row, mention: fixCitedField(row.mention) })),
    capexTechniques: (result.capexTechniques || []).map(row => ({
      ...row,
      montantEstime: fixCitedNumber(row.montantEstime),
      echeance: fixCitedField(row.echeance),
      mention: fixCitedField(row.mention),
    })),
  };
}

// ================= Onglet "Contexte" : paragraphes narratifs cites ================= //
// Different des citedField/citedNumber ci-dessus : ici `paragraphe` est une
// SYNTHESE redigee par le modele (plusieurs phrases), pas une valeur courte
// censee apparaitre verbatim dans une citation unique. La verite factuelle
// repose sur `citations` (extraits verbatim reels, verifies un par un cote
// serveur -- voir verification.js#verifyContexteNarratif) : le paragraphe
// lui-meme n'est jamais presente comme "verifie mot pour mot", seulement
// comme une synthese appuyee sur des citations reelles et verifiables.
// Schema volontairement plat (pas d'union/nullable) : memes lecons que le
// reste du fichier.
const CONTEXTE_THEMES = ['motifVente', 'processusVente', 'historiqueDetention', 'profilAcquereur'];
const CONTEXTE_THEME_LABELS = {
  motifVente: 'Motif et contexte de la cession',
  processusVente: 'Processus et calendrier de vente',
  historiqueDetention: "Historique de détention et positionnement de l'actif",
  profilAcquereur: "Profil d'acquéreur recherché",
};

const contexteCitationSchema = {
  type: 'object',
  properties: { page: { type: 'integer' }, quote: { type: 'string' } },
  required: ['page', 'quote'],
  additionalProperties: false,
};
const contexteThemeSchema = {
  type: 'object',
  properties: {
    paragraphe: { type: 'string' },
    citations: { type: 'array', items: contexteCitationSchema },
  },
  required: ['paragraphe', 'citations'],
  additionalProperties: false,
};
const contexteNarratifSchema = {
  type: 'object',
  properties: Object.fromEntries(CONTEXTE_THEMES.map(t => [t, contexteThemeSchema])),
  required: CONTEXTE_THEMES,
  additionalProperties: false,
};

const SYSTEM_D = "Tu es un analyste immobilier qui redige une synthese du CONTEXTE DE LA VENTE d'un memorandum de vente (OM), pour aider un comite d'investissement a comprendre rapidement pourquoi et comment ce bien est mis en vente. Pour CHAQUE theme demande, redige un paragraphe de 3 a 6 phrases en francais, factuel et sobre, qui synthetise UNIQUEMENT ce que le document dit reellement sur ce theme -- n'ajoute aucune information, supposition ou opinion qui ne soit pas explicitement presente dans le texte. Si le document n'aborde pas du tout un theme, ecris exactement 'Non abordé dans le document.' comme paragraphe et renvoie un tableau citations vide -- ne comble jamais un theme absent par une deduction ou une generalite. Pour chaque theme non vide, fournis 1 a 4 citations : des extraits VERBATIM (copies mot pour mot, jamais reformules) du texte source qui appuient reellement ce que tu as ecrit dans le paragraphe, avec le numero de page (1-indexe) ou chacun apparait. N'invente jamais une citation que tu ne peux pas localiser precisement dans le document.";

function verifiedCitationSentinel(theme) {
  return { paragraphe: String(theme?.paragraphe || ''), citations: Array.isArray(theme?.citations) ? theme.citations : [] };
}

async function extractContexteNarratif(pdfBase64) {
  const themesDesc = CONTEXTE_THEMES.map(t => `${t} (${CONTEXTE_THEME_LABELS[t]})`).join(', ');
  const result = await runExtraction({
    pdfBase64,
    schema: contexteNarratifSchema,
    systemPrompt: SYSTEM_D,
    userText: `Redige la synthese du contexte de vente de ce memorandum pour les themes suivants : ${themesDesc}.`,
    maxTokens: 6000,
  });
  const out = {};
  for (const t of CONTEXTE_THEMES) out[t] = verifiedCitationSentinel(result[t]);
  return out;
}

// ================= Onglet "Vérification" : affirmations marketing du vendeur ================= //
// Different des champs physiques/financiers de la fiche d'identite (deja
// couverts par FICHE_IDENTITE_FIELDS) : ici on cible les affirmations
// QUALITATIVES du vendeur -- "quartier en forte croissance", "demande
// locative soutenue" -- que le verificateur va ensuite confronter a une
// vraie recherche web (vendorClaimsVerifier.js). Contrat de citation STRICT,
// comme dealChat.js (pas comme le Contexte narratif ci-dessus) : ici la
// citation EST l'affirmation, donc une affirmation dont la citation ne se
// retrouve pas verbatim dans le document est entierement rejetee, jamais
// gardee comme "synthese approximative" (voir verifyVendorClaims dans
// verification.js).
const vendorClaimItemSchema = {
  type: 'object',
  properties: {
    theme: { type: 'string' },
    claimText: { type: 'string' },
    page: { type: 'integer' },
    quote: { type: 'string' },
  },
  required: ['theme', 'claimText', 'page', 'quote'],
  additionalProperties: false,
};
const vendorClaimsSchema = {
  type: 'object',
  properties: { claims: { type: 'array', items: vendorClaimItemSchema } },
  required: ['claims'],
  additionalProperties: false,
};

const MAX_VENDOR_CLAIMS = 12;

const SYSTEM_E = "Tu es un analyste immobilier qui repere, dans un memorandum de vente (OM), les affirmations MARKETING ou QUALITATIVES du vendeur qui meritent d'etre verifiees aupres de sources externes independantes -- par exemple sur la croissance du marche local, la demande locative, l'attractivite du quartier, des projets d'amenagement annonces, ou le positionnement concurrentiel du bien. NE repere PAS les donnees physiques ou financieres deja chiffrees precisement (surface, prix, loyer, DPE, annee de construction : ce sont des champs structures extraits ailleurs, pas des affirmations a verifier ici). Pour chaque affirmation : `theme` est un court intitule (ex. 'Croissance du marche locatif'), `claimText` est une reformulation neutre et courte de l'affirmation (une phrase, sans le ton commercial du vendeur), `quote` est une citation VERBATIM (copiee mot pour mot) du passage exact du document qui porte cette affirmation, et `page` son numero de page (1-indexe). Limite-toi aux 12 affirmations les plus significatives pour une decision d'investissement -- pas une liste exhaustive de chaque adjectif optimiste du document. N'invente aucune affirmation : si le document ne contient aucune affirmation qualitative verifiable de ce type, renvoie un tableau claims vide.";

async function extractVendorClaims(pdfBase64) {
  const result = await runExtraction({
    pdfBase64,
    schema: vendorClaimsSchema,
    systemPrompt: SYSTEM_E,
    userText: "Repere les affirmations marketing/qualitatives verifiables de ce memorandum de vente, avec une citation exacte et son numero de page pour chacune.",
    maxTokens: 4096,
  });
  const claims = Array.isArray(result.claims) ? result.claims : [];
  return { claims: claims.slice(0, MAX_VENDOR_CLAIMS) };
}

module.exports = {
  extractFicheEtLocatif, extractT12, extractSignaux, extractContexteNarratif, extractVendorClaims,
  FICHE_IDENTITE_FIELDS, T12_LINE_ITEMS, CONTEXTE_THEMES, CONTEXTE_THEME_LABELS,
};
