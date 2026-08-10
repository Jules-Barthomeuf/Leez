// Recherche dans la base de connaissances par similarite cosinus. Volume
// minuscule (quelques dizaines/centaines de chunks pour 7-8 PDF courts) :
// une comparaison brute contre tous les chunks en memoire est instantanee,
// aucune indexation approximative (ANN) n'est necessaire a cette echelle.
const { listKbChunks } = require('../db');
const { embedText } = require('./kbEmbeddings');

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// Retourne les k chunks les plus pertinents pour `query`, avec toutes leurs
// metadonnees (source, section, theme, pages) mais sans le vecteur brut --
// l'appelant n'en a jamais besoin, seulement `kbAnalyze.js` en refait un
// usage interne apres son propre appel a `search`.
async function search(query, k = 5) {
  const queryEmbedding = await embedText(query, { inputType: 'query' });
  const chunks = await listKbChunks();
  return chunks
    .map(c => ({ ...c, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ embedding, ...rest }) => rest);
}

module.exports = { search, cosineSimilarity };
