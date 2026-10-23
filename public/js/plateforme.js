// Plateforme Leez (docs/SPEC.md, section 16.2), phase 0 : l'onglet « Dossiers ».
// Deux vues sous une meme ancre : #deals (la Boite d'entree) et #deals/<id>
// (le dossier avec ses documents). Les traitements tournent dans le worker ;
// l'ecran les suit par sondage toutes les 3 secondes tant qu'un document est
// en cours. Rien n'est calcule ici : tout vient de l'API.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const octets = (n) => (n == null ? '—' : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`);
  const montant = (v) => (v && v.amount != null ? `${Number(v.amount).toLocaleString('fr-FR')} €` : '—');
  const pourcent = (v) => { const x = v == null ? null : (typeof v === 'object' ? v.value : v); return x == null || x === '' ? '—' : `${(Number(x) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`; };

  const ETAPES = [['reception', 'Réception'], ['pre_analysis', 'Pré-analyse'], ['data_room', 'Data room'], ['analysis', 'Analyse'], ['committee', 'Comité'], ['decision', 'Décision'], ['closed', 'Clos']];
  const ETAPE = Object.fromEntries(ETAPES);
  const CONFORMITE = { conforme: 'Conforme', a_discuter: 'À discuter', incomplet: 'Incomplet', non_conforme: 'Non conforme', pending: '—' };
  const STATUT = { uploaded: 'Reçu', parsing: 'Lecture', parsed: 'Lu', classified: 'Classé', indexed: 'Indexé', extracting: 'Extraction', extracted: 'Extrait', failed: 'Échec', duplicate: 'Doublon' };
  const SOURCE = { upload: 'Dépôt', email: 'Email', data_room_link: 'Lien' };
  const TYPES = 'pdf, docx, xlsx, xls, csv, eml, msg, zip, jpg, png';

  const E = { vue: 'boite', dealId: null, deals: [], deal: null, documents: [], jobs: [], filtres: { stage: '', conformity: '', q: '' }, sondage: null, erreur: null, occupe: false, limites: null };

  async function api(chemin, opts = {}) {
    const init = opts.formData
      ? { method: opts.method || 'POST', body: opts.formData }
      : { method: opts.method || 'GET', headers: { 'content-type': 'application/json' }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) };
    const r = await fetch(`/api${chemin}`, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error((j.error && (j.error.message || j.error)) || `Erreur ${r.status}`);
      e.code = j.error && j.error.code;
      e.status = r.status;
      e.refuses = j.refuses;
      throw e;
    }
    return j;
  }
  let avisTimer = null;
  function avis(texte, erreur = false) {
    let a = $('plAvis');
    if (!a) { a = document.createElement('div'); a.id = 'plAvis'; a.className = 'pl-avis'; document.body.appendChild(a); }
    a.textContent = texte;
    a.classList.toggle('erreur', !!erreur);
    a.classList.add('visible');
    clearTimeout(avisTimer);
    avisTimer = setTimeout(() => a.classList.remove('visible'), erreur ? 7000 : 3500);
  }

  // ---------- routage ----------
  function aller(hash) {
    if (location.hash !== hash) history.pushState(null, '', location.pathname + location.search + hash);
    router();
  }
  function router() {
    const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean);
    if (parts[0] !== 'deals') return;
    arreterSondage();
    E.erreur = null;
    if (parts[1]) { E.vue = 'deal'; E.dealId = parts[1]; E.deal = null; E.documents = []; chargerDeal(); }
    else { E.vue = 'boite'; E.dealId = null; chargerBoite(); }
  }
  function show() {
    if (!location.hash.startsWith('#deals')) history.replaceState(null, '', `${location.pathname}${location.search}#deals`);
    router();
  }

  // ---------- chargements ----------
  async function chargerBoite() {
    rendu();
    try {
      const q = new URLSearchParams();
      Object.entries(E.filtres).forEach(([k, v]) => { if (v) q.set(k, v); });
      E.deals = (await api(`/deals?${q}`)).deals;
      E.erreur = null;
    } catch (e) { E.erreur = e; }
    rendu();
  }
  async function rafraichirDeal() {
    const [{ deal }, { documents }] = await Promise.all([api(`/deals/${E.dealId}`), api(`/deals/${E.dealId}/documents`)]);
    E.deal = deal;
    E.documents = documents;
  }
  async function chargerDeal() {
    rendu();
    try {
      await rafraichirDeal();
      E.erreur = null;
      chargerJobs();
      if (enCours()) sonder();
    } catch (e) { E.erreur = e; }
    rendu();
  }
  async function chargerJobs() {
    try { E.jobs = (await api('/jobs')).queues; } catch { E.jobs = []; }
    rendu();
  }
  // Un document est "en cours" tant que le worker ne l'a pas ingere (pas de sha256) ou qu'un job le lit.
  const transitoire = (d) => (!d.sha256 && !['failed', 'duplicate'].includes(d.status)) || ['parsing', 'extracting'].includes(d.status);
  const enCours = () => E.documents.some(transitoire);
  function sonder() {
    arreterSondage();
    E.sondage = setInterval(async () => {
      if (E.vue !== 'deal') return arreterSondage();
      try {
        await rafraichirDeal();
        chargerJobs();
        rendu();
        if (!enCours()) arreterSondage();
      } catch { /* on reessaie au prochain tour */ }
    }, 3000);
  }
  function arreterSondage() { if (E.sondage) clearInterval(E.sondage); E.sondage = null; }

  // ---------- rendu ----------
  function rendu() {
    const app = $('plApp');
    if (!app) return;
    app.innerHTML = E.vue === 'deal' ? vueDeal() : vueBoite();
    brancher();
  }
  function erreurHtml() {
    if (!E.erreur) return '';
    if (E.erreur.code === 'demo' || (E.erreur.status === 403 && E.erreur.code !== 'role')) return '<div class="pl-vide">Mode démo : la plateforme demande un compte. <a href="#prospection">Ouvrir la Prospection</a></div>';
    if (E.erreur.status === 404 && E.vue === 'deal') return '<div class="pl-vide">Ce dossier n\'existe pas ou n\'appartient pas à votre organisation.</div>';
    return `<div class="pl-erreur">${esc(E.erreur.message)}</div>`;
  }
  function vueBoite() {
    const f = E.filtres;
    const lignes = E.deals.length ? E.deals.map(ligneDeal).join('')
      : `<tr><td colspan="9" class="pl-vide">${E.erreur ? '' : 'Aucun dossier. Déposez un teaser ou une data room ici, ou cliquez sur « Nouveau dossier ».'}</td></tr>`;
    return `
      <div class="pl-tete">
        <div><small>Plateforme</small><h1>Dossiers</h1></div>
        <div class="pl-actions"><label class="pl-btn pl-btn-primaire">Nouveau dossier<input type="file" id="plNouveau" multiple hidden></label></div>
      </div>
      <div class="pl-filtres">
        <input id="plQ" placeholder="Rechercher un dossier…" value="${esc(f.q)}">
        <select id="plStage"><option value="">Toutes les étapes</option>${ETAPES.map(([k, l]) => `<option value="${k}" ${f.stage === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="plConf"><option value="">Toutes conformités</option>${Object.entries(CONFORMITE).filter(([k]) => k !== 'pending').map(([k, l]) => `<option value="${k}" ${f.conformity === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="pl-compte">${E.deals.length} dossier${E.deals.length > 1 ? 's' : ''}</span>
      </div>
      ${erreurHtml()}
      <div class="pl-table-defile pl-zone-depot" id="plZoneDepot">
        <table class="pl-table"><thead><tr><th>Nom</th><th>Source</th><th>Date</th><th>Étape</th><th>Conformité</th><th class="num">Prix FAI</th><th class="num">Rendement AEM</th><th>Assigné</th><th>Traitement</th></tr></thead><tbody>${lignes}</tbody></table>
      </div>`;
  }
  function ligneDeal(d) {
    const t = d.documents || {};
    const prog = t.total ? `${t.traites}/${t.total} document${t.total > 1 ? 's' : ''}${t.en_echec ? ` · ${t.en_echec} en échec` : ''}${t.a_classer ? ` · ${t.a_classer} à classer` : ''}` : 'Aucun document';
    return `<tr data-deal="${d.id}"><td><b>${esc(d.name)}</b></td><td>${SOURCE[d.source] || esc(d.source)}</td><td>${dateFr(d.created_at)}</td><td><span class="pl-etape">${ETAPE[d.stage] || esc(d.stage)}</span></td><td><span class="pl-conf pl-conf-${d.conformity}">${CONFORMITE[d.conformity] || '—'}</span></td><td class="num">${montant(d.prix_fai)}</td><td class="num">${pourcent(d.rendement_aem)}</td><td>${esc(d.assigned_email || '—')}</td><td>${prog}</td></tr>`;
  }
  function vueDeal() {
    const d = E.deal;
    if (!d) return `<div class="pl-tete"><div><a href="#deals" class="pl-retour">← Dossiers</a></div></div>${erreurHtml() || '<div class="pl-vide">Chargement…</div>'}`;
    const docs = E.documents.length
      ? `<div class="pl-table-defile"><table class="pl-table"><thead><tr><th>Nom</th><th>Type</th><th>Confiance</th><th>Statut</th><th class="num">Pages</th><th class="num">Taille</th><th>Erreur</th><th></th></tr></thead><tbody>${E.documents.map(ligneDoc).join('')}</tbody></table></div>`
      : `<div class="pl-vide">Aucun document. Glissez des fichiers ici (${TYPES} ; un zip ou un mail est décompressé).</div>`;
    return `
      <div class="pl-tete">
        <div>
          <a href="#deals" class="pl-retour">← Dossiers</a>
          <h1 id="plNom" contenteditable="true" spellcheck="false" title="Cliquer pour renommer">${esc(d.name)}</h1>
          <small>${SOURCE[d.source] || esc(d.source)} · créé le ${dateFr(d.created_at)} · ${d.assigned_email ? `assigné à ${esc(d.assigned_email)}` : 'non assigné'}</small>
        </div>
        <div class="pl-actions">
          <span class="pl-conf pl-conf-${d.conformity}" title="Statut de conformité (phase 3)">${CONFORMITE[d.conformity]}</span>
          <label class="pl-btn pl-btn-primaire">Déposer des documents<input type="file" id="plDepot" multiple hidden></label>
        </div>
      </div>
      <div class="pl-frise" title="Les changements d'étape arrivent avec la phase 2">${ETAPES.map(([k, l]) => `<span class="pl-frise-etape ${k === d.stage ? 'active' : ''}">${l}</span>`).join('')}</div>
      ${erreurHtml()}
      <section class="pl-panneau pl-zone-depot" id="plZoneDepot">
        <div class="pl-panneau-tete"><h3>Documents <small>${E.documents.length}</small></h3>${enCours() ? '<span class="pl-encours">Traitement en cours…</span>' : ''}</div>
        ${docs}
      </section>
      <section class="pl-panneau">
        <div class="pl-panneau-tete"><h3>Traitement</h3><small>Files du worker</small></div>
        ${jobsHtml()}
      </section>`;
  }
  function ligneDoc(d) {
    const enfant = d.parent_document_id ? '<span class="pl-enfant" title="Extrait d\'une archive ou d\'un mail">↳</span> ' : '';
    const statut = d.status === 'uploaded' ? (d.sha256 ? 'Reçu · en attente de lecture' : 'En file') : (STATUT[d.status] || d.status);
    const type = d.doc_type === 'a_classer' ? '<b>À classer</b>' : esc(d.doc_type || '—');
    return `<tr class="pl-doc-${d.status}">
      <td>${enfant}${esc(d.filename)}</td><td>${type}</td>
      <td>${d.doc_type_confidence != null ? `${Math.round(d.doc_type_confidence * 100)} %` : '—'}</td>
      <td><span class="pl-statut pl-statut-${d.status}">${statut}</span></td>
      <td class="num">${d.page_count ?? '—'}</td><td class="num">${octets(d.size_bytes)}</td>
      <td class="pl-erreur-cellule">${esc(d.error || '')}</td>
      <td class="pl-actions-ligne">${d.status !== 'duplicate' ? `<button class="pl-lien" data-ouvrir="${d.id}">Ouvrir</button>` : ''}<button class="pl-lien" data-relancer="${d.id}">Relancer</button></td>
    </tr>`;
  }
  function jobsHtml() {
    const actives = E.jobs.filter((q) => q.total || q.en_attente || q.actifs || q.echoues);
    if (!actives.length) return '<div class="pl-vide">Aucun job pour le moment.</div>';
    return `<div class="pl-jobs">${actives.map((q) => `<div class="pl-job"><b>${esc(q.name)}</b><span>${q.en_attente} en attente · ${q.actifs} actif${q.actifs > 1 ? 's' : ''} · ${q.echoues} en échec</span></div>`).join('')}</div>`;
  }

  // ---------- actions ----------
  function brancher() {
    document.querySelectorAll('#plApp tr[data-deal]').forEach((tr) => tr.addEventListener('click', () => aller(`#deals/${tr.dataset.deal}`)));
    const q = $('plQ');
    if (q) { let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { E.filtres.q = q.value; chargerBoite(); }, 250); }); }
    const st = $('plStage'); if (st) st.addEventListener('change', () => { E.filtres.stage = st.value; chargerBoite(); });
    const cf = $('plConf'); if (cf) cf.addEventListener('change', () => { E.filtres.conformity = cf.value; chargerBoite(); });
    const nouveau = $('plNouveau'); if (nouveau) nouveau.addEventListener('change', () => creerDepuisFichiers([...nouveau.files]));
    const depot = $('plDepot'); if (depot) depot.addEventListener('change', () => deposer(E.dealId, [...depot.files]));
    const zone = $('plZoneDepot');
    if (zone) {
      ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('pl-survol'); }));
      ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('pl-survol'); }));
      zone.addEventListener('drop', (e) => {
        const fichiers = [...((e.dataTransfer && e.dataTransfer.files) || [])];
        if (!fichiers.length) return;
        if (E.vue === 'deal') deposer(E.dealId, fichiers); else creerDepuisFichiers(fichiers);
      });
    }
    const nom = $('plNom');
    if (nom) {
      nom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nom.blur(); } });
      nom.addEventListener('blur', async () => {
        const v = nom.textContent.trim();
        if (!v || v === E.deal.name) { nom.textContent = E.deal.name; return; }
        try { E.deal = (await api(`/deals/${E.dealId}`, { method: 'PATCH', body: { name: v } })).deal; avis('Nom enregistré.'); }
        catch (e) { avis(e.message, true); nom.textContent = E.deal.name; }
      });
    }
    document.querySelectorAll('[data-ouvrir]').forEach((b) => b.addEventListener('click', async () => {
      try { const { url } = await api(`/documents/${b.dataset.ouvrir}/file`); window.open(url, '_blank', 'noopener'); } catch (e) { avis(e.message, true); }
    }));
    document.querySelectorAll('[data-relancer]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/documents/${b.dataset.relancer}/reprocess`, { method: 'POST', body: { from: 'ingest' } }); avis('Relancé.'); chargerDeal(); } catch (e) { avis(e.message, true); }
    }));
  }
  async function creerDepuisFichiers(fichiers) {
    if (!fichiers.length || E.occupe) return;
    E.occupe = true;
    try {
      const nom = fichiers[0].name.replace(/\.[a-z0-9]+$/i, '').trim();
      const { deal } = await api('/deals', { method: 'POST', body: nom ? { name: nom } : {} });
      await envoyerFichiers(deal.id, fichiers);
      aller(`#deals/${deal.id}`);
    } catch (e) { avis(e.message, true); } finally { E.occupe = false; }
  }
  async function deposer(dealId, fichiers) {
    if (!fichiers.length || E.occupe) return;
    E.occupe = true;
    try { await envoyerFichiers(dealId, fichiers); await chargerDeal(); } catch (e) { avis(e.message, true); } finally { E.occupe = false; }
  }
  async function limites() {
    if (!E.limites) { try { E.limites = (await api('/org/settings')).organization.limites; } catch { E.limites = { max_upload_mb: 100 }; } }
    return E.limites;
  }
  async function envoyerFichiers(dealId, fichiers) {
    // Refus avant envoi des fichiers au-dessus de MAX_UPLOAD_MB : message clair, pas d'attente inutile.
    const { max_upload_mb } = await limites();
    const tropGros = fichiers.filter((f) => f.size > max_upload_mb * 1048576);
    if (tropGros.length) {
      avis(`Trop volumineux (${max_upload_mb} Mo au plus par fichier) : ${tropGros.map((f) => `${f.name} (${octets(f.size)})`).join(', ')}.`, true);
      fichiers = fichiers.filter((f) => !tropGros.includes(f));
      if (!fichiers.length) return;
    }
    const fd = new FormData();
    fichiers.forEach((f) => fd.append('files', f, f.name));
    avis(`Envoi de ${fichiers.length} fichier${fichiers.length > 1 ? 's' : ''}…`);
    try {
      const r = await api(`/deals/${dealId}/uploads`, { formData: fd });
      const n = r.documents.length;
      if (r.refuses && r.refuses.length) avis(`${n} déposé${n > 1 ? 's' : ''} ; refusé (type non accepté) : ${r.refuses.map((x) => x.filename).join(', ')}.`, true);
      else avis(`${n} document${n > 1 ? 's' : ''} déposé${n > 1 ? 's' : ''}.`);
    } catch (e) {
      if (e.refuses) avis(`Aucun fichier accepté (${TYPES}) : ${e.refuses.map((x) => x.filename).join(', ')}.`, true);
      else throw e;
    }
  }

  window.LeezPlateforme = { show, router };
  window.addEventListener('popstate', () => {
    const v = $('view-deals');
    if (location.hash.startsWith('#deals') && v && v.classList.contains('active')) router();
  });
  if ($('view-deals') && $('view-deals').classList.contains('active')) show();
}());
