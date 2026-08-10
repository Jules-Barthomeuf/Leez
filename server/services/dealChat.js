// Assistant conversationnel qui repond aux questions de l'analyste sur LE
// DOSSIER OUVERT -- a partir du texte reel deja extrait (pages_json, stocke
// en base depuis le pipeline d'extraction) -- et, en complement, sur la
// base de connaissances juridique/financiere (RAG, voir kbSearch.js).
// Jamais sur les connaissances generales du modele.
//
// Meme garde-fou que partout ailleurs dans ce projet : chaque affirmation
// doit citer une source reelle, VERIFIEE apres coup -- une citation
// "dossier" est relocalisee dans le texte reel de la page via locateQuote
// (meme mecanisme que verification.js), une citation "connaissances" doit
// correspondre a une reference reellement envoyee au modele (refId). Toute
// citation qui ne verifie pas est retiree plutot que gardee -- "une fausse
// citation est pire qu'aucune citation".
const Anthropic = require('@anthropic-ai/sdk');
const { locateQuote } = require('./verification');
const { search } = require('./kbSearch');
const { computeMandateFit } = require('./interpretation');

const client = new Anthropic();
const MODEL = 'claude-opus-5';

const answerSchema = {
  type: 'object',
  properties: {
    // Classification d'intention (meme patron que promptSim.js) : le modele
    // choisit UNIQUEMENT quelle action declencher, jamais ne l'execute --
    // c'est le client qui appelle la vraie fonction deterministe deja
    // construite (generation du deck / verrouillage du simulateur).
    action: { type: 'string', enum: ['generate_presentation', 'lock_simulation', 'none'] },
    supported: { type: 'boolean' },
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          // 'dossier' : reponse appuyee sur le texte reel du document ouvert
          //   (remplir page + quote, laisser refId='').
          // 'connaissances' : reponse appuyee sur la base de connaissances
          //   juridique/financiere (remplir refId, laisser page=0, quote='').
          // 'general' : conversation normale (salutation, explication
          //   generale, brainstorming) -- JAMAIS pour une affirmation
          //   specifique sur CE dossier, qui doit toujours passer par
          //   'dossier' ou 'connaissances' avec une source verifiable.
          // 'criteres' : reponse appuyee sur les criteres d'investissement du
          //   fonds (reglages) et/ou le calcul de conformite a ces criteres,
          //   tous deux deja fournis ci-dessous -- jamais une conformite
          //   recalculee/estimee par le modele lui-meme. page=0, quote='', refId=''.
          // 'image' : reponse basee sur l'image jointe par l'analyste a cette
          //   question (visible dans le message ci-dessus) -- reservee aux
          //   affirmations qui decrivent reellement ce qui est visible dans
          //   l'image. page=0, quote='', refId=''.
          // 'none' : pas de source individuelle pour ce paragraphe (rare --
          //   reserve a une phrase de transition, pas a une affirmation).
          sourceType: { type: 'string', enum: ['dossier', 'connaissances', 'general', 'criteres', 'image', 'none'] },
          page: { type: 'integer' },
          quote: { type: 'string' },
          refId: { type: 'string' },
        },
        required: ['text', 'sourceType', 'page', 'quote', 'refId'],
        additionalProperties: false,
      },
    },
    caveat: { type: 'string' },
  },
  required: ['action', 'supported', 'paragraphs', 'caveat'],
  additionalProperties: false,
};

