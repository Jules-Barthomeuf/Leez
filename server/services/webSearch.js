// Recherche web pour l'Assistant, mode explicite ("bascule web" cote client)
// -- distinct du Q&A dossier/KB (dealChat.js) : ici la "citation" EST le lien
// source, verifiable en un clic par l'analyste, pas une citation interne
// verifiee par locateQuote. Toujours etiquete cote client comme "resultat de
// recherche web" pour ne jamais se confondre visuellement avec une citation
// dossier/KB verifiee (voir verification.js).
//
// Deux usages partagent ce fichier : la question libre tapee par l'analyste
// (answerWithWebSearch, texte libre en streaming) et le verificateur
// d'affirmations du vendeur (verifyClaimAgainstWeb, sortie structuree
// verdict/justification -- voir vendorClaimsVerifier.js). Les deux
// beneficient du meme "contexte du dossier" (dealContext, voir
// dealContext.js) pour rendre la recherche CONTEXTUELLE au bien ouvert
// plutot que generique.
const Anthropic = require('@anthropic-ai/sdk');
const { classifySourceReliability } = require('./sourceReliability');

const client = new Anthropic();
const MODEL = 'claude-opus-5';

const MAX_SOURCES = 5;

const SYSTEM_PROMPT_WEB = `Tu es le module de recherche web de l'assistant d'un outil d'analyse immobiliere. L'analyste te pose une question qui necessite une information externe et actuelle (comparables de marche, actualite du secteur, taux en vigueur, jurisprudence recente...). Utilise l'outil de recherche web pour trouver une reponse fiable.

Si un contexte de dossier t'est fourni (adresse, type d'actif, sous-marche...), utilise-le pour cibler ta recherche sur CE bien precis plutot que de repondre de facon generique -- par exemple traduis "ce loyer est-il coherent avec le marche local ?" en une recherche sur le marche reel de l'adresse/du sous-marche fournis.

Consignes de redaction :
- Redige un resume clair et concis en francais (quelques courts paragraphes, listes courtes si utile) -- jamais un mur de texte, jamais de markdown mal forme.
- Va droit a la reponse. Ne raconte jamais ton processus de recherche ("je lance une recherche", "voici ma methode", "mon quota est epuise", etc.) -- l'analyste ne voit que le resultat final.
- Si une premiere recherche donne assez de matiere pour repondre correctement, n'enchaine pas de nouvelles recherches par exhaustivite : reponds. Reserve les recherches supplementaires aux cas ou la premiere n'a vraiment rien donne d'exploitable.
- Ne cite pas chaque page consultee : mentionne seulement les 2-3 elements factuels cles qui fondent ta reponse, les liens cliquables en fin de message suffisent comme reference.
- Si tu n'as vraiment rien trouve d'exploitable malgre la recherche, dis-le en une phrase et propose de preciser la question -- pas de longue explication technique.
- Ne reponds jamais de memoire sur un point factuel qui necessiterait une verification -- cherche.`;

const SYSTEM_PROMPT_CLAIM_VERDICT = `Tu es le module de verification des affirmations marketing d'un memorandum de vente immobilier, pour l'outil d'analyse d'un fonds d'investissement. On te donne une affirmation du vendeur et sa citation d'origine dans le document ; utilise l'outil de recherche web pour la confronter a des sources reelles et independantes.

Consignes de recherche :
- Privilegie les sources primaires et officielles (donnees publiques -- INSEE, data.gouv.fr, ADEME, cadastre, geoportail de l'urbanisme -- sites institutionnels, publications de brokers reconnus) ; mefie-toi des agregateurs et forums peu fiables.
- Cherche des donnees concretes et datees permettant de confronter l'affirmation, pas une opinion generale.
- Si la recherche ne trouve rien d'exploitable, dis-le clairement dans ta justification -- ne comble jamais l'absence de donnee par une estimation personnelle.
- Une decision d'investissement de plusieurs millions peut reposer sur ce verdict : la prudence de formulation prime toujours sur l'assurance.

Rends ensuite ton verdict selon le schema demande :
- confirme : les sources trouvees appuient clairement l'affirmation.
- nuance : les sources l'appuient partiellement, avec des reserves ou des chiffres differents de ceux annonces.
- contredit : les sources vont a l'encontre de l'affirmation.
- donnees_insuffisantes : aucune source pertinente n'a ete trouvee pour statuer.
justification : 1 a 3 phrases en francais, ancrees dans ce que tu as reellement trouve pendant la recherche, jamais une supposition presentee comme un fait.`;

