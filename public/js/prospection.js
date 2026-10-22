// Prospection cession-bail (V2, 21 oct. 2026) : l'ecran, sur la mise en page
// de DealGround et le theme Leez. Sept vues sous un meme onglet, chacune avec
// son adresse (#prospection/<vue>/<parametre>) :
//   accueil      le mandat en phrase libre, puis Mandats, Listes, Analyses ;
//   explorer     resultats a gauche, carte a droite, filtres en pastilles ;
//   tableau      toutes les colonnes, etape du pipeline, export ;
//   cible/<siren> la fiche : detail a gauche, carte satellite et Street View a droite ;
//   listes, pipeline, mandats ; verification/<dept> pour le jeu de 50 du lot 1.
// Les scores se recalculent ici pour le mandat actif (prospection-scores.js),
// sans relancer d'analyse. Rien ne part sans un clic de l'utilisateur.
(function () {
  const Sc = window.ProspectionScores;
  const Md = window.ProspectionMandat;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const M = (v) => (v == null ? '—' : `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`);
  const N = (v) => (v == null ? '—' : Number(v).toLocaleString('fr-FR'));
  const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const couleur = (s) => (s >= 60 ? 'var(--green)' : s >= 40 ? 'var(--amber)' : 'var(--text-faint)');
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const couleurBrute = (s) => css(s >= 60 ? '--green' : s >= 40 ? '--amber' : '--text-faint');

  const ETAPES = [['a_qualifier', 'À qualifier'], ['qualifiee', 'Qualifiée'], ['contactee', 'Contactée'], ['en_discussion', 'En discussion'], ['presentee', 'Présentée à la SCPI'], ['offre', 'Offre'], ['signee', 'Signée'], ['ecartee', 'Écartée']];
  const ETAPE = Object.fromEntries(ETAPES);
  const SIGNAUX = [['fonds', 'Fonds au capital'], ['dirigeant_60', 'Dirigeant de 60 ans et plus'], ['changement_dirigeant', 'Changement de dirigeant'], ['plus_value', 'Plus-value latente forte'], ['achat_ancien', 'Murs détenus avant 2005'], ['capital', 'Modification du capital']];
  const CONFIANCES = [['fort', 'Lien fort'], ['moyen', 'Lien moyen'], ['faible', 'Lien faible']];
  const LIENS = { meme_siren: 'Propriétaire exploitant', gerant_sci: "SCI dirigée par l'exploitant", proprietaire_dirige: "Le propriétaire dirige l'exploitant", holding_commune: 'Même holding', dirigeant_commun: 'Dirigeant commun' };
  const VERDICTS = [['ok', 'Occupe ses murs'], ['faux', 'Faux positif'], ['doute', 'À revoir']];
  const ICONES = {
    retour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    signet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h12v17l-6-4-6 4z"/></svg>',
    chercher: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
    liste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    carte: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
    mandat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 8.5h8M8 12.5h8M8 16.5h5"/></svg>',
    dossier: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 012-2h4l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/></svg>',
    analyse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    batiment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3.5 20.5h17M5 20.5V9l7-4.5L19 9v11.5M9 20.5v-5h6v5M8.5 11h1M14.5 11h1"/></svg>',
    lien: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10"/></svg>',
    fermer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  const E = {
    pret: false, etat: null, mandats: [], mandatId: null, listes: [], suivis: new Map(), verifs: new Map(),
    donnees: new Map(), cibles: [], scores: new Map(), filtres: null, toutes: false, tri: 'global', vue: 'accueil', param: null,
    proposition: null, sondage: null, carteX: null, carteF: null, cle: null, bornes: null, suivreCarte: false,
  };

  async function api(chemin, opts = {}) {
    const r = await fetch(`/api${chemin}`, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    return j;
  }
  function avis(texte, erreur = false) {
    let a = $('prAvis');
    if (!a) { a = document.createElement('div'); a.id = 'prAvis'; a.className = 'pr-avis'; document.body.appendChild(a); }
    a.textContent = texte;
    a.classList.toggle('erreur', erreur);
    a.classList.add('visible');
    clearTimeout(a.minuteur);
    a.minuteur = setTimeout(() => a.classList.remove('visible'), 3200);
  }

  // ------------------------------------------------------------------ donnees
  const mandat = () => E.mandats.find((m) => m.id === E.mandatId) || null;
  const criteres = () => (mandat() ? Sc.completer(mandat().criteres) : Sc.completer(Md.normaliser({})));
  const analyses = () => (E.etat ? E.etat.departements.filter((d) => d.analyse).map((d) => d.code) : []);
  /** Les departements de la recherche : les pastilles de zone, sinon ceux du mandat, sinon tout ce qui est analyse. */
  function portee() {
    const f = E.filtres;
    const voulus = f && f.zones.length ? Md.departementsDe(f.zones) : criteres().departements.length ? criteres().departements : analyses();
    return { depts: voulus.filter((d) => analyses().includes(d)), manquants: voulus.filter((d) => !analyses().includes(d)) };
  }
  function filtresDuMandat() {
    const c = criteres();
    return { zones: [], types: [...c.types], valeurMin: c.ticketMin, valeurMax: c.ticketMax, scoreMin: 0, signaux: [], confiances: ['fort', 'moyen', 'faible'], texte: '' };
  }
  async function chargerCibles() {
    const { depts } = portee();
    await Promise.all(depts.filter((d) => !E.donnees.has(d)).map((d) => api(`/prospection/departements/${d}/cibles`).then((r) => E.donnees.set(d, r)).catch(() => {})));
    E.cibles = Sc.fusionner(depts.map((d) => (E.donnees.get(d) || { cibles: [] }).cibles));
    recalculer();
  }
  function recalculer() {
    const c = criteres();
    E.scores = new Map(E.cibles.map((x) => [x.id, Sc.scorer(x, c)]));
  }
  async function chargerSuivis() {
    const s = await api(`/prospection/suivis${E.mandatId ? `?mandat=${E.mandatId}` : ''}`).catch(() => []);
    E.suivis = new Map(s.map((x) => [x.cible_id, x]));
  }
  async function chargerBase() {
    const [etat, mandats, listes, verifs, moi] = await Promise.all([api('/prospection/etat'), api('/prospection/mandats'), api('/prospection/listes'), api('/prospection/verifications'), api('/auth/me').catch(() => ({}))]);
    // Visiteur de la demo (vitrine, sans compte) : pas d'analyse lancee ni d'Apollo.
    E.invite = !!moi.invite;
    E.etat = etat; E.mandats = mandats; E.listes = listes; E.verifs = new Map(verifs.map((v) => [v.cible_id, v]));
    let memo = null;
    try { memo = localStorage.getItem('prospection.mandat'); } catch { /* stockage refuse */ }
    E.mandatId = mandats.some((m) => m.id === memo) ? memo : (mandats[0] && mandats[0].id) || null;
    E.filtres = filtresDuMandat();
    await Promise.all([chargerCibles(), chargerSuivis()]);
  }
  async function activerMandat(id) {
    E.mandatId = id;
    try { localStorage.setItem('prospection.mandat', id || ''); } catch { /* idem */ }
    E.filtres = filtresDuMandat();
    E.toutes = false;
    E.carteXAjustee = false;
    await Promise.all([chargerCibles(), chargerSuivis()]);
    rendre();
  }

  const triees = (liste) => {
    const cle = { global: (x) => E.scores.get(x.id).global, valeur: (x) => x.totaux.centrale || 0, motivation: (x) => E.scores.get(x.id).motivation.score, locataire: (x) => E.scores.get(x.id).locataire.score, fit: (x) => E.scores.get(x.id).fit.score, nom: (x) => x.nom }[E.tri] || ((x) => E.scores.get(x.id).global);
    return [...liste].sort((a, b) => (E.tri === 'nom' ? String(cle(a)).localeCompare(cle(b)) : cle(b) - cle(a)));
  };
  /** Les cibles qui passent les filtres (hors cibles ecartees du pipeline et exclues par le mandat). */
  function filtrees({ bornes = true } = {}) {
    const f = E.filtres;
    const t = norm(f.texte);
    return triees(E.cibles.filter((x) => {
      const s = E.scores.get(x.id);
      if (s.exclu) return false;
      const v = x.totaux.centrale;
      if (f.valeurMin && (v == null || v < f.valeurMin)) return false;
      if (f.valeurMax && v != null && v > f.valeurMax) return false;
      if (!f.types.includes(x.type_actif)) return false;
      if (s.global < f.scoreMin) return false;
      if (f.signaux.length && !f.signaux.every((k) => s.signaux.includes(k))) return false;
      if (!f.confiances.includes(x.confiance)) return false;
      if (t && !norm(`${x.nom} ${x.murs.map((m) => `${m.parcelle.commune} ${m.proprietaire.nom}`).join(' ')}`).includes(t)) return false;
      const suivi = E.suivis.get(x.id);
      if (suivi && suivi.etape === 'ecartee') return false;
      if (bornes && E.suivreCarte && E.bornes && !E.bornes(x.lat, x.lon)) return false;
      return true;
    }));
  }

  // ------------------------------------------------------------------ adresse
  // Street View doit partir de l'ADRESSE du local, comme Google Maps, et non du centre de la
  // parcelle : sur un grand terrain, le centre peut etre a plus de 100 m, et la vue la plus
  // proche donnait sur une autre rue (Robertet, 37 av. Sidi Brahim a Grasse : 135 m).
  // Geocodage de la Geoplateforme de l'IGN (l'ancienne API Adresse de data.gouv.fr ne repond
  // plus) ; seul un resultat au numero pres est retenu, sinon on garde le centre de la parcelle.
  const pointsAdresse = new Map();
  function pointAdresse(m) {
    const p = m.parcelle;
    if (pointsAdresse.has(p.id)) return pointsAdresse.get(p.id);
    const repli = { lat: p.lat, lon: p.lon, exact: false };
    const q = new URLSearchParams({ q: `${p.adresse} ${p.commune}`, citycode: p.insee, index: 'address', limit: '1' });
    const promesse = /^\d/.test(p.adresse || '')
      ? fetch(`https://data.geopf.fr/geocodage/search?${q}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).then((j) => {
        const f = j.features && j.features[0];
        if (!f || f.properties.type !== 'housenumber' || f.properties.score < 0.5) return repli;
        return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], exact: true, label: f.properties.label };
      }).catch(() => repli)
      : Promise.resolve(repli);
    pointsAdresse.set(p.id, promesse);
    return promesse;
  }
  const lienStreetView = (pt) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${pt.lat},${pt.lon}`;
  /** Une fois l'adresse geocodee, les liens « Street View » marques data-sv pointent sur elle. */
  function majLiensStreetView(racine) {
    racine.querySelectorAll('a[data-sv]').forEach((a) => {
      const m = (E.cibles.find((c) => c.murs.some((x) => x.parcelle.id === a.dataset.sv)) || { murs: [] }).murs.find((x) => x.parcelle.id === a.dataset.sv);
      if (m) pointAdresse(m).then((pt) => { a.href = lienStreetView(pt); });
    });
  }

  // ------------------------------------------------------------------ carte
  // La carte garde le style standard de Google Maps, quel que soit le theme de l'application
  // (demande du 21 oct. 2026 : pas de carte sombre).
  const styleCarte = () => null;
  let promesseCarte = null;
  /** Google Maps si la cle est la et acceptee, sinon Leaflet (tuiles CARTO) : la page marche toujours. */
  function chargerCartes() {
    if (promesseCarte) return promesseCarte;
    const script = (src) => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
    const leaflet = () => {
      if (window.L) return Promise.resolve('leaflet');
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(l);
      return script('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js').then(() => 'leaflet');
    };
    promesseCarte = (async () => {
      if (!E.cle) return leaflet();
      try {
        await new Promise((ok, ko) => {
          const minuteur = setTimeout(() => ko(new Error('Google Maps ne répond pas')), 12000);
          window.__leezCartePrete = () => { clearTimeout(minuteur); ok(); };
          // Cle refusee (domaine non autorise) : Google appelle gm_authFailure, on repasse en Leaflet.
          window.gm_authFailure = () => { E.cle = null; promesseCarte = null; E.carteX = null; E.carteF = null; rendre(); };
          script(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(E.cle)}&libraries=geometry&loading=async&callback=__leezCartePrete`).catch(ko);
        });
        await script('https://cdn.jsdelivr.net/npm/@googlemaps/markerclusterer@2/dist/index.min.js').catch(() => {});
        return 'google';
      } catch { return leaflet(); }
    })();
    return promesseCarte;
  }

  /** La carte de l'Explorer : un conteneur garde d'une vue a l'autre, deplace dans la page a chaque rendu. */
  function carteExplorer(moteur) {
    if (E.carteX && E.carteX.moteur === moteur) return E.carteX;
    const el = document.createElement('div');
    el.className = 'pr-carte';
    if (moteur === 'google') {
      const g = window.google.maps;
      const carte = new g.Map(el, { center: { lat: 46.6, lng: 2.4 }, zoom: 6, styles: styleCarte(), disableDefaultUI: true, zoomControl: true, fullscreenControl: true, mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'], position: g.ControlPosition.TOP_RIGHT }, gestureHandling: 'greedy' });
      let marqueurs = new Map();
      let groupe = null;
      const icone = (x, actif) => ({ path: g.SymbolPath.CIRCLE, scale: Math.min(15, 5 + Math.sqrt((x.totaux.centrale || 0) / 1e6) * 1.4) + (actif ? 2 : 0), fillColor: couleurBrute(E.scores.get(x.id).global), fillOpacity: 0.95, strokeColor: actif ? '#1c1d1c' : '#ffffff', strokeWeight: actif ? 2.5 : 1 });
      carte.addListener('idle', () => {
        const b = carte.getBounds();
        E.bornes = b ? (lat, lon) => b.contains({ lat, lng: lon }) : null;
        if (E.suivreCarte && E.vue === 'explorer') rendreResultats({ carte: false });
      });
      E.carteX = {
        moteur, el,
        points(liste) {
          if (groupe) groupe.clearMarkers();
          for (const m of marqueurs.values()) m.setMap(null);
          marqueurs = new Map(liste.map((x) => {
            const m = new g.Marker({ position: { lat: x.lat, lng: x.lon }, title: `${x.nom} · ${M(x.totaux.centrale)} · ${E.scores.get(x.id).global}/100`, icon: icone(x, false), zIndex: E.scores.get(x.id).global });
            m.addListener('click', () => aller(`cible/${x.id}`));
            return [x.id, m];
          }));
          const MC = window.markerClusterer && window.markerClusterer.MarkerClusterer;
          if (MC && liste.length > 60) {
            const accent = css('--accent');
            groupe = new MC({ map: carte, markers: [...marqueurs.values()], renderer: { render: ({ count, position }) => new g.Marker({ position, icon: { path: g.SymbolPath.CIRCLE, scale: 13 + Math.min(12, Math.log2(count) * 2), fillColor: accent, fillOpacity: 0.9, strokeColor: '#ffffff', strokeWeight: 2 }, label: { text: String(count), color: css('--on-accent') || '#121312', fontSize: '11.5px', fontWeight: '600' }, zIndex: 10000 + count }) } });
          } else { groupe = null; for (const m of marqueurs.values()) m.setMap(carte); }
        },
        surligner(id) { for (const [k, m] of marqueurs) { const x = E.cibles.find((c) => c.id === k); if (x) m.setIcon(icone(x, k === id)); } },
        ajuster(liste) {
          if (!liste.length) return;
          const b = new g.LatLngBounds();
          for (const x of liste) b.extend({ lat: x.lat, lng: x.lon });
          carte.fitBounds(b, 48);
          g.event.addListenerOnce(carte, 'idle', () => { if (carte.getZoom() > 13) carte.setZoom(13); });
        },
        theme() {},
        redim() {},
      };
      return E.carteX;
    }
    const L = window.L;
    const carte = L.map(el, { preferCanvas: true, zoomControl: true }).setView([46.6, 2.4], 6);
    const tuiles = () => L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap © CARTO' });
    let fond = tuiles().addTo(carte);
    const couche = L.layerGroup().addTo(carte);
    carte.on('moveend', () => { const b = carte.getBounds(); E.bornes = (lat, lon) => b.contains([lat, lon]); if (E.suivreCarte && E.vue === 'explorer') rendreResultats({ carte: false }); });
    let points = new Map();
    E.carteX = {
      moteur, el,
      points(liste) {
        couche.clearLayers();
        points = new Map(liste.map((x) => {
          const m = L.circleMarker([x.lat, x.lon], { radius: Math.min(14, 5 + Math.sqrt((x.totaux.centrale || 0) / 1e6) * 1.3), weight: 1, color: '#ffffff', fillColor: couleurBrute(E.scores.get(x.id).global), fillOpacity: 0.95 });
          m.bindTooltip(`${esc(x.nom)} · ${M(x.totaux.centrale)} · ${E.scores.get(x.id).global}/100`);
          m.on('click', () => aller(`cible/${x.id}`));
          m.addTo(couche);
          return [x.id, m];
        }));
      },
      surligner(id) { for (const [k, m] of points) m.setStyle({ weight: k === id ? 2.5 : 1, color: k === id ? '#1c1d1c' : '#ffffff' }); },
      ajuster(liste) { if (liste.length) carte.fitBounds(liste.map((x) => [x.lat, x.lon]), { padding: [40, 40], maxZoom: 13 }); },
      theme() { carte.removeLayer(fond); fond = tuiles().addTo(carte); fond.bringToBack(); },
      redim() { setTimeout(() => carte.invalidateSize(), 30); },
    };
    return E.carteX;
  }

  /** La carte de la fiche : vue satellite, contours des parcelles, et Street View en vignette. */
  function carteFiche(moteur, el, panneauSV, x) {
    const murs = x.murs.filter((m) => m.parcelle.contour);
    const accent = css('--accent');
    if (moteur === 'google') {
      const g = window.google.maps;
      const carte = new g.Map(el, { center: { lat: x.lat, lng: x.lon }, zoom: 17, mapTypeId: 'hybrid', tilt: 0, disableDefaultUI: true, zoomControl: true, fullscreenControl: true, mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['hybrid', 'roadmap'], position: g.ControlPosition.TOP_RIGHT }, styles: styleCarte(), gestureHandling: 'greedy' });
      const b = new g.LatLngBounds();
      for (const m of murs) {
        const chemin = m.parcelle.contour.map(([lng, lat]) => ({ lat, lng }));
        chemin.forEach((p) => b.extend(p));
        new g.Polygon({ map: carte, paths: chemin, strokeColor: accent, strokeWeight: 2.5, fillColor: accent, fillOpacity: 0.18 });
      }
      for (const m of x.murs) new g.Marker({ map: carte, position: { lat: m.parcelle.lat, lng: m.parcelle.lon }, title: m.parcelle.adresse, icon: { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: accent, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 } });
      if (!b.isEmpty()) { carte.fitBounds(b, 60); g.event.addListenerOnce(carte, 'idle', () => { if (carte.getZoom() > 18) carte.setZoom(18); }); }
      // Street View : la vue la plus proche de l'adresse du site principal, tournee vers elle.
      pointAdresse(x.murs[0]).then((pt) => {
        const cible = new g.LatLng(pt.lat, pt.lon);
        new g.Marker({ map: carte, position: cible, title: pt.label || x.murs[0].parcelle.adresse, icon: { path: g.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 5, fillColor: '#ffffff', fillOpacity: 1, strokeColor: '#1c1d1c', strokeWeight: 1.5 } });
        const sv = new g.StreetViewService();
        const chercher = (rayon, ensuite) => sv.getPanorama({ location: cible, radius: rayon, source: g.StreetViewSource.OUTDOOR, preference: g.StreetViewPreference.NEAREST }, (data, statut) => (statut === 'OK' ? afficher(data) : ensuite()));
        const afficher = (data) => {
          const cap = g.geometry ? g.geometry.spherical.computeHeading(data.location.latLng, cible) : 0;
          panneauSV.innerHTML = '';
          new g.StreetViewPanorama(panneauSV, { pano: data.location.pano, pov: { heading: cap, pitch: 4 }, zoom: 0, disableDefaultUI: true, clickToGo: true, addressControl: false, fullscreenControl: true });
          if (!pt.exact) panneauSV.insertAdjacentHTML('beforeend', '<div class="pr-sv-note">Adresse non trouvée au numéro près : vue prise au centre de la parcelle</div>');
        };
        chercher(50, () => chercher(150, () => { panneauSV.innerHTML = '<div class="pr-sv-vide">Pas d\'image Street View à proximité</div>'; }));
      });
      return { theme() { carte.setOptions({ styles: styleCarte() }); } };
    }
    const L = window.L;
    const carte = L.map(el, { zoomControl: true }).setView([x.lat, x.lon], 17);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri, Maxar' }).addTo(carte);
    const pts = [];
    for (const m of murs) { const p = m.parcelle.contour.map(([lng, lat]) => [lat, lng]); pts.push(...p); L.polygon(p, { color: accent, weight: 2.5, fillOpacity: 0.18 }).addTo(carte); }
    if (pts.length) carte.fitBounds(pts, { padding: [50, 50], maxZoom: 18 });
    panneauSV.innerHTML = `<a class="pr-sv-vide" data-sv="${x.murs[0].parcelle.id}" href="${lienStreetView({ lat: x.lat, lon: x.lon })}" target="_blank" rel="noopener">Ouvrir Street View ↗</a>`;
    majLiensStreetView(panneauSV);
    return { theme() {} };
  }

  // ------------------------------------------------------------------ cadre
  function rendre() {
    const app = $('prApp');
    if (!app || !E.pret) return;
    if (!app.querySelector('.pr-entete')) {
      app.innerHTML = '<header class="pr-entete"><nav class="pr-onglets" id="prOnglets"></nav><div class="pr-entete-droite" id="prEnteteDroite"></div></header><div class="pr-corps" id="prCorpsVue"></div>';
    }
    const onglets = [['accueil', 'Accueil'], ['explorer', 'Explorer'], ['listes', 'Listes'], ['pipeline', 'Pipeline'], ['mandats', 'Critères']];
    const actif = ['cible', 'tableau', 'verification'].includes(E.vue) ? 'explorer' : E.vue;
    $('prOnglets').innerHTML = onglets.map(([k, mot]) => `<a href="#prospection${k === 'accueil' ? '' : `/${k}`}" data-aller="${k === 'accueil' ? '' : k}" class="${actif === k ? 'actif' : ''}">${mot}</a>`).join('');
    rendreEntete();
    const corps = $('prCorpsVue');
    corps.className = `pr-corps vue-${E.vue}`;
    const vues = { accueil: vueAccueil, explorer: vueExplorer, tableau: vueTableau, cible: vueFiche, listes: vueListes, pipeline: vuePipeline, mandats: vueMandats, verification: vueVerification };
    (vues[E.vue] || vueAccueil)(corps);
  }
  function rendreEntete() {
    if (!$('prEnteteDroite')) return;
    const f = E.etat && E.etat.file;
    const enCours = f && f.en_cours;
    $('prEnteteDroite').innerHTML = `
      ${enCours ? `<span class="pr-file" title="${esc(enCours.message || '')}"><span class="pr-spin"></span>Analyse ${esc(Md.zoneLisible(enCours.dept))}${enCours.total ? ` · ${Math.round(((enCours.fait || 0) / enCours.total) * 100)} %` : ''}${f.attente.length ? ` · ${f.attente.length} en attente` : ''}</span>` : ''}
      <label class="pr-mandat-actif"><span>Critères</span><select id="prMandatActif"><option value="">Par défaut</option>${E.mandats.map((m) => `<option value="${m.id}" ${m.id === E.mandatId ? 'selected' : ''}>${esc(m.nom)}</option>`).join('')}</select></label>`;
    $('prMandatActif').onchange = (e) => activerMandat(e.target.value || null);
  }

  function route() {
    const parts = location.hash.replace(/^#/, '').split('/');
    E.vue = parts[1] || 'accueil';
    E.param = parts[2] ? decodeURIComponent(parts[2]) : null;
    rendre();
    window.scrollTo(0, 0);
  }
  function aller(chemin) {
    history.pushState(null, '', `#prospection${chemin ? `/${chemin}` : ''}`);
    route();
  }

  // ------------------------------------------------------------------ accueil
  function vueAccueil(corps) {
    const nb = analyses().length;
    const verif06 = analyses().includes('06') ? verificationDe('06') : null;
    corps.innerHTML = `
      <section class="pr-hero">
        <div class="pr-hero-fond" aria-hidden="true"></div>
        <div class="pr-hero-contenu">
          <h1>Décrivez vos critères</h1>
          <p>Leez lit vos critères et trouve les entreprises françaises qui possèdent leurs murs, avec la raison de vendre et le cash libérable.</p>
          <form class="pr-prompt" id="prPrompt">
            <span class="pr-prompt-etiquette">Critères</span>
            <textarea id="prPhrase" rows="2" placeholder="SCPI logistique et activité, 8 à 30 M€, Auvergne-Rhône-Alpes et PACA, bail ferme 9 ans minimum">${esc(E.proposition ? E.proposition.phrase : '')}</textarea>
            <div class="pr-prompt-pied"><span>Entrée pour lire les critères</span><button type="submit" class="pr-envoyer" aria-label="Lire les critères"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div>
          </form>
          <div class="pr-ou"><span>ou</span></div>
          <button type="button" class="pr-pilule-claire" data-aller="explorer">${ICONES.carte}Explorer la carte</button>
        </div>
      </section>
      <div id="prProposition"></div>
      <section class="pr-trois">
        <div class="pr-colonne">
          <h3>Critères</h3>
          <div class="pr-lignes">${E.mandats.length ? E.mandats.slice(0, 6).map((m) => `
            <button type="button" class="pr-ligne" data-mandat="${m.id}"><span class="pr-ligne-ico">${ICONES.mandat}</span><span class="pr-ligne-txt"><b>${esc(m.nom)}</b><small>${m.compteurs.suivies} suivies · ${m.compteurs.en_approche} en approche · ${m.compteurs.en_discussion} en discussion</small></span>${ICONES.chevron}</button>`).join('') : '<div class="pr-vide-ligne">Aucun critère enregistré. Décrivez-les ci-dessus.</div>'}</div>
        </div>
        <div class="pr-colonne">
          <h3>Mes listes</h3>
          <div class="pr-lignes">${E.listes.length ? E.listes.slice(0, 6).map((l) => `
            <button type="button" class="pr-ligne" data-aller="tableau/${l.id}"><span class="pr-ligne-ico">${ICONES.dossier}</span><span class="pr-ligne-txt"><b>${esc(l.nom)}</b><small>${l.cibles.length} cible${l.cibles.length > 1 ? 's' : ''}</small></span>${ICONES.chevron}</button>`).join('') : '<div class="pr-vide-ligne">Aucune liste. Ajoutez des cibles depuis l\'Explorer (icône signet).</div>'}</div>
        </div>
        <div class="pr-colonne">
          <h3>Analyses</h3>
          <div class="pr-lignes">
            ${verif06 ? `<button type="button" class="pr-ligne pr-ligne-verif" data-aller="verification/06"><span class="pr-ligne-ico">${ICONES.liste}</span><span class="pr-ligne-txt"><b>Vérification du 06 : ${verif06.faites}/50</b><small>${verif06.faites ? `${verif06.ok} justes sur ${verif06.faites} contrôlées · objectif 40 sur 50` : 'Contrôler à la main les 50 meilleures cibles (lot 1)'}</small></span>${ICONES.chevron}</button>` : ''}
            ${E.etat.departements.filter((d) => d.analyse || (d.job && ['en_cours', 'attente'].includes(d.job.etat))).map((d) => `
              <button type="button" class="pr-ligne" data-zone="${d.code}" ${d.analyse ? '' : 'disabled'}><span class="pr-ligne-ico">${ICONES.analyse}</span><span class="pr-ligne-txt"><b>${esc(d.nom)} (${d.code})</b><small>${d.job && ['en_cours', 'attente'].includes(d.job.etat) ? (d.job.etat === 'attente' ? 'En attente' : esc(d.job.message || 'En cours')) : `${d.analyse.cibles} entreprises · ${dateFr(d.analyse.fini_le)}`}</small></span>${ICONES.chevron}</button>`).join('')}
            ${E.invite ? '<div class="pr-vide-ligne">Mode démo : les départements déjà analysés sont ouverts. <a href="/login.html">Connectez-vous</a> pour en lancer d\'autres.</div>' : ''}<form class="pr-ligne pr-ligne-form" id="prAnalyser" ${E.invite ? 'hidden' : ''}><select id="prAnalyserDept">${E.etat.departements.map((d) => `<option value="${d.code}">${d.code} · ${esc(d.nom)}${d.analyse ? ' ✓' : ''}</option>`).join('')}</select><button type="submit" class="btn btn-outline pr-petit">Analyser</button></form>
          </div>
          <p class="pr-note">${nb} département${nb > 1 ? 's' : ''} analysé${nb > 1 ? 's' : ''}. Un nouveau département prend 10 à 40 minutes en tâche de fond ; ensuite, tout répond instantanément.</p>
        </div>
      </section>`;
    if (E.proposition) dessinerProposition();
    $('prPrompt').onsubmit = async (e) => { e.preventDefault(); await lirePhrase($('prPhrase').value); };
    $('prPhrase').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); lirePhrase(e.target.value); } };
    corps.querySelectorAll('[data-mandat]').forEach((b) => { b.onclick = async () => { await activerMandat(b.dataset.mandat); aller('explorer'); }; });
    corps.querySelectorAll('[data-zone]').forEach((b) => { b.onclick = async () => { E.filtres.zones = [b.dataset.zone]; E.carteXAjustee = false; await chargerCibles(); aller('explorer'); }; });
    $('prAnalyser').onsubmit = async (e) => {
      e.preventDefault();
      try { E.etat.file = await api('/prospection/analyses', { method: 'POST', body: { departements: [$('prAnalyserDept').value] } }); avis(`Analyse du ${$('prAnalyserDept').value} en file d'attente`); suivreFile(); } catch (err) { avis(err.message, true); }
    };
  }

  async function lirePhrase(phrase) {
    if (!phrase.trim()) return;
    const r = await api('/prospection/mandats/lire', { method: 'POST', body: { phrase } });
    E.proposition = { phrase, criteres: r.criteres, reconnu: r.reconnu, client: r.brut.client || '' };
    dessinerProposition();
    $('prProposition').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Le formulaire de mandat (creation depuis la phrase, ou modification). */
  function formulaireMandat(c, { nom = '', client = '', reconnu = null, id = null } = {}) {
    const types = Object.entries(Sc.TYPES_ACTIF).filter(([k]) => k !== 'autre');
    return `
      <form class="pr-panneau pr-form-mandat" id="prFormMandat" data-id="${id || ''}">
        <div class="pr-panneau-tete"><h3>${id ? 'Modifier les critères' : 'Les critères compris'}</h3>${reconnu ? `<div class="pr-reconnu">${reconnu.length ? reconnu.map((r) => `<span>${esc(r)}</span>`).join('') : '<span class="vide">Rien reconnu : remplissez le formulaire</span>'}</div>` : ''}</div>
        <div class="pr-grille-form">
          <label class="pr-champ large"><span>Nom</span><input name="nom" value="${esc(nom || Md.nomDe(c, Sc.TYPES_ACTIF))}"></label>
          <label class="pr-champ"><span>Client SCPI</span><input name="client" value="${esc(client)}" placeholder="—"></label>
          <label class="pr-champ"><span>Ticket min (M€)</span><input name="ticketMin" type="number" step="0.5" min="0" value="${c.ticketMin / 1e6}"></label>
          <label class="pr-champ"><span>Ticket max (M€)</span><input name="ticketMax" type="number" step="0.5" min="0" value="${c.ticketMax / 1e6}"></label>
          <label class="pr-champ"><span>Bail ferme min (ans)</span><input name="bailMinAns" type="number" min="0" max="30" value="${c.bailMinAns}"></label>
          <label class="pr-champ"><span>Rendement cible (%)</span><input name="rendement" type="number" step="0.1" min="1" max="20" value="${c.rendement}"></label>
          <label class="pr-champ large"><span>Zones (régions, départements)</span><input name="zones" value="${esc(c.zones.join(', '))}" placeholder="Vide = toute la France analysée"></label>
          <div class="pr-champ large"><span>Types d'actifs</span><div class="pr-pastilles">${types.map(([k, mot]) => `<label class="pr-pastille-choix"><input type="checkbox" name="types" value="${k}" ${c.types.includes(k) ? 'checked' : ''}><span>${esc(mot)}</span></label>`).join('')}</div></div>
          <label class="pr-champ large"><span>Secteurs exclus (codes NAF, ex. 56, 47.11)</span><input name="exclusionsNaf" value="${esc(c.exclusionsNaf.join(', '))}" placeholder="—"></label>
          <div class="pr-champ large"><span>Pondération des scores</span><div class="pr-poids">${[['fit', 'Fit'], ['motivation', 'Motivation'], ['locataire', 'Locataire']].map(([k, mot]) => `<label>${mot}<input type="range" name="poids_${k}" min="0" max="100" step="5" value="${c.poids[k]}"><output>${c.poids[k]} %</output></label>`).join('')}</div></div>
        </div>
        <div class="pr-form-pied"><button type="button" class="btn btn-ghost" id="prAnnulerMandat">Annuler</button><button type="submit" class="btn btn-solid">${id ? 'Enregistrer' : 'Enregistrer les critères'}</button></div>
      </form>`;
  }
  function lireFormulaire(form) {
    const v = (n) => form.elements[n].value;
    return {
      nom: v('nom'), client: v('client'),
      criteres: {
        ticketMin: Number(v('ticketMin')) * 1e6, ticketMax: Number(v('ticketMax')) * 1e6, bailMinAns: Number(v('bailMinAns')), rendement: Number(v('rendement')),
        zones: v('zones').split(/[,;]+/).map((z) => z.trim()).filter(Boolean),
        types: [...form.querySelectorAll('input[name="types"]:checked')].map((i) => i.value),
        exclusionsNaf: v('exclusionsNaf').split(/[,;\s]+/).filter(Boolean),
        poids: { fit: Number(v('poids_fit')), motivation: Number(v('poids_motivation')), locataire: Number(v('poids_locataire')) },
      },
    };
  }
  function brancherFormulaire(form, { apres }) {
    form.querySelectorAll('input[type="range"]').forEach((r) => { r.oninput = () => { r.nextElementSibling.textContent = `${r.value} %`; }; });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const contenu = lireFormulaire(form);
      const id = form.dataset.id;
      try {
        const r = await api(id ? `/prospection/mandats/${id}` : '/prospection/mandats', { method: id ? 'PUT' : 'POST', body: { ...contenu, phrase: E.proposition && E.proposition.phrase } });
        E.mandats = await api('/prospection/mandats');
        E.proposition = null;
        const lances = r.analyses_lancees || [];
        avis(lances.length ? `Critères enregistrés · ${lances.length} département${lances.length > 1 ? 's' : ''} mis en analyse` : 'Critères enregistrés');
        if (lances.length) { E.etat = await api('/prospection/etat'); suivreFile(); }
        await activerMandat(r.id);
        apres(r);
      } catch (err) { avis(err.message, true); }
    };
  }
  function dessinerProposition() {
    const p = E.proposition;
    $('prProposition').innerHTML = formulaireMandat(Sc.completer(p.criteres), { client: p.client, reconnu: p.reconnu });
    brancherFormulaire($('prFormMandat'), { apres: () => aller('explorer') });
    $('prAnnulerMandat').onclick = () => { E.proposition = null; $('prProposition').innerHTML = ''; };
  }

  // ------------------------------------------------------------------ explorer
  function barreRecherche() {
    const f = E.filtres;
    const c = criteres();
    const zonesAffichees = f.zones.length ? f.zones : c.zones;
    const nbFiltres = (f.types.length !== c.types.length ? 1 : 0) + (f.scoreMin ? 1 : 0) + f.signaux.length + (f.confiances.length < 3 ? 1 : 0) + (f.valeurMin !== c.ticketMin || f.valeurMax !== c.ticketMax ? 1 : 0);
    return `
      <div class="pr-recherche">
        <div class="pr-recherche-champ">
          ${zonesAffichees.map((z) => `<span class="pr-puce">${esc(Md.zoneLisible(z))}${f.zones.length ? `<button type="button" data-retirer-zone="${esc(z)}" aria-label="Retirer">${ICONES.fermer}</button>` : ''}</span>`).join('')}
          ${f.texte ? `<span class="pr-puce">« ${esc(f.texte)} »<button type="button" data-retirer-texte aria-label="Retirer">${ICONES.fermer}</button></span>` : ''}
          <input id="prChercher" placeholder="${zonesAffichees.length ? 'Ajouter un département, une région ou une entreprise' : 'Département, région ou entreprise'}" autocomplete="off">
          <button type="button" class="pr-loupe" id="prLoupe" aria-label="Chercher">${ICONES.chercher}</button>
        </div>
        ${menuFiltre("Type d'actif", Object.entries(Sc.TYPES_ACTIF).map(([k, mot]) => `<label><input type="checkbox" data-f="types" value="${k}" ${f.types.includes(k) ? 'checked' : ''}>${esc(mot)}</label>`).join(''))}
        ${menuFiltre('Valeur', `<div class="pr-menu-ligne"><label>Min (M€)<input type="number" step="0.5" data-f="valeurMin" value="${f.valeurMin ? f.valeurMin / 1e6 : ''}"></label><label>Max (M€)<input type="number" step="0.5" data-f="valeurMax" value="${f.valeurMax ? f.valeurMax / 1e6 : ''}"></label></div>`)}
        ${menuFiltre('Score', `<label class="pr-menu-curseur">Score global minimum<input type="range" min="0" max="90" step="5" data-f="scoreMin" value="${f.scoreMin}"><output>${f.scoreMin}</output></label>`)}
        ${menuFiltre('Signaux', SIGNAUX.map(([k, mot]) => `<label><input type="checkbox" data-f="signaux" value="${k}" ${f.signaux.includes(k) ? 'checked' : ''}>${esc(mot)}</label>`).join(''))}
        ${menuFiltre('Lien occupant', CONFIANCES.map(([k, mot]) => `<label><input type="checkbox" data-f="confiances" value="${k}" ${f.confiances.includes(k) ? 'checked' : ''}>${esc(mot)}</label>`).join(''))}
        ${nbFiltres ? `<span class="pr-nb-filtres" title="Filtres modifiés">${nbFiltres}</span>` : ''}
        <span class="pr-recherche-espace"></span>
        ${!mandat() ? '<button type="button" class="btn btn-outline pr-petit" id="prEnMandat">Enregistrer ces critères</button>' : ''}
        <button type="button" class="btn btn-ghost pr-petit" id="prReinit">Réinitialiser</button>
      </div>`;
  }
  const menuFiltre = (mot, contenu) => `<details class="pr-menu"><summary>${esc(mot)}<span class="pr-chev">▾</span></summary><div class="pr-menu-corps">${contenu}</div></details>`;

  function brancherRecherche(racine) {
    const f = E.filtres;
    const ajouter = async (texte) => {
      const t = texte.trim();
      if (!t) return;
      if (Md.departementsDe([t]).length) f.zones = [...new Set([...f.zones, t])]; else f.texte = t;
      await chargerCibles();
      E.carteXAjustee = false;
      rendre();
    };
    $('prChercher').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter(e.target.value); } };
    $('prLoupe').onclick = () => ajouter($('prChercher').value);
    racine.querySelectorAll('[data-retirer-zone]').forEach((b) => { b.onclick = async () => { f.zones = f.zones.filter((z) => z !== b.dataset.retirerZone); await chargerCibles(); E.carteXAjustee = false; rendre(); }; });
    racine.querySelectorAll('[data-retirer-texte]').forEach((b) => { b.onclick = () => { f.texte = ''; rendre(); }; });
    racine.querySelectorAll('[data-f]').forEach((i) => {
      i.oninput = () => {
        const k = i.dataset.f;
        if (i.type === 'checkbox') f[k] = [...racine.querySelectorAll(`[data-f="${k}"]:checked`)].map((x) => x.value);
        else if (k === 'scoreMin') { f.scoreMin = Number(i.value); i.nextElementSibling.textContent = i.value; }
        else f[k] = i.value === '' ? null : Number(i.value) * 1e6;
        if (E.vue === 'tableau') rendre(); else rendreResultats();
      };
    });
    // Un seul menu ouvert a la fois.
    racine.querySelectorAll('details.pr-menu').forEach((d) => { d.ontoggle = () => { if (d.open) racine.querySelectorAll('details.pr-menu').forEach((x) => { if (x !== d) x.open = false; }); }; });
    $('prReinit').onclick = async () => { E.filtres = filtresDuMandat(); E.suivreCarte = false; await chargerCibles(); E.carteXAjustee = false; rendre(); };
    if ($('prEnMandat')) $('prEnMandat').onclick = () => {
      E.proposition = { phrase: '', criteres: Md.normaliser({ ...criteres(), zones: f.zones, types: f.types, ticketMin: f.valeurMin || 0, ticketMax: f.valeurMax || 1e9 }), reconnu: null, client: '' };
      aller('');
    };
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('details.pr-menu')) document.querySelectorAll('details.pr-menu[open]').forEach((d) => { d.open = false; }); });

  function vueExplorer(corps) {
    const { manquants } = portee();
    corps.innerHTML = `
      ${barreRecherche()}
      <div class="pr-explorer">
        <aside class="pr-resultats">
          <div class="pr-resultats-tete">
            <span id="prCompte"></span>
            <div class="pr-resultats-outils">
              <select id="prTri" aria-label="Trier"><option value="global">Score global</option><option value="valeur">Valeur des murs</option><option value="motivation">Motivation</option><option value="locataire">Locataire</option><option value="nom">Nom</option></select>
              <button type="button" class="pr-icone-btn" data-aller="tableau" title="Vue tableau">${ICONES.liste}</button>
            </div>
          </div>
          ${manquants.length ? `<div class="pr-bandeau-info">${manquants.length} département${manquants.length > 1 ? 's' : ''} des critères pas encore analysé${manquants.length > 1 ? 's' : ''} (${manquants.slice(0, 6).join(', ')}${manquants.length > 6 ? '…' : ''}). ${E.invite ? 'Connectez-vous pour les analyser.' : '<button type="button" id="prAnalyserManquants">Les analyser</button>'}</div>` : ''}
          <div class="pr-cartes-res" id="prCartesRes"></div>
        </aside>
        <div class="pr-carte-zone" id="prCarteZone">
          <div class="pr-synthese" id="prSynthese"></div>
          <label class="pr-suivre-carte"><input type="checkbox" id="prSuivreCarte" ${E.suivreCarte ? 'checked' : ''}>Rechercher en déplaçant la carte</label>
          <div class="pr-legende"><span><i style="background:var(--green)"></i>Score ≥ 60</span><span><i style="background:var(--amber)"></i>40 à 59</span><span><i style="background:var(--text-faint)"></i>&lt; 40</span><span class="pr-sous">taille : valeur des murs</span></div>
        </div>
      </div>`;
    brancherRecherche(corps);
    $('prTri').value = E.tri;
    $('prTri').onchange = (e) => { E.tri = e.target.value; rendreResultats({ carte: false }); };
    $('prSuivreCarte').onchange = (e) => { E.suivreCarte = e.target.checked; rendreResultats({ carte: false }); };
    if ($('prAnalyserManquants')) $('prAnalyserManquants').onclick = async () => { E.etat.file = await api('/prospection/analyses', { method: 'POST', body: { departements: manquants } }); avis(`${manquants.length} département(s) en file d'attente`); suivreFile(); rendreEntete(); };
    rendreResultats({ carte: false });
    chargerCartes().then((moteur) => {
      if (E.vue !== 'explorer' || !$('prCarteZone')) return;
      const c = carteExplorer(moteur);
      $('prCarteZone').prepend(c.el);
      c.redim();
      rendreResultats({ ajuster: !E.carteXAjustee });
      E.carteXAjustee = true;
    });
  }

  function rendreResultats({ ajuster = false, carte = true } = {}) {
    if (!$('prCartesRes')) return;
    const toutes = filtrees();
    const montrees = E.toutes ? toutes : toutes.slice(0, 20);
    const c = criteres();
    $('prCompte').innerHTML = `<b>${N(toutes.length)}</b> cible${toutes.length > 1 ? 's' : ''}${toutes.length > 20 ? ` · ${E.toutes ? 'toutes affichées' : 'les 20 meilleures'}` : ''}`;
    const total = (k) => toutes.reduce((t, x) => t + (x.totaux[k] || 0), 0);
    $('prSynthese').innerHTML = `<div><span>Cibles</span><b>${N(toutes.length)}</b></div><div><span>Valeur des murs</span><b>${M(total('centrale') || null)}</b></div><div><span>Cash libérable</span><b>${M(total('basse') || null)} à ${M(total('haute') || null)}</b></div><div><span>Loyer induit à ${c.rendement} %</span><b>${M(total('centrale') ? Math.round(total('centrale') * c.rendement / 100) : null)}</b></div>`;
    $('prCartesRes').innerHTML = montrees.map(carteResultat).join('') + (toutes.length > 20 ? `<button type="button" class="pr-voir-tout" id="prVoirTout">${E.toutes ? 'Revenir aux 20 meilleures' : `Voir les ${N(toutes.length)} cibles`}</button>` : '')
      + (!toutes.length ? `<div class="pr-vide">${E.cibles.length ? 'Aucune cible ne passe les filtres. Élargissez la valeur, les types ou le score.' : analyses().length ? 'Aucune cible dans cette zone pour l\'instant.' : 'Aucun département analysé. Lancez une analyse depuis l\'accueil.'}</div>` : '');
    $('prCartesRes').querySelectorAll('[data-cible]').forEach((el) => {
      el.onclick = (e) => { if (e.target.closest('[data-signet]')) return; aller(`cible/${el.dataset.cible}`); };
      el.onmouseenter = () => E.carteX && E.carteX.surligner(el.dataset.cible);
      el.onmouseleave = () => E.carteX && E.carteX.surligner(null);
    });
    $('prCartesRes').querySelectorAll('[data-signet]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); menuListe(b, [b.dataset.signet]); }; });
    $('prCartesRes').querySelectorAll('img[data-vignette]').forEach((img) => {
      const x = montrees.find((c) => c.murs[0].parcelle.id === img.dataset.vignette);
      if (x) pointAdresse(x.murs[0]).then((pt) => { img.src = `https://maps.googleapis.com/maps/api/streetview?size=176x132&location=${pt.lat},${pt.lon}&radius=60&source=outdoor&fov=85&return_error_code=true&key=${encodeURIComponent(E.cle)}`; });
    });
    if ($('prVoirTout')) $('prVoirTout').onclick = () => { E.toutes = !E.toutes; rendreResultats({ carte: false }); };
    // La carte montre tout ce qui passe les filtres (hors bornes de la carte) ; la liste se limite aux 20 meilleures.
    if (E.carteX && carte) {
      const surCarte = filtrees({ bornes: false });
      E.carteX.points(surCarte);
      if (ajuster) E.carteX.ajuster(surCarte);
    }
  }

  function vignette(x) {
    const img = E.cle ? `<img alt="" data-vignette="${x.murs[0].parcelle.id}" onerror="this.remove()">` : '';
    return `<div class="pr-vignette">${ICONES.batiment}${img}</div>`;
  }
  function carteResultat(x) {
    const s = E.scores.get(x.id);
    const suivi = E.suivis.get(x.id);
    const m = x.murs[0];
    const dansListe = E.listes.some((l) => l.cibles.includes(x.id));
    return `
      <article class="pr-res" data-cible="${x.id}">
        ${vignette(x)}
        <div class="pr-res-corps">
          <div class="pr-res-haut"><h4>${esc(x.nom)}</h4><button type="button" class="pr-signet ${dansListe ? 'actif' : ''}" data-signet="${x.id}" title="Ajouter à une liste">${ICONES.signet}</button></div>
          <div class="pr-res-adr">${esc(m.parcelle.adresse)}, ${esc(m.parcelle.commune)}${x.murs.length > 1 ? ` · +${x.murs.length - 1} site${x.murs.length > 2 ? 's' : ''}` : ''}</div>
          <div class="pr-res-type">${esc(Sc.TYPES_ACTIF[x.type_actif])} · ${esc(CONFIANCES.find(([k]) => k === x.confiance)[1])}${suivi ? ` · <span class="pr-etape-mini">${esc(ETAPE[suivi.etape])}</span>` : ''}</div>
          <div class="pr-res-chiffres">
            <div><span>Valeur des murs</span><b>${M(x.totaux.centrale)}</b></div>
            <div><span>Fourchette</span><b>${M(x.totaux.basse)} – ${M(x.totaux.haute)}</b></div>
            <div class="score"><span>Score</span><b style="color:${couleur(s.global)}">${s.global}</b></div>
          </div>
          <p class="pr-res-phrase">${esc(s.phrase)}</p>
        </div>
      </article>`;
  }

  // ------------------------------------------------------------------ listes (menu et vue)
  function menuListe(ancre, ids) {
    document.querySelectorAll('.pr-flottant').forEach((x) => x.remove());
    const menu = document.createElement('div');
    menu.className = 'pr-flottant';
    menu.innerHTML = `<div class="pr-flottant-titre">Ajouter à une liste</div>${E.listes.map((l) => `<button type="button" data-liste="${l.id}" data-nom="${esc(l.nom)}">${esc(l.nom)}<small>${l.cibles.length}</small></button>`).join('')}<form><input placeholder="Nouvelle liste…" maxlength="120"><button type="submit" class="btn btn-solid pr-petit">Créer</button></form>`;
    document.body.appendChild(menu);
    const r = ancre.getBoundingClientRect();
    menu.style.top = `${Math.max(12, Math.min(window.innerHeight - menu.offsetHeight - 12, r.bottom + 6))}px`;
    menu.style.left = `${Math.max(12, Math.min(window.innerWidth - menu.offsetWidth - 12, r.right - menu.offsetWidth))}px`;
    const fini = async (msg) => { menu.remove(); E.listes = await api('/prospection/listes'); avis(msg); if (E.vue === 'explorer') rendreResultats({ carte: false }); else rendre(); };
    menu.querySelectorAll('[data-liste]').forEach((b) => { b.onclick = async () => { await api(`/prospection/listes/${b.dataset.liste}/cibles`, { method: 'POST', body: { cibles: ids } }); fini(`Ajouté à « ${b.dataset.nom} »`); }; });
    menu.querySelector('form').onsubmit = async (e) => { e.preventDefault(); const nom = menu.querySelector('input').value.trim(); if (!nom) return; await api('/prospection/listes', { method: 'POST', body: { nom, mandat_id: E.mandatId, cibles: ids } }); fini(`Liste « ${nom} » créée`); };
    setTimeout(() => document.addEventListener('click', function fermer(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', fermer); } }), 0);
    menu.querySelector('input').focus();
  }

  function vueListes(corps) {
    corps.innerHTML = `
      <div class="pr-page">
        <div class="pr-page-tete"><h2>Listes</h2><p>Les cibles mises de côté, par jeu de critères. Ajoutez-en depuis l'Explorer ou la fiche (icône signet).</p></div>
        <div class="pr-lignes pr-lignes-larges">${E.listes.length ? E.listes.map((l) => {
          const m = E.mandats.find((x) => x.id === l.mandat_id);
          return `<div class="pr-ligne"><span class="pr-ligne-ico">${ICONES.dossier}</span><button type="button" class="pr-ligne-txt" data-aller="tableau/${l.id}"><b>${esc(l.nom)}</b><small>${l.cibles.length} cible${l.cibles.length > 1 ? 's' : ''}${m ? ` · ${esc(m.nom)}` : ''} · créée le ${dateFr(l.created_at)}</small></button><button type="button" class="btn btn-ghost pr-petit" data-suppr-liste="${l.id}">Supprimer</button><button type="button" class="pr-icone-btn" data-aller="tableau/${l.id}" aria-label="Ouvrir">${ICONES.chevron}</button></div>`;
        }).join('') : '<div class="pr-vide">Aucune liste pour l\'instant.</div>'}</div>
      </div>`;
    corps.querySelectorAll('[data-suppr-liste]').forEach((b) => { b.onclick = async () => { if (!confirm('Supprimer cette liste ? Les cibles restent dans l\'Explorer.')) return; await api(`/prospection/listes/${b.dataset.supprListe}`, { method: 'DELETE' }); E.listes = await api('/prospection/listes'); rendre(); }; });
  }

  // ------------------------------------------------------------------ tableau
  function vueTableau(corps) {
    const liste = E.param ? E.listes.find((l) => l.id === E.param) : null;
    const base = liste ? triees(E.cibles.filter((x) => liste.cibles.includes(x.id))) : filtrees({ bornes: false });
    const absentes = liste ? liste.cibles.filter((id) => !E.cibles.some((x) => x.id === id)).length : 0;
    corps.innerHTML = `
      ${liste ? '' : barreRecherche()}
      <div class="pr-page pr-page-large">
        <div class="pr-tableau-tete">
          <button type="button" class="pr-icone-btn" data-aller="${liste ? 'listes' : 'explorer'}" title="Retour">${ICONES.retour}</button>
          <div><small>${liste ? 'Liste' : 'Toutes les cibles'}</small><h2>${esc(liste ? liste.nom : (mandat() ? mandat().nom : 'Critères par défaut'))}</h2></div>
          <span class="pr-compte">${N(base.length)} cible${base.length > 1 ? 's' : ''}${absentes ? ` · ${absentes} hors des départements chargés` : ''}</span>
          <span class="pr-recherche-espace"></span>
          <button type="button" class="btn btn-outline pr-petit" id="prAjoutSel" disabled>Ajouter à une liste</button>
          <a class="btn btn-solid pr-petit" id="prExport" href="#">Exporter en CSV</a>
          ${liste ? '' : `<button type="button" class="pr-icone-btn" data-aller="explorer" title="Vue carte">${ICONES.carte}</button>`}
        </div>
        <div class="pr-table-defile">
          <table class="pr-table">
            <thead><tr><th><input type="checkbox" id="prToutCocher" aria-label="Tout sélectionner"></th><th>Étape</th><th>Entreprise</th><th>Adresse</th><th>Type</th><th class="num">Valeur centrale</th><th class="num">Fourchette</th><th class="num">Fit</th><th class="num">Motiv.</th><th class="num">Locat.</th><th class="num">Global</th><th>Lien</th><th>Pourquoi elle vendrait</th><th>Dirigeant</th><th>Vérif.</th></tr></thead>
            <tbody>${base.map((x) => {
              const s = E.scores.get(x.id);
              const suivi = E.suivis.get(x.id);
              const d = [...x.occupant.dirigeants].filter((p) => !p.personne_morale).sort((a, b) => (b.age || 0) - (a.age || 0))[0];
              const v = E.verifs.get(x.id);
              return `<tr data-cible="${x.id}">
                <td><input type="checkbox" class="pr-sel" value="${x.id}" aria-label="Sélectionner"></td>
                <td>${selectEtape(x.id, suivi)}</td>
                <td><a href="#prospection/cible/${x.id}" class="pr-nom">${esc(x.nom)}</a><div class="pr-sous">${x.id}</div></td>
                <td>${esc(x.murs[0].parcelle.adresse)}<div class="pr-sous">${esc(x.murs[0].parcelle.commune)}${x.murs.length > 1 ? ` · ${x.murs.length} sites` : ''}</div></td>
                <td>${esc(Sc.TYPES_ACTIF[x.type_actif])}</td>
                <td class="num"><b>${M(x.totaux.centrale)}</b></td><td class="num pr-sous">${M(x.totaux.basse)} – ${M(x.totaux.haute)}</td>
                <td class="num">${pastilleScore(s.fit.score)}</td><td class="num">${pastilleScore(s.motivation.score)}</td><td class="num">${s.locataire.exclu ? '<span class="pr-exclu">exclu</span>' : pastilleScore(s.locataire.score)}</td><td class="num">${pastilleScore(s.global)}</td>
                <td><span class="pr-conf ${x.confiance}">${esc(x.confiance)}</span></td>
                <td class="pr-cell-phrase">${esc(s.phrase)}</td>
                <td>${d ? `${esc(d.nom)}${d.age ? `<div class="pr-sous">${d.age} ans · ${esc(d.qualite || '')}</div>` : ''}` : '—'}</td>
                <td>${v ? `<span class="pr-verdict ${v.verdict}">${esc(VERDICTS.find(([k]) => k === v.verdict)[1])}</span>` : '<span class="pr-sous">—</span>'}</td>
              </tr>`;
            }).join('') || '<tr><td colspan="15" class="pr-vide">Aucune cible.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
    if (!liste) brancherRecherche(corps);
    const sel = () => [...corps.querySelectorAll('.pr-sel:checked')].map((i) => i.value);
    const majSel = () => { $('prAjoutSel').disabled = !sel().length; $('prAjoutSel').textContent = sel().length ? `Ajouter ${sel().length} à une liste` : 'Ajouter à une liste'; };
    corps.querySelectorAll('.pr-sel').forEach((i) => { i.onchange = majSel; });
    $('prToutCocher').onchange = (e) => { corps.querySelectorAll('.pr-sel').forEach((i) => { i.checked = e.target.checked; }); majSel(); };
    $('prAjoutSel').onclick = (e) => menuListe(e.currentTarget, sel());
    $('prExport').onclick = (e) => {
      e.preventDefault();
      const ids = sel().length ? sel() : base.map((x) => x.id);
      const depts = [...new Set(E.cibles.filter((x) => ids.includes(x.id)).flatMap((x) => x.departements))];
      window.location.href = `/api/prospection/export.csv?departements=${depts.join(',')}&ids=${ids.join(',')}${E.mandatId ? `&mandat=${E.mandatId}` : ''}`;
    };
    brancherEtapes(corps);
  }
  const pastilleScore = (s) => `<span class="pr-score" style="--c:${couleur(s)}">${s}</span>`;
  const selectEtape = (id, suivi) => `<select class="pr-etape" data-etape="${id}" aria-label="Étape du pipeline">${ETAPES.map(([k, mot]) => `<option value="${k}" ${(suivi ? suivi.etape : 'a_qualifier') === k ? 'selected' : ''}>${esc(mot)}</option>`).join('')}</select>`;
  function brancherEtapes(racine) {
    racine.querySelectorAll('select[data-etape]').forEach((s) => {
      s.onclick = (e) => e.stopPropagation();
      s.onchange = async () => {
        const id = s.dataset.etape;
        let motif = null;
        if (s.value === 'ecartee') {
          motif = prompt('Motif obligatoire pour écarter cette cible :');
          if (!motif || !motif.trim()) { s.value = (E.suivis.get(id) || {}).etape || 'a_qualifier'; return; }
        }
        try {
          const r = await api('/prospection/suivis', { method: 'PUT', body: { cible_id: id, mandat_id: E.mandatId, etape: s.value, motif_ecart: motif } });
          E.suivis.set(id, { ...(E.suivis.get(id) || {}), cible_id: id, etape: s.value, motif_ecart: motif, relance_le: r.relance_le || (E.suivis.get(id) || {}).relance_le });
          avis(`Étape : ${ETAPE[s.value]}${r.relance_le ? ` · relance le ${dateFr(r.relance_le)}` : ''}`);
          if (E.vue === 'pipeline') rendre();
        } catch (err) { avis(err.message, true); }
      };
    });
  }

  // ------------------------------------------------------------------ fiche
  async function vueFiche(corps) {
    const x = E.cibles.find((c) => c.id === E.param);
    if (!x) {
      corps.innerHTML = '<div class="pr-page"><div class="pr-vide">Cette entreprise n\'est pas dans les départements chargés pour ces critères. <a href="#prospection/explorer">Retour à l\'Explorer</a></div></div>';
      return;
    }
    api('/prospection/journal', { method: 'POST', body: { action: 'voir', cible_id: x.id } }).catch(() => {});
    const s = E.scores.get(x.id);
    const c = criteres();
    const cash = Sc.cashDe(x, c);
    const suivi = E.suivis.get(x.id);
    const v = E.verifs.get(x.id);
    const o = x.occupant;
    const m0 = x.murs[0];
    const ligne = (k, val, src = null) => `<tr><th>${k}</th><td>${val}${src ? `<div class="pr-src">${src}</div>` : ''}</td></tr>`;
    const lienExt = (href, mot) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(mot)}${ICONES.lien}</a>`;
    const annuaire = (siren) => `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;
    const signes = s.motivation.raisons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points);
    const evenements = x.bodacc.filter((e) => e.nature !== 'comptes');
    const raisons = (liste) => `<ul class="pr-raisons">${liste.map((r) => `<li><b class="${r.points > 0 ? 'pos' : r.points < 0 ? 'neg' : 'nul'}">${r.points > 0 ? '+' : ''}${r.points}</b><span>${esc(r.texte)}${r.source ? `<em> · ${esc(r.source)}</em>` : ''}${r.lien ? ` ${lienExt(r.lien, 'source')}` : ''}</span></li>`).join('')}</ul>`;
    const personnes = (liste) => liste.filter((d) => !d.personne_morale).map((d) => `<tr><th>${esc(d.nom)}</th><td>${esc(d.qualite || '—')}${d.age ? ` · ${d.age} ans` : ''}</td></tr>`).join('') || '<tr><td colspan="2" class="pr-sous">Non publié</td></tr>';
    corps.innerHTML = `
      <div class="pr-fiche-page">
        <div class="pr-fiche-gauche">
          <div class="pr-fiche-tete">
            <button type="button" class="pr-icone-btn" id="prRetour" title="Retour">${ICONES.retour}</button>
            <div class="pr-fiche-titre"><h2>${esc(x.nom)}</h2><div class="pr-sous">${esc(m0.parcelle.adresse)}, ${esc(m0.parcelle.commune)}${x.murs.length > 1 ? ` · ${x.murs.length} sites` : ''}</div></div>
            <div class="pr-fiche-actions">
              <button type="button" class="pr-icone-btn ${E.listes.some((l) => l.cibles.includes(x.id)) ? 'actif' : ''}" id="prFicheSignet" title="Ajouter à une liste">${ICONES.signet}</button>
              ${selectEtape(x.id, suivi)}
              <a class="btn btn-outline pr-petit" href="/api/prospection/export.csv?departements=${x.departements.join(',')}&ids=${x.id}${E.mandatId ? `&mandat=${E.mandatId}` : ''}">Exporter</a>
            </div>
          </div>

          <section class="pr-bloc pr-synthese-fiche">
            <div class="pr-scores4">
              <div><span>Global</span><b style="color:${couleur(s.global)}">${s.exclu ? 'exclu' : s.global}</b></div>
              <div><span>Fit</span><b>${s.fit.score}</b></div>
              <div><span>Motivation</span><b>${s.motivation.score}</b></div>
              <div><span>Locataire</span><b>${s.locataire.exclu ? 'exclu' : s.locataire.score}${s.locataire.partiel ? '<small> partiel</small>' : ''}</b></div>
            </div>
            <p class="pr-phrase"><b>Pourquoi elle vendrait.</b> ${esc(s.phrase)}</p>
            <div class="pr-conf-ligne"><span class="pr-conf ${x.confiance}">Lien ${esc(x.confiance)}</span>${esc(m0.lien.motif)}</div>
          </section>

          <section class="pr-bloc pr-verif">
            <h3>Vérification terrain</h3>
            <div class="pr-verif-choix">${VERDICTS.map(([k, mot]) => `<button type="button" class="pr-verdict-btn ${k} ${v && v.verdict === k ? 'actif' : ''}" data-verdict="${k}">${esc(mot)}</button>`).join('')}</div>
            <div class="pr-liens-verif">${lienExt(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${m0.parcelle.adresse} ${m0.parcelle.commune}`)}`, 'Google Maps')}<a data-sv="${m0.parcelle.id}" href="${lienStreetView({ lat: x.lat, lon: x.lon })}" target="_blank" rel="noopener">Street View${ICONES.lien}</a>${lienExt(`https://www.pappers.fr/entreprise/${x.id}`, 'Pappers')}${lienExt(annuaire(x.id), 'Annuaire des entreprises')}${lienExt(`https://cadastre.data.gouv.fr/map?style=ortho&parcelleId=${m0.parcelle.id}`, 'Cadastre')}</div>
            ${v && v.updated_at ? `<div class="pr-src">Vérifié par ${esc(v.user_email || '—')} le ${dateFr(v.updated_at)}</div>` : ''}
          </section>

          <section class="pr-bloc">
            <h3>Valeur et cash libérable</h3>
            <table class="pr-kv">
              ${ligne('Valeur des murs', cash ? `<b>${M(cash.centrale)}</b> <span class="pr-sous">basse ${M(cash.basse)} · haute ${M(cash.haute)}</span>` : '—', m0.valeur ? `${esc(m0.valeur.methode)} · ${esc(m0.valeur.source)} · ${dateFr(m0.valeur.date)}` : 'Moins de 5 ventes comparables à 20 km')}
              ${ligne('Dette garantie connue', '—', 'Aucune source ouverte de la dette : à demander à l\'entreprise')}
              ${ligne('Cash libérable', cash ? `<b>${M(cash.basse)} à ${M(cash.haute)}</b> <span class="pr-sous">avant dette et impôt sur la plus-value</span>` : '—')}
              ${ligne(`Loyer annuel induit (${c.rendement} %)`, cash ? `<b>${M(cash.loyer)}</b> <span class="pr-sous">au rendement cible des critères</span>` : '—')}
              ${ligne('Comparables', m0.valeur ? `${m0.valeur.n_comparables} ventes à ${m0.valeur.rayon_km} km · ${N(m0.valeur.prix_m2.q1)} / ${N(m0.valeur.prix_m2.mediane)} / ${N(m0.valeur.prix_m2.q3)} €/m²` : '—')}
            </table>
            ${m0.valeur && m0.valeur.comparables.length ? `<details class="pr-details"><summary>Les ${m0.valeur.comparables.length} ventes DVF les plus proches</summary><table class="pr-table pr-table-compacte"><thead><tr><th>Date</th><th>Adresse</th><th class="num">Surface</th><th class="num">Prix</th><th class="num">€/m²</th><th class="num">Distance</th></tr></thead><tbody>${m0.valeur.comparables.map((k) => `<tr><td>${dateFr(k.date)}</td><td><a href="https://explore.data.gouv.fr/fr/immobilier?onglet=carte&filtre=tous&lat=${k.lat}&lng=${k.lon}&zoom=18" target="_blank" rel="noopener">${esc(k.adresse || '—')}</a></td><td class="num">${N(Math.round(k.surface))} m²</td><td class="num">${M(k.prix)}</td><td class="num">${N(k.pm2)}</td><td class="num">${N(k.distance_m)} m</td></tr>`).join('')}</tbody></table></details>` : ''}
          </section>

          <section class="pr-bloc">
            <h3>Pourquoi elle vendrait</h3>
            ${signes.length ? `<ol class="pr-signaux">${signes.slice(0, 5).map((r) => `<li><b>+${r.points}</b><div>${esc(r.texte)}<div class="pr-src">${esc(r.source || '')}${r.date ? ` · ${dateFr(r.date)}` : ''}${r.lien ? ` · ${lienExt(r.lien, 'voir')}` : ''}</div></div></li>`).join('')}</ol>` : '<p class="pr-sous">Aucun signal de vente détecté dans les sources ouvertes.</p>'}
          </section>

          <section class="pr-bloc">
            <h3>Les murs</h3>
            ${x.murs.map((m, i) => `
              <div class="pr-mur">
                <div class="pr-mur-tete"><b>${i === 0 ? 'Site principal' : `Site ${i + 1}`}</b><span class="pr-conf ${m.lien.confiance}">Lien ${esc(m.lien.confiance)}</span></div>
                <table class="pr-kv">
                  ${ligne('Adresse', `${esc(m.parcelle.adresse)}, ${esc(m.parcelle.commune)}`)}
                  ${ligne('Parcelle', lienExt(`https://cadastre.data.gouv.fr/map?style=ortho&parcelleId=${m.parcelle.id}`, m.parcelle.id))}
                  ${ligne("Type d'actif", esc(Sc.TYPES_ACTIF[m.type_actif]))}
                  ${ligne('Surface estimée', `${N(m.parcelle.surface_estimee_m2)} m² <span class="pr-sous">emprise ${N(m.parcelle.emprise_batie_m2)} m² × ${m.parcelle.niveaux} niveau${m.parcelle.niveaux > 1 ? 'x' : ''}</span>`)}
                  ${ligne('Terrain', `${N(m.parcelle.contenance_m2)} m²`)}
                  ${ligne('Part des locaux détenue', `${Math.round((m.parcelle.part_detenue || 0) * 100)} %`)}
                  ${ligne('Propriétaire', `${esc(m.proprietaire.nom)} <span class="pr-sous">${esc(m.proprietaire.forme || '')}</span> · ${lienExt(annuaire(m.proprietaire.siren), m.proprietaire.siren)}`, `${esc(m.proprietaire.source)} · ${dateFr(m.proprietaire.date)}`)}
                  ${ligne("Lien avec l'exploitant", esc(m.lien.motif) + (m.lien.dans_la_parcelle ? '' : ' <span class="pr-sous">(établissement à proximité, pas dans la parcelle)</span>'))}
                  ${ligne('Établissement occupant', `${esc(m.etablissement.adresse || '—')}${m.etablissement.est_siege ? ' <span class="pr-sous">(siège)</span>' : ''}`, `SIRET ${esc(m.etablissement.siret || '—')}`)}
                  ${ligne('Dernière vente DVF', m.achat ? `${dateFr(m.achat.date)} · ${M(m.achat.prix)}` : 'Aucune depuis 5 ans', m.achat ? esc(m.achat.note) : null)}
                  ${ligne('Valeur', m.valeur ? `${M(m.valeur.centrale)} <span class="pr-sous">${M(m.valeur.basse)} – ${M(m.valeur.haute)}</span>` : '—')}
                </table>
              </div>`).join('')}
          </section>

          <section class="pr-bloc">
            <h3>L'entreprise</h3>
            <table class="pr-kv">
              ${ligne('SIREN', `${lienExt(annuaire(o.siren), o.siren)} · ${lienExt(`https://www.pappers.fr/entreprise/${o.siren}`, 'Pappers')}`)}
              ${ligne('Activité (NAF)', esc(o.ape || '—'))}
              ${ligne('Catégorie', esc(o.categorie || '—'))}
              ${ligne('Effectif', esc(Sc.effectifLibelle(o.effectif_tranche)))}
              ${ligne('Créée le', dateFr(o.creation))}
              ${ligne('Siège', esc(o.siege || '—'))}
              ${ligne('Établissements ouverts', N(o.etablissements_ouverts))}
            </table>
            ${o.finances.length ? `<table class="pr-table pr-table-compacte"><thead><tr><th>Exercice</th><th class="num">Chiffre d'affaires</th><th class="num">Résultat net</th></tr></thead><tbody>${o.finances.slice(0, 3).map((f) => `<tr><td>${esc(f.annee)}</td><td class="num">${M(f.ca)}</td><td class="num">${M(f.resultat_net)}</td></tr>`).join('')}</tbody></table>` : '<p class="pr-sous">Comptes non publiés (confidentiels ou non déposés).</p>'}
            <div class="pr-src">${esc(o.source)} · ${dateFr(o.date)}</div>
          </section>

          <section class="pr-bloc">
            <h3>Les personnes</h3>
            <table class="pr-kv">${personnes(o.dirigeants)}</table>
            ${x.murs.filter((m) => m.proprietaire.siren !== o.siren).slice(0, 2).map((m) => `<div class="pr-sous-titre">Dirigeants de ${esc(m.proprietaire.nom)}</div><table class="pr-kv">${personnes(m.proprietaire.dirigeants)}</table>`).join('')}
            ${x.fonds.length ? `<div class="pr-sous-titre">Fonds probables au capital</div><table class="pr-kv">${x.fonds.map((f) => ligne(esc(f.nom), `${esc(f.qualite || '—')}${f.siren ? ` · ${lienExt(annuaire(f.siren), f.siren)}` : ''}`)).join('')}</table>` : ''}
            <div class="pr-src">RNE (API Recherche d'entreprises) · âge calculé depuis l'année de naissance publiée</div>
            <div class="pr-contact">
              ${E.invite ? '<p class="pr-sous">Mode démo : <a href="/login.html">connectez-vous</a> pour chercher le DAF et le dirigeant (Apollo).</p>' : '<button type="button" class="btn btn-outline pr-petit" id="prApollo">Chercher le DAF et le dirigeant (Apollo)</button>'}
              <div id="prApolloRes"></div>
            </div>
          </section>

          <section class="pr-bloc">
            <h3>Scores détaillés</h3>
            <details class="pr-details" open><summary>Fit ${s.fit.score}/100</summary>${raisons(s.fit.raisons)}</details>
            <details class="pr-details"><summary>Motivation ${s.motivation.score}/100</summary>${raisons(s.motivation.raisons)}</details>
            <details class="pr-details"><summary>Locataire ${s.locataire.exclu ? 'exclu' : `${s.locataire.score}/100`}</summary>${raisons(s.locataire.raisons)}</details>
          </section>

          <section class="pr-bloc">
            <h3>Historique</h3>
            ${evenements.length ? `<table class="pr-table pr-table-compacte"><tbody>${evenements.slice(0, 12).map((e) => `<tr><td>${dateFr(e.date)}</td><td>${e.sur === 'occupant' ? 'Exploitant' : 'Propriétaire'}</td><td>${esc(e.texte || e.famille)}</td><td>${e.url ? lienExt(e.url, 'BODACC') : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="pr-sous">Aucune annonce BODACC sur 24 mois (hors dépôts de comptes).</p>'}
            <div class="pr-src">${esc(x.bodacc_lu.source)} · depuis le ${dateFr(x.bodacc_lu.depuis)} · lu le ${dateFr(x.bodacc_lu.date)}</div>
            <div id="prJournal"></div>
          </section>

          <section class="pr-bloc">
            <h3>Commentaire</h3>
            <textarea id="prCommentaire" rows="3" placeholder="Note pour l'équipe…">${esc((suivi && suivi.commentaire) || '')}</textarea>
            <button type="button" class="btn btn-outline pr-petit" id="prEnregCommentaire">Enregistrer</button>
          </section>
        </div>
        <div class="pr-fiche-droite">
          <div class="pr-fiche-carte" id="prFicheCarte"></div>
          <div class="pr-sv" id="prStreetView"><div class="pr-sv-vide">Street View…</div></div>
        </div>
      </div>`;
    $('prRetour').onclick = () => (history.length > 1 ? history.back() : aller('explorer'));
    majLiensStreetView(corps);
    $('prFicheSignet').onclick = (e) => menuListe(e.currentTarget, [x.id]);
    brancherEtapes(corps);
    corps.querySelectorAll('[data-verdict]').forEach((b) => {
      b.onclick = async () => {
        await api('/prospection/verifications', { method: 'PUT', body: { cible_id: x.id, verdict: b.dataset.verdict } });
        E.verifs.set(x.id, { cible_id: x.id, verdict: b.dataset.verdict });
        corps.querySelectorAll('[data-verdict]').forEach((y) => y.classList.toggle('actif', y === b));
        avis('Vérification enregistrée');
      };
    });
    $('prEnregCommentaire').onclick = async () => {
      try {
        await api('/prospection/suivis', { method: 'PUT', body: { cible_id: x.id, mandat_id: E.mandatId, etape: (E.suivis.get(x.id) || {}).etape || 'a_qualifier', commentaire: $('prCommentaire').value } });
        E.suivis.set(x.id, { ...(E.suivis.get(x.id) || { etape: 'a_qualifier' }), cible_id: x.id, commentaire: $('prCommentaire').value });
        avis('Commentaire enregistré');
      } catch (err) { avis(err.message, true); }
    };
    if ($('prApollo')) $('prApollo').onclick = async () => {
      const zone = $('prApolloRes');
      zone.innerHTML = '<div class="pr-sous">Recherche Apollo…</div>';
      try {
        const r = await api('/prospection/contact', { method: 'POST', body: { nom: o.nom, cible_id: x.id } });
        zone.innerHTML = r.societe ? `<table class="pr-kv">${r.contacts.map((p) => ligne(esc(p.nom || '—'), `${esc(p.poste || '')}${p.email ? ` · <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}${p.linkedin ? ` · ${lienExt(p.linkedin, 'LinkedIn')}` : ''}`)).join('') || '<tr><td class="pr-sous">Aucun dirigeant trouvé.</td></tr>'}</table><div class="pr-src">Apollo · ${esc(r.societe.domaine)} · ${dateFr(new Date())}</div>` : `<div class="pr-sous">${esc(r.note || 'Rien trouvé.')}</div>`;
      } catch (err) { zone.innerHTML = `<div class="pr-erreur">${esc(err.message)}</div>`; }
    };
    api(`/prospection/journal/${x.id}`).then((j) => {
      const actions = { exporter: 'a exporté', etape: "a changé l'étape", ajouter_liste: 'a ajouté à une liste', verifier: 'a vérifié', rechercher_contact: 'a cherché un contact' };
      const lignes = j.filter((a) => a.action !== 'voir').slice(0, 8);
      if (lignes.length && $('prJournal')) $('prJournal').innerHTML = `<div class="pr-sous-titre">Actions de l'équipe</div><ul class="pr-journal">${lignes.map((a) => `<li>${dateFr(a.at)} · ${esc(a.user_email || '—')} ${esc(actions[a.action] || a.action)}${a.detail && a.detail.etape ? ` : ${esc(ETAPE[a.detail.etape])}` : ''}</li>`).join('')}</ul>`;
    }).catch(() => {});
    const moteur = await chargerCartes();
    if (E.vue !== 'cible' || !$('prFicheCarte')) return;
    E.carteF = carteFiche(moteur, $('prFicheCarte'), $('prStreetView'), x);
  }

  // ------------------------------------------------------------------ pipeline
  function vuePipeline(corps) {
    const parEtape = new Map(ETAPES.map(([k]) => [k, []]));
    for (const [id, s] of E.suivis) { const x = E.cibles.find((c) => c.id === id); if (x && parEtape.has(s.etape)) parEtape.get(s.etape).push({ x, s }); }
    const aujourdhui = new Date().toISOString().slice(0, 10);
    corps.innerHTML = `
      <div class="pr-page pr-page-large">
        <div class="pr-page-tete"><h2>Pipeline${mandat() ? ` · ${esc(mandat().nom)}` : ''}</h2><p>Les cibles suivies pour ces critères. Changez l'étape ici, dans le tableau ou dans la fiche ; « Écartée » demande un motif. Relance prévue à J+7 après le premier contact.</p></div>
        <div class="pr-kanban">${ETAPES.map(([k, mot]) => `
          <div class="pr-colonne-k"><div class="pr-colonne-k-tete">${esc(mot)}<span>${parEtape.get(k).length}</span></div>
            ${parEtape.get(k).map(({ x, s }) => `<div class="pr-carte-k" data-cible="${x.id}"><b>${esc(x.nom)}</b><small>${esc(x.murs[0].parcelle.commune)} · ${M(x.totaux.centrale)} · ${E.scores.get(x.id).global}/100</small>${s.relance_le ? `<small class="${String(s.relance_le).slice(0, 10) <= aujourdhui ? 'pr-relance-due' : ''}">Relance le ${dateFr(s.relance_le)}</small>` : ''}${s.motif_ecart ? `<small>Motif : ${esc(s.motif_ecart)}</small>` : ''}${selectEtape(x.id, s)}</div>`).join('') || '<div class="pr-vide-k">—</div>'}
          </div>`).join('')}</div>
      </div>`;
    corps.querySelectorAll('.pr-carte-k').forEach((el) => { el.onclick = (e) => { if (e.target.closest('select')) return; aller(`cible/${el.dataset.cible}`); }; });
    brancherEtapes(corps);
  }

  // ------------------------------------------------------------------ mandats
  function vueMandats(corps) {
    corps.innerHTML = `
      <div class="pr-page">
        <div class="pr-page-tete"><h2>Critères</h2><p>Un jeu de critères = un client SCPI et ce qu'il cherche. Les critères actifs filtrent et classent toutes les vues.</p><button type="button" class="btn btn-solid pr-petit" data-aller="">Nouveaux critères</button></div>
        <div id="prEditionMandat"></div>
        <div class="pr-lignes pr-lignes-larges">${E.mandats.map((m) => {
          const c = Sc.completer(m.criteres);
          return `<div class="pr-ligne pr-ligne-mandat ${m.id === E.mandatId ? 'actif' : ''}">
            <span class="pr-ligne-ico">${ICONES.mandat}</span>
            <div class="pr-ligne-txt"><b>${esc(m.nom)}${m.id === E.mandatId ? ' <span class="pr-etiquette">actif</span>' : ''}</b>
              <small>${M(c.ticketMin)} à ${M(c.ticketMax)} · ${c.types.map((t) => Sc.TYPES_ACTIF[t]).join(', ')} · ${c.zones && c.zones.length ? esc(c.zones.map(Md.zoneLisible).join(', ')) : 'toute la France'} · bail ${c.bailMinAns} ans · ${c.rendement} % · poids ${c.poids.fit}/${c.poids.motivation}/${c.poids.locataire}</small>
              <small>${m.compteurs.suivies} suivies · ${m.compteurs.en_approche} en approche · ${m.compteurs.en_discussion} en discussion${m.client ? ` · client : ${esc(m.client)}` : ''}</small></div>
            ${m.id !== E.mandatId ? `<button type="button" class="btn btn-outline pr-petit" data-activer="${m.id}">Activer</button>` : ''}
            <button type="button" class="btn btn-ghost pr-petit" data-modifier="${m.id}">Modifier</button>
            <button type="button" class="btn btn-ghost pr-petit" data-archiver="${m.id}">Archiver</button>
          </div>`;
        }).join('') || '<div class="pr-vide">Aucun critère enregistré. Décrivez-les depuis l\'accueil, en une phrase.</div>'}</div>
      </div>`;
    corps.querySelectorAll('[data-activer]').forEach((b) => { b.onclick = () => activerMandat(b.dataset.activer); });
    corps.querySelectorAll('[data-archiver]').forEach((b) => { b.onclick = async () => { if (!confirm('Archiver ces critères ?')) return; await api(`/prospection/mandats/${b.dataset.archiver}`, { method: 'DELETE' }); E.mandats = await api('/prospection/mandats'); if (E.mandatId === b.dataset.archiver) await activerMandat((E.mandats[0] && E.mandats[0].id) || null); else rendre(); }; });
    corps.querySelectorAll('[data-modifier]').forEach((b) => {
      b.onclick = () => {
        const m = E.mandats.find((y) => y.id === b.dataset.modifier);
        $('prEditionMandat').innerHTML = formulaireMandat(Sc.completer(m.criteres), { nom: m.nom, client: m.client || '', id: m.id });
        brancherFormulaire($('prFormMandat'), { apres: () => aller('mandats') });
        $('prAnnulerMandat').onclick = () => { $('prEditionMandat').innerHTML = ''; };
        $('prEditionMandat').scrollIntoView({ behavior: 'smooth' });
      };
    });
  }

  // ------------------------------------------------------------------ verification (lot 1)
  /** Les 50 meilleures cibles d'un departement (criteres par defaut) et leur etat de verification. */
  function verificationDe(dept) {
    const r = E.donnees.get(dept);
    if (!r) return { faites: 0, ok: 0, faux: 0, cibles: [] };
    const cibles = r.cibles.map((x) => ({ x, s: Sc.scorer(x) })).sort((a, b) => b.s.global - a.s.global).slice(0, 50).map((y) => y.x);
    const v = cibles.map((x) => E.verifs.get(x.id)).filter(Boolean);
    return { cibles, faites: v.length, ok: v.filter((y) => y.verdict === 'ok').length, faux: v.filter((y) => y.verdict === 'faux').length };
  }
  const deptOk = (d) => (d && E.etat.departements.some((x) => x.code === String(d).toUpperCase()) ? String(d).toUpperCase() : null);
  async function vueVerification(corps) {
    const dept = deptOk(E.param) || '06';
    if (!E.donnees.has(dept)) {
      corps.innerHTML = '<div class="pr-page"><div class="pr-vide">Chargement…</div></div>';
      await api(`/prospection/departements/${dept}/cibles`).then((r) => E.donnees.set(dept, r)).catch(() => {});
      if (E.vue !== 'verification') return;
    }
    const v = verificationDe(dept);
    if (!v.cibles.length) { corps.innerHTML = `<div class="pr-page"><div class="pr-vide">Le ${esc(dept)} n'est pas encore analysé.</div></div>`; return; }
    // Les cibles verifiees doivent etre chargees pour que leur fiche s'ouvre.
    if (!E.cibles.some((x) => x.id === v.cibles[0].id)) { E.filtres.zones = [...new Set([...E.filtres.zones, dept])]; await chargerCibles(); }
    const reste = v.faites - v.ok - v.faux;
    corps.innerHTML = `
      <div class="pr-page pr-page-large">
        <div class="pr-page-tete"><h2>Vérification du ${esc(Md.zoneLisible(dept))}</h2>
          <p>Lot 1 : les 50 meilleures cibles, contrôlées à la main (Google Maps, Street View, Pappers). Objectif : au moins 40 entreprises qui occupent bien leurs propres murs.</p>
          <div class="pr-verif-compte"><b>${v.faites}/50</b> contrôlées · <b class="ok">${v.ok}</b> justes · <b class="faux">${v.faux}</b> faux positifs · ${reste} à revoir${v.faites === 50 ? (v.ok >= 40 ? ' · <b class="ok">critère atteint</b>' : ' · <b class="faux">critère non atteint</b>') : ''}</div></div>
        <div class="pr-table-defile"><table class="pr-table">
          <thead><tr><th>#</th><th>Entreprise</th><th>Site principal</th><th>Lien</th><th>Contrôler</th><th>Verdict</th></tr></thead>
          <tbody>${v.cibles.map((x, i) => {
            const m = x.murs[0];
            const verd = E.verifs.get(x.id);
            return `<tr>
              <td>${i + 1}</td>
              <td><a href="#prospection/cible/${x.id}" class="pr-nom">${esc(x.nom)}</a><div class="pr-sous">${esc(Sc.TYPES_ACTIF[x.type_actif])} · ${M(x.totaux.centrale)}</div></td>
              <td>${esc(m.parcelle.adresse)}<div class="pr-sous">${esc(m.parcelle.commune)} · propriétaire ${esc(m.proprietaire.nom)}</div></td>
              <td><span class="pr-conf ${x.confiance}">${esc(x.confiance)}</span><div class="pr-sous">${esc(LIENS[m.lien.type] || m.lien.type)}</div></td>
              <td class="pr-liens-verif"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${m.parcelle.adresse} ${m.parcelle.commune}`)}" target="_blank" rel="noopener">Maps</a><a data-sv="${m.parcelle.id}" href="${lienStreetView({ lat: m.parcelle.lat, lon: m.parcelle.lon })}" target="_blank" rel="noopener">Street View</a><a href="https://www.pappers.fr/entreprise/${x.id}" target="_blank" rel="noopener">Pappers</a></td>
              <td><div class="pr-verif-choix">${VERDICTS.map(([k, mot]) => `<button type="button" class="pr-verdict-btn ${k} ${verd && verd.verdict === k ? 'actif' : ''}" data-verdict="${k}" data-id="${x.id}">${esc(mot)}</button>`).join('')}</div></td>
            </tr>`;
          }).join('')}</tbody></table></div>
      </div>`;
    majLiensStreetView(corps);
    corps.querySelectorAll('[data-verdict]').forEach((b) => {
      b.onclick = async () => {
        await api('/prospection/verifications', { method: 'PUT', body: { cible_id: b.dataset.id, verdict: b.dataset.verdict } });
        E.verifs.set(b.dataset.id, { cible_id: b.dataset.id, verdict: b.dataset.verdict });
        const y = window.scrollY;
        rendre();
        window.scrollTo(0, y);
      };
    });
  }

  // ------------------------------------------------------------------ file d'attente
  function suivreFile() {
    clearTimeout(E.sondage);
    const tour = async () => {
      try {
        const avant = analyses().join(',');
        E.etat = await api('/prospection/etat');
        if (analyses().join(',') !== avant) {
          E.donnees.clear();
          await chargerCibles();
          if (!['cible', 'accueil'].includes(E.vue) || !document.activeElement || document.activeElement.tagName !== 'TEXTAREA') rendre();
        } else rendreEntete();
        if (E.etat.file.en_cours || E.etat.file.attente.length) E.sondage = setTimeout(tour, 5000);
      } catch { E.sondage = setTimeout(tour, 15000); }
    };
    E.sondage = setTimeout(tour, 1500);
  }

  // ------------------------------------------------------------------ demarrage
  document.addEventListener('click', (e) => {
    const a = e.target.closest('#view-prospection [data-aller]');
    if (!a) return;
    e.preventDefault();
    aller(a.dataset.aller);
  });
  // Mode clair / sombre change (Mon compte, ou l'appareil) : les cartes suivent.
  window.addEventListener('leez:theme', () => { if (E.carteX) { E.carteX.theme(); if (E.vue === 'explorer') rendreResultats(); } if (E.carteF) E.carteF.theme(); });

  async function init() {
    $('prApp').innerHTML = '<div class="pr-chargement"><span class="pr-spin"></span>Chargement des cibles…</div>';
    await chargerBase();
    E.cle = E.etat.google_maps_key;
    E.pret = true;
    if (E.etat.file.en_cours || E.etat.file.attente.length) suivreFile();
    route();
  }

  window.LeezProspection = {
    show() {
      if (!E.pret) { if (!E.initEnCours) { E.initEnCours = true; init().catch((e) => { $('prApp').innerHTML = `<div class="pr-vide pr-erreur">${esc(e.message)}</div>`; E.initEnCours = false; }); } }
      else route();
    },
  };
  // Rechargement direct sur #prospection : app.js a deja affiche la vue avant que ce script soit charge.
  if ($('view-prospection') && $('view-prospection').classList.contains('active')) window.LeezProspection.show();
}());
