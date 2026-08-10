// Moteur de verification deterministe : chaque donnee extraite par le modele
// (valeur + page + citation) est verifiee contre le texte reel de la page,
// tel qu'extrait par pdfText.js. Rien ici ne fait appel a un modele.
//
// Principe : si la citation ne se retrouve pas dans le texte reel de la page
// annoncee, ou si la valeur ne se retrouve pas dans la citation, le champ est
// mis a null et marque non verifie. Une citation fausse est pire que
// l'absence de citation.

function stripDiacritics(ch) {
  const n = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return n.length > 0 ? n[0] : ch;
}

// Normalise une chaine (minuscules, accents retires, espaces reduits) tout en
// conservant, pour chaque caractere de sortie, l'index du caractere source
// correspondant -- necessaire pour retrouver la position reelle dans la page.
function buildNormalizedIndex(str) {
  let out = '';
  const map = [];
  let lastWasSpace = true;
  for (let i = 0; i < str.length; i++) {
    const raw = str[i];
    if (/\s/.test(raw)) {
      if (!lastWasSpace) {
        out += ' ';
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    out += stripDiacritics(raw.toLowerCase());
    map.push(i);
    lastWasSpace = false;
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function similarityRatio(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Recherche floue bornee : glisse une fenetre de la longueur de la citation
// sur le texte de la page, par pas de 3 caracteres, jusqu'a un budget maximal
// de comparaisons -- evite un cout quadratique sur de longues pages.
function fuzzyFind(normQuote, normPage, threshold) {
  const L = normQuote.length;
  if (L === 0 || normPage.length < L) return null;
  const step = 3;
  const maxWindows = 800;
  let best = null;
  let windows = 0;
  for (let start = 0; start + L <= normPage.length && windows < maxWindows; start += step, windows++) {
    const window = normPage.slice(start, start + L);
    const score = similarityRatio(normQuote, window);
    if (!best || score > best.score) best = { start, end: start + L, score };
  }
  if (best && best.score >= threshold) return best;
  return null;
}

function digitsOnly(s) {
  return String(s).replace(/[^\d]/g, '');
}

// Verifie que la valeur annoncee se retrouve bien dans le texte de la
// citation trouvee -- comparaison numerique (chiffres seuls) pour les
// nombres, textuelle normalisee sinon.
function valueMatches(claimedValue, matchedText) {
  if (claimedValue === null || claimedValue === undefined || claimedValue === '') return true;
  const claimedStr = String(claimedValue);
  const claimedDigits = digitsOnly(claimedStr);
  if (claimedDigits.length >= 2) {
    return digitsOnly(matchedText).includes(claimedDigits);
  }
  const { text: normClaim } = buildNormalizedIndex(claimedStr);
  const { text: normMatched } = buildNormalizedIndex(matchedText);
  return normMatched.includes(normClaim);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Deduit un rectangle de surlignage (en % de la page) a partir des fragments
// de texte reels qui recouvrent la zone trouvee.
function deriveBox(pageData, origStart, origEnd) {
  const covering = pageData.spans.filter(sp => sp.end > origStart && sp.start < origEnd);
  if (covering.length === 0) return null;
  const minX = Math.min(...covering.map(s => s.x));
  const minY = Math.min(...covering.map(s => s.y));
  const maxX = Math.max(...covering.map(s => s.x + s.w));
  const maxY = Math.max(...covering.map(s => s.y + s.h));
  if (!pageData.pageWidth || !pageData.pageHeight) return null;
  const x = (minX / pageData.pageWidth) * 100;
  const y = (minY / pageData.pageHeight) * 100;
  const w = ((maxX - minX) / pageData.pageWidth) * 100;
  const h = ((maxY - minY) / pageData.pageHeight) * 100;
  return [round2(x), round2(y), round2(Math.max(w, 1)), round2(Math.max(h, 1))];
}

// Localise une citation (exacte ou floue) dans un texte de page reel --
// factorise hors de verifyClaim pour etre reutilisee telle quelle par le
// surlignage cote UI (memes seuils, donc meme garantie de correspondance
// qu'au moment de la verification initiale). Retourne { start, end, score }
// (indices dans le texte ORIGINAL, non normalise) ou null si introuvable.
function locateQuote(quote, pageText, options = {}) {
  const threshold = options.threshold ?? 0.85;
  const { text: normQuote } = buildNormalizedIndex(String(quote || ''));
  if (normQuote.length === 0) return null;
  const { text: normPage, map } = buildNormalizedIndex(pageText);

  let matchStart = normPage.indexOf(normQuote);
  let matchEnd = matchStart >= 0 ? matchStart + normQuote.length : -1;
  let score = matchStart >= 0 ? 1 : 0;

  if (matchStart < 0) {
    const fuzzy = fuzzyFind(normQuote, normPage, threshold);
    if (fuzzy) {
      matchStart = fuzzy.start;
      matchEnd = fuzzy.end;
      score = fuzzy.score;
    }
  }
  if (matchStart < 0) return null;

  const start = map[matchStart];
  const end = matchEnd < map.length ? map[matchEnd - 1] + 1 : pageText.length;
  return { start, end, score };
}

// Verifie une citation isolee { value, page, quote } contre le texte reel des
// pages fournies. Retourne { verified, page, box?, matchScore, reason? }.
function verifyClaim(claim, pages, options = {}) {
  const threshold = options.threshold ?? 0.85;
  const page = claim.page;

  if (!page || !Number.isInteger(page) || page < 1 || page > pages.length) {
    return { verified: false, reason: 'page_out_of_range' };
  }
  const pageData = pages[page - 1];
  const quote = String(claim.quote || '');
  if (buildNormalizedIndex(quote).text.length === 0) {
    return { verified: false, reason: 'empty_quote' };
  }

  const located = locateQuote(quote, pageData.text, { threshold });
  if (!located) {
    return { verified: false, reason: 'quote_not_found' };
  }

  const matchedOriginal = pageData.text.slice(located.start, located.end);
  if (!valueMatches(claim.value, matchedOriginal)) {
    return { verified: false, reason: 'value_not_in_quote', matchScore: located.score };
  }

  const box = deriveBox(pageData, located.start, located.end);
  return { verified: true, matchScore: located.score, page, box };
}

function isClaim(node) {
  return !!node && typeof node === 'object' && !Array.isArray(node)
    && 'value' in node && 'page' in node && 'quote' in node;
}

// Parcourt recursivement un objet renvoye par extraction.js et remplace
// chaque feuille { value, page, quote } par son resultat verifie. Les champs
// non verifies sont mis a null -- jamais laisses tels quels.
function verifyExtractedTree(node, pages, options = {}) {
  if (Array.isArray(node)) return node.map(n => verifyExtractedTree(n, pages, options));
  if (node && typeof node === 'object') {
    if (isClaim(node)) {
      const result = verifyClaim(node, pages, options);
      if (result.verified) {
        return { value: node.value, page: result.page, box: result.box, quote: node.quote, verified: true };
      }
      return { value: null, page: node.page ?? null, verified: false, reason: result.reason, rawClaim: node };
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = verifyExtractedTree(v, pages, options);
    return out;
  }
  return node;
}

// Verifie un theme narratif { paragraphe, citations: [{page, quote}] } --
// pour l'onglet "Contexte" (paragraphes de synthese, pas des champs courts).
// Chaque citation est verifiee independamment (quote reellement present sur
// la page annoncee) en reutilisant verifyClaim avec value:'' -- valueMatches
// accepte toujours une valeur vide, donc seule l'authenticite de la citation
// est controlee ici. Les citations non verifiees sont retirees. Le
// paragraphe lui-meme (synthese redigee, pas une citation litterale) n'est
// PAS verifie mot pour mot : l'UI doit toujours le presenter comme une
// synthese appuyee par les citations, jamais comme un fait verifie au meme
// titre qu'un champ cite classique.
function verifyContexteTheme(theme, pages) {
  const citations = (theme.citations || [])
    .map(c => ({ ...c, result: verifyClaim({ value: '', page: c.page, quote: c.quote }, pages) }))
    .filter(c => c.result.verified)
    .map(c => ({ page: c.page, quote: c.quote, box: c.result.box ?? null }));
  return { paragraphe: theme.paragraphe, citations };
}
function verifyContexteNarratif(raw, pages) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) out[k] = verifyContexteTheme(v, pages);
  return out;
}

// Verifie les affirmations marketing du vendeur (onglet "Verification") --
// contrat STRICT, different de verifyContexteTheme ci-dessus : ici la
// citation EST l'affirmation (pas une synthese redigee appuyee par des
// citations), donc une affirmation dont la citation ne se retrouve pas
// verbatim sur la page annoncee est rejetee dans son ENTIER, jamais gardee
// sous une forme degradee. Meme contrat que les paragraphes sourceType:
// 'dossier' de dealChat.js.
function verifyVendorClaims(rawClaims, pages) {
  return (Array.isArray(rawClaims) ? rawClaims : [])
    .map(c => ({ ...c, result: verifyClaim({ value: '', page: c.page, quote: c.quote }, pages) }))
    .filter(c => c.result.verified)
    .map(c => ({
      theme: String(c.theme || ''),
      claimText: String(c.claimText || ''),
      page: c.page,
      quote: c.quote,
      box: c.result.box ?? null,
    }));
}

module.exports = {
  buildNormalizedIndex,
  similarityRatio,
  valueMatches,
  deriveBox,
  locateQuote,
  verifyClaim,
  verifyExtractedTree,
  verifyContexteNarratif,
  verifyVendorClaims,
};
