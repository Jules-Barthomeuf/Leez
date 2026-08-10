// Enveloppe fine autour de l'API d'embeddings Voyage AI (partenaire
// recommande par Anthropic -- Claude ne propose pas d'endpoint d'embeddings
// en propre). Isolee dans ce fichier pour rester remplacable si le choix de
// fournisseur change plus tard ; le reste du code de la base de
// connaissances (kbChunker.js, kbSearch.js, le script d'ingestion) ne
// connait que embedText/embedBatch, jamais l'URL ou le format Voyage.
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
// voyage-3.5 : modele multilingue courant chez Voyage AI (bon support du
// francais) -- verifier le nom/tarif exact sur voyageai.com si ce fichier
// est repris longtemps apres sa creation, les gammes de modeles evoluent.
const MODEL = 'voyage-3.5';

// `inputType` : Voyage propose un mode de recherche asymetrique -- les
// documents ingeres et les requetes de recherche ne sont pas embeddes de la
// meme facon, ce qui ameliore la pertinence du retrieval sans cout
// supplementaire. 'document' a l'ingestion (kbChunker/script d'ingestion),
// 'query' a la recherche (kbSearch).
//
// Retry avec attente sur 429 (limite de debit) : un compte Voyage sans
// moyen de paiement enregistre est plafonne a 3 requetes/minute -- attendre
// et reessayer automatiquement evite de faire echouer toute une ingestion
// pour une limite temporaire, sans rien changer pour l'appelant.
const RATE_LIMIT_WAIT_MS = 22000; // > 20s pour repasser sous 3 req/min
const MAX_RETRIES = 5;

async function embedBatch(texts, { inputType = 'document' } = {}, retriesLeft = MAX_RETRIES) {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY manquante -- copiez .env.example en .env et renseignez votre cle Voyage AI.');
  if (!texts || texts.length === 0) return [];

  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
  });
  if (res.status === 429) {
    if (retriesLeft <= 0) throw new Error('Voyage AI : limite de debit atteinte de maniere persistante (429). Reessayez plus tard, ou ajoutez un moyen de paiement sur https://dashboard.voyageai.com/ pour lever la limite du palier gratuit.');
    console.warn(`  Limite de debit Voyage AI atteinte -- nouvelle tentative dans ${RATE_LIMIT_WAIT_MS / 1000}s (${retriesLeft} restante(s))...`);
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
    return embedBatch(texts, { inputType }, retriesLeft - 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage AI a repondu ${res.status} : ${body}`);
  }
  const data = await res.json();
  return data.data.map(d => d.embedding);
}

async function embedText(text, opts) {
  const [embedding] = await embedBatch([text], opts);
  return embedding;
}

module.exports = { embedBatch, embedText };