const SYSTEM_PROMPT_ASK = `Tu es l'assistant d'un outil d'analyse immobiliere, pour le dossier actuellement ouvert. Tu peux repondre a des questions ET declencher deux actions precises -- jamais d'autre action, jamais de calcul ou de recalcul toi-meme.

ETAPE 1 -- decide d'abord si le message est une demande d'action claire :
- "generate_presentation" : l'analyste demande explicitement de generer/ouvrir/creer la presentation comite pour ce dossier (ex: "genere la presentation", "montre-moi le deck du projet"). Remplis alors "paragraphs" avec UN seul paragraphe court de confirmation (ex: "Je genere la presentation du dossier."), sourceType='general', page=0, quote='', refId=''. supported=true, caveat=''.
- "lock_simulation" : l'analyste demande explicitement de verrouiller/figer le simulateur pour la presentation (ex: "verrouille le simulateur", "fige les hypotheses pour le comite"). Meme traitement : un paragraphe court de confirmation, sourceType='general'.
- Sinon : action='none', et passe a l'etape 2.

ETAPE 2 (si action='none') -- reponds normalement, comme un assistant conversationnel qui connait ce dossier :
- Si la question porte sur UNE DONNEE SPECIFIQUE de CE dossier (baux, T-12, surfaces, clauses, chiffres...) : sourceType='dossier', page=le numero de page exact, quote=une citation VERBATIM (copiee mot pour mot, jamais reformulee) du passage precis. refId=''. Jamais de 'general' pour ce type d'affirmation.
- Si la question porte sur le savoir juridique/financier de reference (base de connaissances fournie) : sourceType='connaissances', refId=l'identifiant EXACT (REF1, REF2...) de la reference utilisee -- n'invente jamais un refId absent de la liste fournie. page=0, quote=''.
- Si la question porte sur les CRITERES D'INVESTISSEMENT DU FONDS (taille, typologie, localisation, rendement cible) ou sur la conformite de CE dossier a ces criteres ("est-ce que ce deal correspond a nos criteres ?", "conforme a nos criteres d'investissement ?") : sourceType='criteres'. Le bloc CRITERES D'INVESTISSEMENT DU FONDS ci-dessous te donne les reglages actuels et, si un dossier est ouvert, un verdict de conformite DEJA CALCULE par le code (jamais par toi) -- reformule-le fidelement, ne recalcule et n'estime JAMAIS toi-meme si un chiffre respecte un seuil. N'utilise jamais le mot "mandat" pour designer ces criteres (parle de "criteres d'investissement" ou de "criteres du fonds"). Si aucun critere n'est configure dans les reglages, dis-le clairement (et mets supported=false si c'est le coeur de la question) plutot que d'improviser une appreciation. page=0, quote='', refId=''.
- Si une image est jointe au message (voir plus bas) et que la question porte sur cette image (ce qu'elle montre, ce qu'elle represente) : sourceType='image' pour les affirmations qui decrivent reellement ce que tu vois dans l'image -- decris uniquement ce qui est visible, n'invente jamais un detail que l'image ne montre pas clairement. page=0, quote='', refId=''.
- Si la question est une conversation normale (salutation, question generale sur l'outil, brainstorming, explication qui ne porte pas sur un chiffre ou une clause specifique de ce dossier) : sourceType='general', reponds avec tes connaissances generales, page=0, quote='', refId=''.
- Si tu combines plusieurs sources, decoupe la reponse en plusieurs paragraphes, un par source.
- Si une question factuelle sur CE dossier ou sur le savoir de reference ne peut pas etre repondue avec certitude (information absente, hors sujet), dis-le clairement dans "caveat" et mets supported=false -- ne complete JAMAIS par une supposition presentee comme un fait sur le dossier. Si supported=true, "caveat" reste une chaine vide sauf reserve importante a signaler (donnee partielle, ambigue, etc.).`;

function buildDossierBlock(pages) {
  if (!pages || pages.length === 0) return 'Texte du document non disponible.';
  return pages.map(p => `[PAGE ${p.pageNumber}]\n${p.text || ''}`).join('\n\n');
}

function buildKbBlock(chunks) {
  if (!chunks.length) return 'Aucune reference disponible dans la base de connaissances pour cette question.';
  return chunks.map((c, i) => {
    const pages = c.page_start === c.page_end ? `page ${c.page_start}` : `pages ${c.page_start}-${c.page_end}`;
    return `[REF${i + 1}] Source : ${c.source_file} -- Section : "${c.section_title}" (${c.theme}, ${pages})\n"""\n${c.content}\n"""`;
  }).join('\n\n');
}

const MANDATE_VERDICT_LABELS = { conforme: 'Conforme aux critères', a_examiner: 'Écart à examiner', hors_mandat: 'Hors critères' };

