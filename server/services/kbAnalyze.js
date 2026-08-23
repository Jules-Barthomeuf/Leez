// Repond a une question d'analyse en s'appuyant EXCLUSIVEMENT sur des
// extraits reels de la base de connaissances (jamais sur les connaissances
// generales du modele). Ce module ne remplace jamais les calculs
// deterministes existants de l'application (WALT, WALB, indicateurs,
// alertes d'Audit) : il sert uniquement a contextualiser/justifier une
// analyse deja produite ailleurs, jamais a la recalculer.
//
// Verification des citations : chaque reference recuperee recoit un
// identifiant opaque (REF1, REF2...) ; le modele doit citer ce refId par
// paragraphe ; apres la reponse, on verifie que chaque refId cite
// correspond REELLEMENT a une reference envoyee -- tout paragraphe dont la
// citation ne matche rien de reel est retire. Meme philosophie que
// verification.js : une fausse citation est pire qu'aucune citation.
const Anthropic = require('@anthropic-ai/sdk');
const { search } = require('./kbSearch');

const client = new Anthropic();
const { CHAT_MODEL } = require('./models');
const MODEL = CHAT_MODEL;

const analysisSchema = {
  type: 'object',
  properties: {
    supported: { type: 'boolean' },
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          refId: { type: 'string' },
        },
        required: ['text', 'refId'],
        additionalProperties: false,
      },
    },
    caveat: { type: 'string' },
  },
  required: ['supported', 'paragraphs', 'caveat'],
  additionalProperties: false,
};

const SYSTEM_PROMPT_ANALYZE = "Tu es un assistant qui repond a des questions d'analyse immobiliere en te basant EXCLUSIVEMENT sur les references documentaires fournies ci-dessous (extraits reels de fiches juridiques et financieres). Ces references ne remplacent JAMAIS les calculs deterministes deja realises par l'application (WALT, WALB, seuils, indicateurs, alertes) : elles servent uniquement a CONTEXTUALISER ou JUSTIFIER une analyse existante, jamais a la recalculer ou a la contredire. Pour chaque affirmation, cite la reference sur laquelle elle s'appuie via son identifiant refId -- n'utilise QUE les refId listes ci-dessous, n'en invente aucun autre. Si les references fournies ne permettent pas de repondre (information absente, hors sujet, ou insuffisante), dis-le clairement dans le champ caveat et mets supported a false -- ne complete JAMAIS par tes connaissances generales, meme si tu penses connaitre la reponse.";

function buildReferenceBlock(chunks) {
  return chunks.map((c, i) => {
    const pages = c.page_start === c.page_end ? `page ${c.page_start}` : `pages ${c.page_start}-${c.page_end}`;
    return `[REF${i + 1}] Source : ${c.source_file} -- Section : "${c.section_title}" (${c.theme}, ${pages})\n"""\n${c.content}\n"""`;
  }).join('\n\n');
}

async function analyzeWithKnowledge({ question, dealContext = '', k = 5 }) {
  const chunks = await search(question, k);
  const refMap = new Map(chunks.map((c, i) => [`REF${i + 1}`, c]));

  if (chunks.length === 0) {
    return { supported: false, paragraphs: [], caveat: "La base de connaissances est vide ou inaccessible.", sourcesUsed: [] };
  }

  const userText = `Question d'analyse : ${question}\n\n${dealContext ? `Contexte du dossier : ${dealContext}\n\n` : ''}References disponibles :\n\n${buildReferenceBlock(chunks)}`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT_ANALYZE,
    output_config: { format: { type: 'json_schema', schema: analysisSchema } },
    messages: [{ role: 'user', content: userText }],
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

  // Filtre toute citation qui ne correspond a aucune reference reellement
  // envoyee au modele -- voir le commentaire d'en-tete du fichier.
  const paragraphs = raw.paragraphs
    .filter(p => refMap.has(p.refId))
    .map(p => {
      const c = refMap.get(p.refId);
      return {
        text: p.text,
        sourceFile: c.source_file,
        sourceSection: c.section_title,
        theme: c.theme,
        page: c.page_start,
      };
    });

  return {
    supported: raw.supported && paragraphs.length > 0,
    paragraphs,
    caveat: raw.caveat,
    sourcesUsed: chunks.map(c => ({ sourceFile: c.source_file, sourceSection: c.section_title, score: c.score })),
  };
}

module.exports = { analyzeWithKnowledge };