const SYSTEM_PROMPT_TENANT = `Tu es le module de recherche web dedie a la solvabilite/reputation des locataires, pour l'assistant d'un outil d'analyse immobiliere. On te donne le nom d'une entreprise locataire (extrait d'un etat locatif reel) et, si disponible, son activite declaree et le contexte de l'immeuble qu'elle occupe. Utilise l'outil de recherche web pour trouver des informations publiques fiables sur CETTE entreprise precise (pas une entreprise homonyme differente) : forme juridique, taille/effectifs, sante financiere connue (chiffre d'affaires, procedures collectives, notation si publique), actualite recente (rachat, difficulte, expansion), reputation sectorielle.

Consignes de redaction :
- Redige un resume clair et concis en francais (quelques courts paragraphes) -- jamais un mur de texte, jamais de markdown mal forme.
- Va droit a la reponse. Ne raconte jamais ton processus de recherche ("je lance une recherche", "voici ma methode", etc.) -- l'analyste ne voit que le resultat final.
- Si plusieurs entreprises portent un nom proche, precise a laquelle tu te refers (secteur/ville/SIREN si trouve) plutot que de risquer une confusion entre deux entites differentes.
- Va droit a l'essentiel pour un analyste evaluant le risque locataire (capacite a payer le loyer dans la duree) -- pas une biographie complete de l'entreprise.
- Ne cite pas chaque page consultee : les liens cliquables fournis separement suffisent comme reference.
- Si tu ne trouves rien d'exploitable sur cette entreprise precise (nom trop generique, entite non referencee publiquement, enseigne locale sans presence web...), dis-le clairement en une phrase plutot que d'improviser une appreciation.
- Ne reponds jamais de memoire sur un point qui necessiterait une verification -- cherche.`;

const verdictSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirme', 'nuance', 'contredit', 'donnees_insuffisantes'] },
    justification: { type: 'string' },
  },
  required: ['verdict', 'justification'],
  additionalProperties: false,
};

function withDealContext(basePrompt, dealContext) {
  return dealContext
    ? `${basePrompt}\n\n=== CONTEXTE DU DOSSIER ACTUELLEMENT SÉLECTIONNÉ ===\n${dealContext}`
    : basePrompt;
}

// Priorite aux URLs reellement citees dans le texte (celles que le modele a
// utilisees comme preuve inline) ; les autres resultats de recherche ne
// completent la liste que si des places restent -- on ne veut pas un lien
// par resultat de recherche brut (potentiellement des dizaines), juste
// "quelques liens a la fin". Partage entre les deux usages de ce fichier.
function extractSources(content) {
  const citedUrls = new Map();
  const otherUrls = new Map();
  for (const block of content || []) {
    if (block.type === 'text') {
      for (const citation of block.citations || []) {
        if (citation?.url) citedUrls.set(citation.url, { url: citation.url, title: citation.title || citation.url });
      }
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result?.url && !citedUrls.has(result.url)) otherUrls.set(result.url, { url: result.url, title: result.title || result.url });
      }
    }
  }
  return [...citedUrls.values(), ...otherUrls.values()].slice(0, MAX_SOURCES);
}