// Meme logique que le reglages du fonds (fund_criteria, voir routes/settings.js)
// et le calcul deterministe deja utilise par l'Audit (computeMandateFit,
// interpretation.js) -- jamais recalcule ici, seulement reformule au modele
// pour qu'il puisse repondre a une question de conformite sans l'inventer.
function buildFundCriteriaBlock(fundCriteria, mandateFit) {
  const hasCriteria = fundCriteria && (
    fundCriteria.tailleMin != null || fundCriteria.tailleMax != null ||
    (fundCriteria.typologies && fundCriteria.typologies.length) ||
    fundCriteria.localisation || fundCriteria.rendementCibleMin != null
  );
  if (!hasCriteria) {
    return `=== CRITERES D'INVESTISSEMENT DU FONDS (reglages) ===\nAucun critere d'investissement n'est configure pour le moment (menu "Réglages du fonds").`;
  }
  const lines = [];
  if (fundCriteria.tailleMin != null || fundCriteria.tailleMax != null) {
    const min = fundCriteria.tailleMin != null ? `${fundCriteria.tailleMin.toLocaleString('fr-FR')} €` : 'pas de minimum';
    const max = fundCriteria.tailleMax != null ? `${fundCriteria.tailleMax.toLocaleString('fr-FR')} €` : 'pas de maximum';
    lines.push(`Taille de deal visée : de ${min} à ${max}`);
  }
  if (fundCriteria.typologies && fundCriteria.typologies.length) lines.push(`Typologies visées : ${fundCriteria.typologies.join(', ')}`);
  if (fundCriteria.localisation) lines.push(`Localisation ciblée : ${fundCriteria.localisation}`);
  if (fundCriteria.rendementCibleMin != null) lines.push(`Rendement cible minimum : ${fundCriteria.rendementCibleMin} %`);
  let block = `=== CRITERES D'INVESTISSEMENT DU FONDS (reglages) ===\n${lines.join('\n')}`;
  if (mandateFit && mandateFit.configured) {
    const verdictLabel = MANDATE_VERDICT_LABELS[mandateFit.verdict] || mandateFit.verdict;
    const detail = mandateFit.criteria.map(c => `- ${c.label} : ${c.detail} -> ${c.status}`).join('\n');
    block += `\n\n=== CONFORMITE DE CE DOSSIER AUX CRITERES D'INVESTISSEMENT (deja calculee par le code, NE JAMAIS recalculer) ===\nVerdict global : ${verdictLabel}\n${detail}`;
  }
  return block;
}

