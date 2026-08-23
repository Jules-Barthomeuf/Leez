// Decoupe un PDF de la base de connaissances en chunks logiques (un article
// ou une notion = un chunk), sans jamais laisser le modele generer le texte
// stocke : Claude ne fait que REPERER les frontieres (titre, theme,
// citations verbatim de debut/fin de section) ; le contenu reellement
// enregistre est toujours une tranche du texte reel extrait du PDF,
// localisee et verifiee via `locateQuote` (le meme mecanisme que
// verification.js utilise pour verifier les citations de l'extraction
// principale -- "une fausse citation est pire qu'aucune citation").
//
// Schema volontairement plat, sans champ nullable/optionnel (meme regle
// que partout ailleurs dans ce projet -- voir extraction.js) : tous les
// champs sont requis, `articleRef` vaut '' (jamais null) si non applicable.
const Anthropic = require('@anthropic-ai/sdk');
const { extractPages } = require('./pdfText');
const { locateQuote } = require('./verification');

const client = new Anthropic();
const { EXTRACTION_MODEL } = require('./models');
const MODEL = EXTRACTION_MODEL;

const MIN_CHUNK_CHARS = 30;   // en dessous : ancrage quasi certainement aberrant
const MAX_CHUNK_CHARS = 6000; // au dessus : les deux ancres se sont probablement mal localisees

const THEMES = [
  'bail_commercial', 'indexation', 'article_606', 'fiscalite',
  'dpe_esg', 'methode_financiere', 'urbanisme', 'glossaire', 'autre',
];

const sectionsSchema = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          theme: { type: 'string', enum: THEMES },
          articleRef: { type: 'string' },
          startQuote: { type: 'string' },
          endQuote: { type: 'string' },
        },
        required: ['title', 'theme', 'articleRef', 'startQuote', 'endQuote'],
        additionalProperties: false,
      },
    },
  },
  required: ['sections'],
  additionalProperties: false,
};

const SYSTEM_PROMPT_CHUNKER = "Tu decoupes un document juridique/financier immobilier en sections logiques autonomes -- un article ou une notion = une section, comprehensible sans le reste du document. Pour chaque section : un titre court, un theme choisi dans la liste fermee fournie, une reference d'article/de loi si le texte en cite une explicitement (sinon une chaine vide ''), et deux citations VERBATIM copiees mot pour mot depuis le document (jamais reformulees, jamais resumees) : les 12 a 15 premiers mots de la section (startQuote) et ses 12 a 15 derniers mots (endQuote). Les sections doivent se succeder dans l'ordre du document, sans se chevaucher et sans trou significatif entre elles. N'invente aucune citation que tu ne peux pas recopier exactement depuis le texte fourni.";

// Concatene les pages extraites en un seul texte, en conservant la
// correspondance offset -> numero de page (necessaire car une section peut
// s'etendre sur plusieurs pages).
function buildFullText(pages) {
  let fullText = '';
  const pageRanges = [];
  for (const p of pages) {
    const start = fullText.length;
    fullText += (fullText ? '\n\n' : '') + (p.text || '');
    pageRanges.push({ pageNumber: p.pageNumber, start, end: fullText.length });
  }
  return { fullText, pageRanges };
}
function pageAt(pageRanges, offset) {
  const r = pageRanges.find(r => offset >= r.start && offset < r.end);
  return r ? r.pageNumber : pageRanges[pageRanges.length - 1].pageNumber;
}

async function runSectionBoundaries(pdfBase64) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT_CHUNKER,
    output_config: { format: { type: 'json_schema', schema: sectionsSchema } },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Decoupe ce document en sections selon les instructions.' },
      ],
    }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('Le modele a refuse le decoupage (stop_reason=refusal).');
  }
  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error(`Aucune reponse structuree du modele (stop_reason=${message.stop_reason}).`);
  }
  return JSON.parse(textBlock.text).sections;
}

// Localise deterministiquement les frontieres proposees par Claude dans le
// texte REEL extrait du PDF, et decoupe le chunk a partir de ces ancres
// verifiees -- jamais a partir du texte que Claude a lui-meme recopie.
// Note : `locateQuote` tente d'abord une correspondance exacte (non bornee
// en longueur) puis, seulement en repli, une recherche floue bornee aux
// ~2400 premiers caracteres du texte fourni (limite heritee de
// verification.js, pensee pour une page, pas un document entier) -- sans
// consequence ici puisque startQuote/endQuote doivent etre recopies mot
// pour mot et matchent donc l'immense majorite du temps en exact.
function locateSections(rawSections, fullText, pageRanges) {
  const sections = [];
  const warnings = [];

  for (const raw of rawSections) {
    const startAnchor = locateQuote(raw.startQuote, fullText, { threshold: 0.85 });
    if (!startAnchor) { warnings.push({ sectionTitle: raw.title, reason: 'start_quote_not_found' }); continue; }

    // La fin est cherchee UNIQUEMENT apres la fin du debut deja localise --
    // rend structurellement impossible une fin situee avant le debut.
    const suffix = fullText.slice(startAnchor.end);
    const endAnchor = locateQuote(raw.endQuote, suffix, { threshold: 0.85 });
    if (!endAnchor) { warnings.push({ sectionTitle: raw.title, reason: 'end_quote_not_found' }); continue; }
    const contentEnd = startAnchor.end + endAnchor.end;

    const content = fullText.slice(startAnchor.start, contentEnd).trim();
    if (content.length < MIN_CHUNK_CHARS) { warnings.push({ sectionTitle: raw.title, reason: 'chunk_too_short' }); continue; }
    if (content.length > MAX_CHUNK_CHARS) { warnings.push({ sectionTitle: raw.title, reason: 'chunk_too_large' }); continue; }

    sections.push({
      title: raw.title,
      theme: raw.theme,
      articleRef: raw.articleRef,
      pageStart: pageAt(pageRanges, startAnchor.start),
      pageEnd: pageAt(pageRanges, Math.max(contentEnd - 1, startAnchor.start)),
      content,
    });
  }
  return { sections, warnings };
}

async function extractDocumentSections(pdfBuffer) {
  const pages = await extractPages(pdfBuffer);
  const { fullText, pageRanges } = buildFullText(pages);
  const rawSections = await runSectionBoundaries(pdfBuffer.toString('base64'));
  return locateSections(rawSections, fullText, pageRanges);
}

module.exports = { extractDocumentSections, THEMES };
