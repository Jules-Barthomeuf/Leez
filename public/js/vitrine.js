// La vitrine de Leez (public/vitrine.html) : traduction FR / EN, et le bouton
// « Accéder à l'outil » qui ouvre la Prospection sans compte quand le serveur
// l'autorise (LEEZ_ACCES_LIBRE), sinon la page de connexion.
(function () {
  const EN = {
    'nav.produit': 'Product', 'nav.sources': 'Sources', 'nav.contact': 'Contact', 'nav.connexion': 'Sign in',
    'cta.outil': 'Open the tool', 'cta.demo': 'Book a demo',
    'hero.surtitre': 'Sale-and-leaseback · REITs · France',
    'hero.titre': 'From public data to a conversation with the owner, in minutes.',
    'hero.sous': 'Leez finds the French companies that own their premises, estimates what they could unlock through a sale-and-leaseback, and tells you why they would sell now.',
    'hero.note': 'No account needed · Official public data · Every figure links to its source',
    'sources.titre': 'Built on official French registries', 'sources.cadastre': 'Land registry',
    'e1.kicker': 'Explore the market', 'e1.titre': 'A whole département on one map, already ranked',
    'e1.sous': 'Leez reads every property held by a company, finds out who occupies it, and ranks the businesses that own their own premises.',
    'e1.c1.t': 'Interactive map', 'e1.c1.p': 'Each target is a dot coloured by its score and sized by the value of its premises. Clustered when zoomed out, filtered in one move.',
    'e1.c2.t': 'The top 20 first', 'e1.c2.p': 'No list of 10,000 companies: the 20 that match your criteria, and the rest through filters (value, asset type, signals, link confidence).',
    'e1.c3.t': 'Comps at your fingertips', 'e1.c3.p': 'For every site, the nearest DVF sales, the price per m² and the number of comparables used.',
    'e2.kicker': 'From criteria to a call list', 'e2.titre': 'Describe what your REIT is looking for, in one sentence',
    'e2.sous': '“Logistics and light industrial, €8–30M, Auvergne-Rhône-Alpes and PACA, 9-year firm lease”: Leez turns it into criteria you confirm, then recalculates everything in under a second.',
    'e2.c1.t': 'Your criteria, in plain words', 'e2.c1.p': 'Ticket size, asset types, regions or départements, firm lease term, target yield, excluded sectors and score weighting.',
    'e2.c2.t': 'Lists and pipeline', 'e2.c2.p': 'Shortlist targets and track them from “To qualify” to “Signed”. Discarding requires a reason; the follow-up lands on day 7.',
    'e2.c3.t': 'All of France', 'e2.c3.p': 'Each département starts with one click and runs in the background; after that, everything answers instantly.',
    'e3.kicker': 'The real decision-maker', 'e3.titre': 'Behind the property company, the business and its leader',
    'e3.sous': 'Premises are often held by a property company (SCI). Leez traces them back to the business that occupies them, and says how sure it is.',
    'e3.c1.t': 'Owner and occupier linked', 'e3.c1.p': 'Same company number, property company run by the occupier, or a shared director confirmed by year of birth: namesakes are ruled out.',
    'e3.c2.t': 'A confidence level', 'e3.c2.p': 'Strong, medium or weak, depending on the kind of link and where the establishment sits on the plot.',
    'e3.c3.t': 'The right people', 'e3.c3.p': 'Directors, role and age, investment funds on the board; the CFO and the CEO through Apollo, on click.',
    'e3.c4.t': 'Checkable in one click', 'e3.c4.p': 'Satellite view with the plot outline, Street View at the address, and links to the land registry, the company register and the BODACC.',
    'e4.kicker': 'Why they would sell', 'e4.titre': 'Everything to qualify a target, on one screen',
    'e4.sous': 'The value of the premises, the cash that could be unlocked and the reasons to sell now, each one dated and sourced.',
    'e4.c1.t': 'Value and unlockable cash', 'e4.c1.p': 'A low, central and high range, never a single number, and the implied rent at your target yield.',
    'e4.c2.t': 'Real signals', 'e4.c2.p': 'Investment fund on the board, director aged 60 or over, change of director, premises held for decades, change in share capital.',
    'e4.c3.t': 'Three explained scores', 'e4.c3.p': 'Fit, Motivation, Tenant: every point has its reason and its source. Rules decide; nothing is estimated silently.',
    'e5.kicker': 'Official data', 'e5.titre': 'Every figure links back to its registry',
    'e5.sous': 'No black box: Leez cross-references the State\'s public files, dated, and shows you where each data point comes from.',
    'e5.dgfip': 'The register of properties held by legal entities: who owns what, unit by unit.',
    'e5.cadastre': 'The outline of every plot and the footprint of its buildings.',
    'e5.dvf': 'Property sales from the last five years, for comparables.',
    'e5.rne': 'Establishments, directors and published accounts.',
    'e5.bodacc': 'Legal notices: insolvency proceedings, changes of director, business sales.',
    'e5.ia.t': 'AI writes, code decides', 'e5.ia': 'Scores, filters and values come from verifiable rules; missing data shows as “—”.',
    'final.titre': 'Ready to find your next assets?', 'final.sous': 'Open the tool without an account, or let\'s talk about your criteria.',
    'pied.slogan': 'Prospect smarter. Conversations that convert.', 'pied.produit': 'Product', 'pied.comment': 'How it works', 'pied.societe': 'Company',
    'pied.droits': '© 2026 Leez. All rights reserved.',
    'img.explorer': 'Leez: the targets of a département on the map, ranked by score',
    'img.tableau': 'The table of targets with their three scores',
    'img.criteres': 'A sentence turned into criteria to confirm',
    'img.fiche': 'A target page: scores, checks, value and unlockable cash',
    'img.scores': 'The three scores, point by point',
  };
  const META = {
    fr: { titre: 'Leez · Prospection cession-bail', description: "Leez repère les entreprises françaises qui possèdent leurs murs, estime ce qu'elles pourraient libérer en cession-bail et vous dit pourquoi elles vendraient maintenant." },
    en: { titre: 'Leez · Sale-and-leaseback prospecting', description: EN['hero.sous'] },
  };

  // Le francais est le texte de la page : on le garde pour pouvoir revenir en arriere.
  const FR = {};
  document.querySelectorAll('[data-i18n]').forEach((el) => { FR[el.dataset.i18n] = el.innerHTML; });
  document.querySelectorAll('[data-i18n-alt]').forEach((el) => { FR[el.dataset.i18nAlt] = el.alt; });

  function appliquer(langue) {
    const dico = langue === 'en' ? EN : FR;
    document.documentElement.lang = langue;
    document.querySelectorAll('[data-i18n]').forEach((el) => { const t = dico[el.dataset.i18n]; if (t) el.innerHTML = t; });
    document.querySelectorAll('[data-i18n-alt]').forEach((el) => { const t = dico[el.dataset.i18nAlt]; if (t) el.alt = t; });
    document.title = META[langue].titre;
    document.querySelector('meta[name="description"]').setAttribute('content', META[langue].description);
    document.querySelectorAll('[data-langue]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.langue === langue)));
    try { localStorage.setItem('leez-langue', langue); } catch { /* stockage refuse */ }
  }
  let langue = 'fr';
  try { langue = localStorage.getItem('leez-langue') || (/^en/i.test(navigator.language || '') ? 'en' : 'fr'); } catch { /* idem */ }
  appliquer(langue === 'en' ? 'en' : 'fr');
  document.querySelectorAll('[data-langue]').forEach((b) => b.addEventListener('click', () => appliquer(b.dataset.langue)));

  // « Acceder a l'outil » : deja connecte, on y va ; sinon mode demo si le serveur l'ouvre ; sinon connexion.
  document.querySelectorAll('[data-acces]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    const cible = '/index.html#prospection';
    try {
      const me = await fetch('/api/auth/me');
      if (me.ok) { location.href = cible; return; }
      const libre = await fetch('/api/auth/acces-libre').then((r) => r.json()).catch(() => ({ actif: false }));
      if (libre.actif) {
        const r = await fetch('/api/auth/invite', { method: 'POST' });
        if (r.ok) { location.href = cible; return; }
      }
    } catch { /* reseau : on tombe sur la connexion */ }
    location.href = '/login.html';
  }));
}());