async function askAboutDossier({ doc, question, fundCriteria, image }) {
  // doc peut etre null : l'Assistant est desormais global (ecran d'accueil),
  // le dossier est optionnel (selecteur cote client). Sans dossier, la
  // conversation generale/KB/actions restent disponibles, mais toute
  // affirmation specifique a "ce dossier" doit rester impossible -- le
  // bloc ci-dessous le dit explicitement au modele plutot que de laisser un
  // champ vide ambigu.
  const pages = doc ? (doc.pages_json || []) : [];
  const kbChunks = await search(question, 4).catch(() => []);
  const kbRefMap = new Map(kbChunks.map((c, i) => [`REF${i + 1}`, c]));

  const dossierHeader = doc
    ? `=== TEXTE REEL DU DOSSIER "${doc.filename}" (pages numerotees) ===\n${buildDossierBlock(pages)}`
    : `=== AUCUN DOSSIER SELECTIONNE ===\nL'analyste n'a selectionne aucun dossier precis. Si sa question porte sur un dossier specifique (baux, chiffres, clauses...), tu ne peux PAS y repondre avec sourceType='dossier' -- dis-le dans "caveat" et invite-le a selectionner un dossier dans le menu deroulant, mets supported=false pour ce cas.`;

  // Meme calcul deterministe que l'Audit (computeMandateFit) -- jamais
  // refait par le modele, seulement mis a sa disposition tel quel.
  const mandateFit = (doc && fundCriteria)
    ? computeMandateFit({ ficheIdentite: doc.fiche_identite_json, indicateurs: doc.indicateurs_json }, fundCriteria)
    : null;
  const criteriaBlock = buildFundCriteriaBlock(fundCriteria, mandateFit);

  const imageNote = image ? "\n\n=== IMAGE JOINTE PAR L'ANALYSTE A CETTE QUESTION ===\nUne image est attachee a ce message (voir le bloc image ci-joint) -- si la question s'y rapporte, decris uniquement ce qui y est reellement visible (sourceType='image')." : '';
  const userText = `Question de l'analyste : "${question}"\n\n${dossierHeader}\n\n${criteriaBlock}\n\n=== BASE DE CONNAISSANCES JURIDIQUE/FINANCIERE (complement, si pertinent) ===\n${buildKbBlock(kbChunks)}${imageNote}`;

  // Image jointe : bloc 'image' AVANT le texte (convention Anthropic), jamais
  // stockee ni relue ensuite -- elle ne sert qu'a cette reponse, contrairement
  // aux citations 'dossier'/'connaissances' qui doivent survivre a la
  // verification post-hoc plus bas.
  const userContent = image
    ? [{ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } }, { type: 'text', text: userText }]
    : userText;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 3072,
    system: SYSTEM_PROMPT_ASK,
    output_config: { format: { type: 'json_schema', schema: answerSchema } },
    messages: [{ role: 'user', content: userContent }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('Le modele a refuse la requete (stop_reason=refusal).');
  }
  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error(`Aucune reponse structuree du modele (stop_reason=${message.stop_reason}).`);
  }
  const raw = JSON.parse(textBlock.text);

  // Verification post-hoc : une citation "dossier" doit se retrouver
  // reellement dans le texte de la page annoncee ; une citation
  // "connaissances" doit correspondre a une reference reellement envoyee.
  const paragraphs = [];
  for (const p of raw.paragraphs || []) {
    if (p.sourceType === 'dossier') {
      const page = pages.find(pg => pg.pageNumber === p.page);
      if (!page) continue;
      const located = locateQuote(p.quote, page.text || '');
      if (!located) continue;
      paragraphs.push({ text: p.text, sourceType: 'dossier', page: p.page, quote: p.quote });
    } else if (p.sourceType === 'connaissances') {
      const c = kbRefMap.get(p.refId);
      if (!c) continue;
      paragraphs.push({ text: p.text, sourceType: 'connaissances', sourceFile: c.source_file, sourceSection: c.section_title, page: c.page_start });
    }
    // 'general' : conversation normale, rien a verifier (ni citation dossier
    // ni refId KB) -- conservee telle quelle, jamais utilisee par le modele
    // pour une affirmation specifique sur ce dossier (regle du prompt).
    else if (p.sourceType === 'general' && p.text) {
      paragraphs.push({ text: p.text, sourceType: 'general' });
    }
    // 'criteres' : rien a fuzzy-matcher (ce n'est pas une citation dans un
    // texte source) -- la donnee de confiance est le bloc CRITERES
    // D'INVESTISSEMENT/CONFORMITE deja calcule en JS et fourni au modele,
    // meme logique de confiance que pour 'connaissances' (on verifie que la
    // source existait reellement, pas chaque mot du paragraphe).
    else if (p.sourceType === 'criteres' && p.text) {
      paragraphs.push({ text: p.text, sourceType: 'criteres' });
    }
    // 'image' : rien a fuzzy-matcher (ce n'est pas une citation textuelle) --
    // la preuve est l'image elle-meme, deja visible dans la bulle de
    // l'analyste au-dessus. Uniquement si une image a reellement ete jointe
    // (sinon le modele ne peut pas legitimement avoir invente cette source).
    else if (p.sourceType === 'image' && p.text && image) {
      paragraphs.push({ text: p.text, sourceType: 'image' });
    }
    // 'none' : paragraphe de transition sans citation individuelle, conserve tel quel.
    else if (p.sourceType === 'none' && p.text) {
      paragraphs.push({ text: p.text, sourceType: 'none' });
    }
  }

  return { action: raw.action || 'none', supported: raw.supported && paragraphs.length > 0, paragraphs, caveat: raw.caveat };
}

module.exports = { askAboutDossier };
