// La personnalisation de Leez (21 oct. 2026), reprise du design system de
// Klocka : mode, couleur d'accent, fond, couleur de la barre, halo, police.
// Ce que chacun regle pour lui, applique a toute l'application.
//
// Un objet de preferences, normalise ici (une valeur inconnue retombe sur le
// defaut), garde en copie locale pour peindre la page des son ouverture, et
// enregistre sur le compte (/api/auth/preferences) pour suivre la personne
// d'un appareil a l'autre. L'application se fait sur <html> : un attribut de
// theme et quelques variables CSS que theme-klocka.css lit deja. Les valeurs
// sont celles de Klocka/src/design/jetons.json.
//
// Le meme fichier sert au serveur (require) pour valider ce qu'il enregistre.
(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) module.exports = fabrique();
  else racine.LeezPerso = fabrique();
}(typeof self !== 'undefined' ? self : this, () => {
  const ACCENTS = {
    menthe: { nom: 'Menthe', sombre: '#96c0b8', clair: '#3f7466' },
    sauge: { nom: 'Sauge', sombre: '#a9c5a0', clair: '#4f7a45' },
    bleu: { nom: 'Bleu', sombre: '#8fb6e8', clair: '#2d60b2' },
    pervenche: { nom: 'Pervenche', sombre: '#a6abf2', clair: '#4b52c4' },
    ambre: { nom: 'Ambre', sombre: '#e0a45e', clair: '#a6641a' },
    corail: { nom: 'Corail', sombre: '#e8877a', clair: '#b8412f' },
    violet: { nom: 'Violet', sombre: '#c39be0', clair: '#7a3fb0' },
    graphite: { nom: 'Graphite', sombre: '#c7cdc9', clair: '#3a413f' },
    rose: { nom: 'Rose', sombre: '#e85c8a', clair: '#e85c8a' },
  };
  const FONDS = {
    sombre: { noir: { nom: 'Noir chaud', fond: '#121312' }, profond: { nom: 'Noir pur', fond: '#000000' }, anthracite: { nom: 'Anthracite', fond: '#1b1d1c' } },
    clair: { perle: { nom: 'Gris perle', fond: '#f0f0ee' }, blanc: { nom: 'Blanc', fond: '#ffffff' } },
  };
  const BARRES = {
    sombre: { origine: { nom: 'Noir chaud', teinte: '#191a19' }, noir: { nom: 'Noir pur', teinte: '#000000' }, anthracite: { nom: 'Anthracite', teinte: '#242625' }, nuit: { nom: 'Bleu nuit', teinte: '#151a24' }, foret: { nom: 'Vert forêt', teinte: '#14201b' } },
    clair: { origine: { nom: 'Gris perle', teinte: '#f4f4f2' }, blanc: { nom: 'Blanc', teinte: '#ffffff' }, sable: { nom: 'Sable', teinte: '#eeeae2' }, brume: { nom: 'Bleu brume', teinte: '#e8edf1' } },
  };
  const POLICES = {
    instrument: { nom: 'Instrument Sans', css: "'Instrument Sans', Inter, system-ui, sans-serif" },
    inter: { nom: 'Inter', css: "Inter, 'Instrument Sans', system-ui, sans-serif" },
    figtree: { nom: 'Figtree', css: "Figtree, 'Instrument Sans', system-ui, sans-serif" },
    montserrat: { nom: 'Montserrat', css: "Montserrat, 'Instrument Sans', system-ui, sans-serif" },
    systeme: { nom: 'Celle du système', css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  };
  const DEFAUT = Object.freeze({ mode: 'sombre', accent: 'pervenche', accent_perso: null, fond_sombre: 'noir', fond_clair: 'perle', barre_sombre: 'origine', barre_clair: 'origine', halo: true, police: 'instrument' });
  const MODES = [['sombre', 'Sombre'], ['clair', 'Clair'], ['appareil', "Comme l'appareil"]];
  const CLE_LOCALE = 'leez-personnalisation';

  const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : null);

  /** Des preferences completes et sures : ce qui manque ou n'existe pas retombe sur le defaut. */
  function normaliser(brut) {
    const b = brut && typeof brut === 'object' ? brut : {};
    const p = { ...DEFAUT };
    if (MODES.some(([v]) => v === b.mode)) p.mode = b.mode;
    if (ACCENTS[b.accent] || hex(b.accent)) p.accent = hex(b.accent) || b.accent;
    p.accent_perso = hex(b.accent_perso);
    if (FONDS.sombre[b.fond_sombre]) p.fond_sombre = b.fond_sombre;
    if (FONDS.clair[b.fond_clair]) p.fond_clair = b.fond_clair;
    for (const t of ['sombre', 'clair']) { const v = b[`barre_${t}`]; if (BARRES[t][v] || hex(v)) p[`barre_${t}`] = hex(v) || v; }
    if (b.halo === false || b.halo === 'false') p.halo = false;
    if (POLICES[b.police]) p.police = b.police;
    return p;
  }

  // --- Couleurs : lire un hexadecimal, eclaircir ou assombrir ----------------
  const rgb = (h) => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const versHex = (c) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
  function versHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min; const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function depuisHsl([h, s, l]) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const nuance = (h, delta) => { const [a, s, l] = versHsl(rgb(h)); return versHex(depuisHsl([a, s, Math.max(0, Math.min(1, l + delta))])); };
  const luminance = (h) => { const [r, g, b] = rgb(h).map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contraste = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const alpha = (h, a) => `rgba(${rgb(h).join(', ')}, ${a})`;

  /** Le theme reellement affiche : « comme l'appareil » suit le reglage du systeme. */
  function themeEffectif(p) {
    if (p.mode === 'appareil') return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'clair' : 'sombre';
    return p.mode === 'clair' ? 'clair' : 'sombre';
  }
  const accentHex = (cle, theme) => hex(cle) || (ACCENTS[cle] || ACCENTS.menthe)[theme];
  const barreHex = (p, theme) => { const v = p[`barre_${theme}`]; return hex(v) || (BARRES[theme][v] || BARRES[theme].origine).teinte; };
  const ENCRE = { sombre: '#f2f2f0', clair: '#1c1d1c' };
  /** Le texte reste-t-il lisible sur cette barre (contraste 4,5 au moins) ? */
  const barreLisible = (h, theme) => contraste(h, ENCRE[theme]) >= 4.5;

  /** Applique des preferences a la page. Ne laisse aucune trace d'un reglage revenu au defaut. */
  function appliquer(brut) {
    if (typeof document === 'undefined') return null;
    const p = normaliser(brut);
    const theme = themeEffectif(p);
    const clair = theme === 'clair';
    const html = document.documentElement;
    const st = html.style;
    html.setAttribute('data-theme', theme);
    html.setAttribute('data-halo', p.halo && !clair ? '1' : '0');
    st.colorScheme = clair ? 'light' : 'dark';

    // L'accent et sa famille : survol, fond pale, texte pose dessus.
    const a = accentHex(p.accent, theme);
    st.setProperty('--accent', a);
    st.setProperty('--accent-hover', nuance(a, clair ? -0.05 : 0.07));
    st.setProperty('--accent-dim', alpha(a, clair ? 0.12 : 0.16));
    st.setProperty('--accent-line', alpha(a, 0.45));
    st.setProperty('--on-accent', clair || luminance(a) < 0.35 ? '#ffffff' : nuance(a, -0.55));

    // Le fond de la page.
    st.setProperty('--bg', (FONDS[theme][clair ? p.fond_clair : p.fond_sombre] || Object.values(FONDS[theme])[0]).fond);

    // La barre : la barre laterale, et avec elle les panneaux, fiches et listes.
    const choix = p[`barre_${theme}`];
    const barre = barreHex(p, theme);
    st.setProperty('--barre', barre);
    if (choix !== 'origine') {
      const sens = luminance(barre) > 0.35 ? -1 : 1;
      st.setProperty('--surface', barre);
      st.setProperty('--surface-raised', nuance(barre, sens * 0.05));
      st.setProperty('--bg-soft', nuance(barre, sens * 0.03));
    } else {
      st.removeProperty('--surface'); st.removeProperty('--surface-raised'); st.removeProperty('--bg-soft');
    }
    st.setProperty('--sans', POLICES[p.police].css);
    try { window.dispatchEvent(new CustomEvent('leez:theme', { detail: { theme, prefs: p } })); } catch { /* vieux navigateur */ }
    return p;
  }

  function lireLocal() {
    try { return normaliser(JSON.parse(localStorage.getItem(CLE_LOCALE) || 'null')); } catch { return { ...DEFAUT }; }
  }
  function ecrireLocal(p) {
    try { localStorage.setItem(CLE_LOCALE, JSON.stringify(p)); } catch { /* stockage refuse : la preference vaut pour cette page */ }
  }

  // Dans le navigateur : peindre tout de suite avec la copie locale, puis
  // reprendre celle du compte, et suivre l'appareil quand on lui obeit.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    let courant = appliquer(lireLocal());
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const suivre = () => { if (courant && courant.mode === 'appareil') appliquer(courant); };
      if (mq.addEventListener) mq.addEventListener('change', suivre); else if (mq.addListener) mq.addListener(suivre);
    }
    fetch('/api/auth/preferences').then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j && j.preferences) { courant = appliquer(j.preferences); ecrireLocal(courant); }
    }).catch(() => {});
    // Pour l'ecran Mon compte : changer, appliquer, enregistrer.
    window.LeezPersoEtat = {
      courant: () => courant,
      changer(modif) {
        courant = appliquer({ ...courant, ...modif });
        ecrireLocal(courant);
        clearTimeout(this.minuteur);
        return new Promise((ok, ko) => {
          this.minuteur = setTimeout(() => {
            fetch('/api/auth/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: courant }) })
              .then((r) => (r.ok ? ok() : r.json().then((j) => ko(new Error(j.error || 'Enregistrement impossible')))))
              .catch(ko);
          }, 400);
        });
      },
    };
  }

  // La barre de navigation : fermee par defaut (icones seules), ouverte a la demande ; choix garde par navigateur.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const CLE_BARRE = 'leez-barre';
    const lire = () => { try { return localStorage.getItem(CLE_BARRE) === 'ouverte' ? 'ouverte' : 'fermee'; } catch { return 'fermee'; } };
    const poser = (etat) => {
      document.documentElement.setAttribute('data-barre', etat);
      const b = document.getElementById('sidebarToggle');
      if (b) { b.setAttribute('aria-expanded', String(etat === 'ouverte')); b.title = etat === 'ouverte' ? 'Fermer la barre' : 'Ouvrir la barre'; }
      try { localStorage.setItem(CLE_BARRE, etat); } catch { /* stockage refuse */ }
    };
    document.documentElement.setAttribute('data-barre', lire());
    document.addEventListener('DOMContentLoaded', () => {
      // Barre fermee : le texte disparait, l'info-bulle dit ou mene chaque icone.
      document.querySelectorAll('.sidebar-nav button[data-view], .sidebar-foot-btn').forEach((b) => { if (!b.title) b.title = b.textContent.trim(); });
      const t = document.getElementById('sidebarToggle');
      if (t) { poser(lire()); t.addEventListener('click', () => poser(document.documentElement.getAttribute('data-barre') === 'ouverte' ? 'fermee' : 'ouverte')); }
      // Le deplacement de la carte et du tableau suit la largeur : on previent les ecrans qui se redimensionnent.
      const lui = document.querySelector('.sidebar');
      if (lui) lui.addEventListener('transitionend', (e) => { if (e.propertyName === 'width') window.dispatchEvent(new Event('resize')); });
    });
  }

  return { ACCENTS, FONDS, BARRES, POLICES, MODES, DEFAUT, normaliser, themeEffectif, accentHex, barreHex, barreLisible, appliquer };
}));