// dealContext (optionnel) : bloc texte issu de dealContext.js#buildDealContextBlock
// -- injecte dans le prompt systeme pour que la recherche parte deja du bon
// bien (adresse/type/sous-marche) plutot que d'une question nue.
// onTextDelta (optionnel) : appele pour chaque fragment de texte du modele
// des qu'il est genere (stream.on('text', ...) -- ne se declenche que sur les
// deltas de texte reel, jamais sur la construction de l'appel a l'outil de
// recherche). Permet a la route de relayer un vrai flux token-par-token au
// client -- rien a verifier ici cote citation, donc pas de garde de securite
// a attendre avant d'afficher.
async function answerWithWebSearch({ question, dealContext, onTextDelta }) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: withDealContext(SYSTEM_PROMPT_WEB, dealContext),
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    messages: [{ role: 'user', content: String(question || '').slice(0, 2000) }],
  });
  if (onTextDelta) stream.on('text', onTextDelta);
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('Le modele a refuse cette requete (stop_reason=refusal).');
  }

  let answer = '';
  for (const block of message.content || []) {
    if (block.type === 'text') answer += block.text;
  }
  const sources = extractSources(message.content);

  return { answer: answer.trim(), sources };
}

// Verificateur d'affirmations du vendeur (onglet "Verification") -- un seul
// appel combine outil de recherche web + sortie structuree (confirme
// empiriquement que les deux se combinent correctement sur ce modele/API :
// le modele cherche via l'outil puis produit un dernier bloc texte JSON
// conforme au schema). Les sources restent extraites du contenu de la
// reponse comme pour answerWithWebSearch ; leur fiabilite est taguee ICI en
// code deterministe (classifySourceReliability), jamais par le modele.
async function verifyClaimAgainstWeb({ claimText, quote, dealContext }) {
  const userText = `Affirmation a verifier : "${String(claimText || '').slice(0, 500)}"\nCitation d'origine dans le document : "${String(quote || '').slice(0, 800)}"`;
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: withDealContext(SYSTEM_PROMPT_CLAIM_VERDICT, dealContext),
    // max_uses:5 s'est revele trop bas en test reel : plusieurs affirmations
    // epuisaient le budget de recherche avant d'aboutir ("search tool use
    // limit exceeded"), ce qui produisait un verdict "donnees_insuffisantes"
    // par manque de budget plutot que par absence reelle de donnees -- aligne
    // sur le budget de answerWithWebSearch (8).
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    output_config: { format: { type: 'json_schema', schema: verdictSchema } },
    messages: [{ role: 'user', content: userText }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('Le modele a refuse cette requete (stop_reason=refusal).');
  }
  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error(`Aucune reponse structuree du modele (stop_reason=${message.stop_reason}).`);
  }
  const { verdict, justification } = JSON.parse(textBlock.text);
  const sources = extractSources(message.content).map(s => ({ ...s, reliability: classifySourceReliability(s.url) }));
  return { verdict, justification: String(justification || ''), sources };
}

// "AI Insight" (onglet Données > État locatif, clic sur une ligne) --
// recherche web ciblee sur UN locataire precis, distincte de la recherche
// generale (answerWithWebSearch) par son prompt (solvabilite/reputation
// d'entreprise, pas marche immobilier) et par le tag de fiabilite applique
// a chaque source (meme logique deterministe que le verificateur
// d'affirmations du vendeur, jamais laisse au jugement du modele).
async function researchTenant({ tenantName, activite, dealContext, onTextDelta }) {
  const question = `Locataire a rechercher : "${String(tenantName || '').slice(0, 200)}"${activite ? ` (activite declaree dans le bail : ${String(activite).slice(0, 200)})` : ''}`;
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: withDealContext(SYSTEM_PROMPT_TENANT, dealContext),
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    messages: [{ role: 'user', content: question }],
  });
  if (onTextDelta) stream.on('text', onTextDelta);
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('Le modele a refuse cette requete (stop_reason=refusal).');
  }
  let answer = '';
  for (const block of message.content || []) {
    if (block.type === 'text') answer += block.text;
  }
  const sources = extractSources(message.content).map(s => ({ ...s, reliability: classifySourceReliability(s.url) }));
  return { answer: answer.trim(), sources };
}

module.exports = { answerWithWebSearch, verifyClaimAgainstWeb, researchTenant };
