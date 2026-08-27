// Backend d'extraction alternatif : Google Gemini, derriere EXACTEMENT la
// meme signature que runExtraction() cote Anthropic (extraction.js).
// Interet : le palier gratuit de l'API Gemini permet d'importer des
// dossiers sans consommer de credits Anthropic.
//
// Ce que ce module NE change PAS : le moteur de verification par citation
// (verification.js) s'applique a l'identique a la sortie. Un modele qui
// invente une valeur produit une citation introuvable dans le texte reel,
// donc un champ marque "non verifie" -- jamais une donnee fausse affichee
// comme un fait. Changer de fournisseur ne change pas cette garantie.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// JSON Schema (format Anthropic) -> responseSchema (format Gemini) :
// types en majuscules, `additionalProperties` non supporte (retire),
// `enum` conserve, structures imbriquees preservees.
function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type' && typeof v === 'string') { out.type = v.toUpperCase(); continue; }
    if (k === 'properties') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
      continue;
    }
    if (k === 'items') { out.items = toGeminiSchema(v); continue; }
    out[k] = v;
  }
  return out;
}

async function runExtractionGemini({ pdfBase64, schema, systemPrompt, userText, maxTokens }) {
  const key = process.env.GEMINI_API_KEY;
  const model = (process.env.GEMINI_MODEL || 'gemini-3.6-flash').trim();
  if (!key) throw new Error('GEMINI_API_KEY absente — extraction Gemini impossible.');

  const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [
        { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
        { text: userText },
      ] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
        // Chez Gemini, les tokens de REFLEXION sont decomptes du budget de
        // sortie : avec le plafond du pipeline (4096 sur certains appels),
        // la reflexion consommait tout et le JSON revenait tronque. Deux
        // correctifs : reflexion volontairement basse (extraction structuree
        // guidee par un schema, pas un raisonnement libre) et plancher
        // genereux sur le budget total.
        thinkingConfig: { thinkingLevel: 'LOW' },
        maxOutputTokens: Math.max(maxTokens * 4, 16000),
      },
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Message brut du fournisseur (quota, cle invalide...) -- jamais
    // masque : c'est ce que l'analyste doit voir dans le dossier en erreur.
    const msg = data?.error?.message || `HTTP ${res.status}`;
    // Quota depasse : la cause n'est pas le document mais la CONFIGURATION
    // (EXTRACTION_PROVIDER=gemini). On le dit explicitement, sinon
    // l'analyste croit que son dossier pose probleme.
    if (res.status === 429 || /quota|rate limit/i.test(msg)) {
      throw new Error(
        "Quota Gemini épuisé (palier gratuit : 5 requêtes/jour, un import en consomme 3). "
        + "Cette instance est configurée avec EXTRACTION_PROVIDER=gemini : "
        + "passez cette variable à « anthropic » pour utiliser vos crédits Anthropic."
      );
    }
    throw new Error(`Gemini : ${msg}`);
  }
  const cand = data?.candidates?.[0];
  if (!cand) throw new Error('Gemini : aucune reponse renvoyee.');
  // Reponse tronquee (plafond de tokens atteint) : echouer franchement
  // plutot que de laisser un JSON incomplet partir vers la verification.
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    // MAX_TOKENS inclus : un JSON coupe en deux ne doit jamais atteindre la
    // verification -- mieux vaut un dossier en erreur, explicite.
    throw new Error(`Gemini : generation interrompue (${cand.finishReason}).`);
  }
  const part = (cand.content?.parts || []).find(p => typeof p.text === 'string');
  if (!part) throw new Error('Gemini : aucune sortie structuree.');
  try {
    return JSON.parse(part.text);
  } catch {
    throw new Error('Gemini : sortie JSON invalide.');
  }
}

module.exports = { runExtractionGemini, toGeminiSchema };
