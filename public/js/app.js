(() => {
  // ---------- auth : redirection globale sur 401 ----------
  // Patch unique de window.fetch plutot que d'editer chacun des ~30 appels
  // fetch() existants : toute reponse 401 (session absente/expiree sur
  // n'importe quelle route /api/*) declenche une redirection immediate vers
  // /login.html. /api/auth/* est exclu pour ne pas boucler sur un login
  // qui echoue legitimement (mauvais mot de passe -> 401 volontaire, pas une
  // session expiree). Le shell de la page peut brievement s'afficher vide
  // avant la redirection (pas de garde bloquant sur tout le boot d'app.js,
  // qui est un IIFE synchrone historique) -- sans risque cote donnees, le
  // serveur n'a de toute facon jamais renvoye la moindre donnee sans session
  // valide.
  const _fetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await _fetch(...args);
    if (res.status === 401 && !String(args[0]).startsWith('/api/auth/')) location.href = '/login.html';
    return res;
  };

  // ---------- garde : compte sans fonds assigne ----------
  // Un compte auto-inscrit (POST /auth/signup, voir public/signup.html)
  // n'a pas de workspaceId tant qu'un administrateur ne l'a pas rattache a
  // un fonds (routes/admin.js) -- toutes les routes /api scopees par
  // workspace renverraient 403 en boucle si on laissait le reste de l'app
  // demarrer normalement. Recouvre simplement tout l'ecran plutot que de
  // conditionner chacune des ~30 routines d'initialisation existantes.
  (async () => {
    const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null);
    if (!me || me.workspaceId) return;
    const screen = document.getElementById('pendingAssignmentScreen');
    screen.style.display = 'flex';
    document.getElementById('pendingLogoutBtn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/login.html';
    });
    if (me.isSuperAdmin) {
      const adminLink = document.createElement('a');
      adminLink.href = '/admin.html';
      adminLink.className = 'btn btn-solid login-submit';
      adminLink.textContent = 'Aller au panneau d\'administration';
      adminLink.style.marginBottom = '10px';
      screen.querySelector('.login-card').insertBefore(adminLink, document.getElementById('pendingLogoutBtn'));
    }
    // /auth/me resynchronise workspaceId depuis la base a chaque appel (voir
    // routes/auth.js) -- un simple sondage suffit donc a detecter qu'un
    // administrateur vient de rattacher ce compte a un fonds, sans que la
    // personne ait besoin de se reconnecter manuellement.
    const poll = setInterval(async () => {
      const fresh = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null);
      if (fresh?.workspaceId) { clearInterval(poll); location.reload(); }
    }, 8000);
  })();

  // ---------- analytics (PostHog, optionnel) ----------
  // Charge PostHog dynamiquement, seulement si une cle est configuree cote
  // serveur (POSTHOG_API_KEY absente = no-op complet, rien n'est charge ni
  // appele). Autocapture DESACTIVE deliberement : PostHog ne propose pas
  // d'option fiable de masquage total du texte pour l'autocapture (verifie
  // aout 2026 -- seuls des reglages partiels existent, specifiques a la
  // relecture de session que cette app n'active pas). Le contenu affiche
  // (adresses, loyers, noms de locataires) est sous NDA : plutot que de
  // s'appuyer sur un reglage de masquage incertain, l'autocapture est
  // simplement coupee -- seuls les evenements explicitement emis par cette
  // app (identify, evenements serveur) partent vers PostHog.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  (async () => {
    try {
      const cfg = await fetch('/api/public-config').then(r => r.json());
      if (!cfg.posthogKey) return;
      const assetsHost = cfg.posthogHost.replace('.i.posthog.com', '-assets.i.posthog.com');
      await loadScript(`${assetsHost}/static/array.js`);
      window.posthog.init(cfg.posthogKey, { api_host: cfg.posthogHost, person_profiles: 'identified_only', autocapture: false });
      const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null);
      // Meme distinctId que cote serveur (user.id) -- voir /api/auth/me.
      if (me) window.posthog.identify(me.id, { email: me.email, workspaceId: me.workspaceId });
    } catch { /* l'analytics ne doit jamais bloquer l'app */ }
  })();

  // Bouton oeil / oeil barre a cote de chaque champ mot de passe -- bascule
  // type="password"/"text" et l'icone correspondante. Delegue au document
  // (pas de querySelectorAll ponctuel) : les champs de la page Mon compte
  // existent des le chargement (une seule vue HTML statique, jamais
  // reconstruite dynamiquement), donc un attachement direct suffit.
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.querySelector('.icon-eye').style.display = showing ? '' : 'none';
      btn.querySelector('.icon-eye-off').style.display = showing ? 'none' : '';
      btn.setAttribute('aria-label', showing ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
    });
  });

  const fmt = n => (typeof n === 'number' ? n.toLocaleString('fr-FR') : '—');
  const fmt2 = n => (typeof n === 'number' ? n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
  const fmtPct1 = v => (v * 100).toFixed(1).replace('.', ',') + ' %';
  // Flash discret (fond + micro-scale) sur un élément dont la valeur vient
  // de changer -- jamais sur une simple navigation. Retire puis réajoute la
  // classe (avec forçage de reflow) pour pouvoir rejouer l'animation même
  // si l'élément vient d'être flashé récemment.
  function flashValue(el, className) {
    if (!el) return;
    const cls = className || 'value-flash';
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Rendu minimal du texte libre genere par l'assistant (reponse chat,
  // recherche web) : le modele repond en markdown leger (gras, listes) --
  // sans ce rendu on affichait les '**'/'-' bruts dans une seule <p>, illisible.
  // Echappe d'abord le HTML, n'ajoute que nos propres balises de confiance ensuite.
  // Echappe d'abord le HTML, puis n'ajoute que nos propres balises de
  // confiance -- code avant gras pour qu'un `**` a l'interieur d'un
  // `inline code` reste litteral plutot que d'etre pris pour du gras.
  function inlineFormatAssistant(line) {
    return escapeHtml(line)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Lien markdown [texte](url) -> vrai lien cliquable : le mode Web est
      // censé renvoyer les sources en fin de message (voir SYSTEM_PROMPT_WEB),
      // mais le modèle en glisse parfois un inline malgré la consigne --
      // sans ceci le "[texte](url)" brut s'affichait tel quel, illisible.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function formatAssistantText(raw) {
    const text = String(raw || '').replace(/\r\n/g, '\n').trim();
    if (!text) return '';
    const lines = text.split('\n');
    let out = '';
    let mode = null; // null | 'ul' | 'ol' | 'p'
    let paraLines = [];
    const closeMode = () => {
      if (mode === 'p') out += `<p>${paraLines.join('<br>')}</p>`;
      else if (mode === 'ul' || mode === 'ol') out += `</${mode}>`;
      mode = null; paraLines = [];
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      const fence = line.match(/^```/);
      if (fence) {
        closeMode();
        const codeLines = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) { codeLines.push(lines[i]); i++; }
        i++; // saute la balise fermante
        out += `<pre class="assistant-code-block"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
        continue;
      }
      if (!line) { closeMode(); i++; continue; }
      const heading = line.match(/^(#{1,3})\s+(.*)/);
      const bullet = line.match(/^[-•*]\s+(.*)/);
      const numbered = line.match(/^\d+[.)]\s+(.*)/);
      if (heading) {
        closeMode();
        const tag = heading[1].length === 1 ? 'h4' : heading[1].length === 2 ? 'h5' : 'h6';
        out += `<${tag}>${inlineFormatAssistant(heading[2])}</${tag}>`;
      } else if (bullet) {
        if (mode !== 'ul') { closeMode(); out += '<ul>'; mode = 'ul'; }
        out += `<li>${inlineFormatAssistant(bullet[1])}</li>`;
      } else if (numbered) {
        if (mode !== 'ol') { closeMode(); out += '<ol>'; mode = 'ol'; }
        out += `<li>${inlineFormatAssistant(numbered[1])}</li>`;
      } else {
        if (mode !== 'p') { closeMode(); mode = 'p'; }
        paraLines.push(inlineFormatAssistant(line));
      }
      i++;
    }
    closeMode();
    return out;
  }
  // Revele un HTML deja entierement construit caractere par caractere (les
  // balises sont inserees d'un bloc, jamais "tapees"). Utilise pour la Q/R
  // dossier/KB : cette reponse doit etre integralement verifiee par citation
  // cote serveur AVANT tout affichage (voir dealChat.js), donc on ne peut pas
  // streamer le texte brut du modele sans risquer de montrer une affirmation
  // ensuite rejetee par la verification -- on simule un affichage progressif
  // du texte DEJA verifie pour la meme sensation qu'un vrai stream.
  function revealHtmlInto(el, html, opts) {
    const charsPerTick = (opts && opts.charsPerTick) || 3;
    return new Promise(resolve => {
      let i = 0;
      let acc = '';
      const log = document.getElementById('assistantChatLog');
      function step() {
        let ticked = 0;
        while (i < html.length && ticked < charsPerTick) {
          if (html[i] === '<') {
            const close = html.indexOf('>', i);
            const end = close === -1 ? html.length : close + 1;
            acc += html.slice(i, end);
            i = end;
          } else {
            acc += html[i];
            i++; ticked++;
          }
        }
        el.innerHTML = acc;
        if (log) log.scrollTop = log.scrollHeight;
        if (i < html.length) requestAnimationFrame(step);
        else resolve();
      }
      step();
    });
  }
  // Client SSE minimal (fetch + ReadableStream, pas EventSource -- on doit
  // envoyer un corps POST). Decoupe le flux sur les separateurs "\n\n" et
  // parse chaque ligne "data: {...}" en JSON, appelant onEvent pour chacune.
  // `signal` (optionnel, AbortController) : permet a l'appelant d'arreter
  // reellement la requete en cours (pas seulement masquer son resultat) --
  // fetch/reader.read() rejettent alors avec une AbortError, a distinguer
  // d'une vraie erreur reseau par l'appelant.
  async function streamSSE(url, body, onEvent, { signal } = {}) {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      let msg = 'Erreur serveur';
      try { const data = await res.json(); msg = data.error || msg; } catch {}
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop();
      for (const chunk of chunks) {
        const line = chunk.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        onEvent(JSON.parse(line.slice(6)));
      }
    }
  }
  window.LeezFmt = { fmt, fmt2, flashValue };

  // Impression scindée : peuple #printSheet (hors de .app, cf CSS @media
  // print) et masque le reste de la page le temps de l'impression, pour
  // n'imprimer que le contenu voulu plutôt que toute l'appli.
  function printCurrentSheet(html) {
    document.getElementById('printSheet').innerHTML = html;
    document.body.classList.add('printing');
    window.print();
  }
  window.addEventListener('afterprint', () => document.body.classList.remove('printing'));
  window.LeezPrint = { printCurrentSheet };

  // ---------- référentiel de seuils interprétatifs (règles génériques d'underwriting, ------
  // pas de donnée liée à un dossier précis : appliquées à des indicateurs réellement calculés)
  const SEUILS = {
    concentration_top1: [
      [0.00, 0.15, 'vert', "Faible dépendance : le plus gros locataire pèse {v} des loyers."],
      [0.15, 0.30, 'vert', "Dépendance modérée ({v}), normale pour un actif multi-locataire."],
      [0.30, 0.40, 'orange', "Dépendance notable : le plus gros locataire pèse {v} des loyers, à surveiller."],
      [0.40, 1.01, 'rouge', "Forte concentration : {v} des loyers sur un seul locataire (seuil d'alerte usuel 40 %)."],
    ],
    concentration_top3: [
      [0.00, 0.30, 'vert', "Top 3 locataires = {v} des loyers, bonne diversification."],
      [0.30, 0.50, 'orange', "Top 3 locataires = {v} des loyers, concentration modérée à surveiller."],
      [0.50, 1.01, 'rouge', "Top 3 locataires = {v} des loyers : la santé du bien dépend de quelques signatures (seuil d'alerte usuel 50 %)."],
    ],
    taux_vacance: [
      [0.00, 0.05, 'vert', "Vacance de {v} : bien quasi-plein, sain."],
      [0.05, 0.10, 'vert', "Vacance de {v} : niveau frictionnel normal."],
      [0.10, 0.20, 'orange', "Vacance de {v} : élevée, à comprendre (structurelle ou conjoncturelle ?)."],
      [0.20, 1.01, 'rouge', "Vacance de {v} : problématique — ou opportunité value-add selon la thèse."],
    ],
    ecart_facial_economique: [
      [0.00, 0.05, 'vert', "Franchises faibles ({v}) : loyers proches du net."],
      [0.05, 0.15, 'orange', "Franchises modérées ({v}), courant sur le marché."],
      [0.15, 1.01, 'rouge', "Franchises importantes ({v}) : le loyer facial surestime le revenu réel."],
    ],
    taux_charges: [
      [0.00, 0.25, 'orange', "Taux de charges de {v} : bas — vérifier qu'aucune charge n'est sous-estimée."],
      [0.25, 0.35, 'vert', "Taux de charges de {v} : efficient."],
      [0.35, 0.45, 'vert', "Taux de charges de {v} : normal."],
      [0.45, 1.01, 'rouge', "Taux de charges de {v} : lourd, à investiguer."],
    ],
  };
  function interpret(id, valeur, fmtFn) {
    const rules = SEUILS[id];
    if (!rules || typeof valeur !== 'number' || Number.isNaN(valeur)) return null;
    const t = rules.find(r => valeur >= r[0] && valeur < r[1]);
    if (!t) return null;
    return { niveau: t[2], texte: t[3].replace('{v}', fmtFn(valeur)) };
  }
  function niveauColor(niveau) { return niveau === 'vert' ? 'var(--green)' : niveau === 'orange' ? 'var(--amber)' : niveau === 'rouge' ? 'var(--pink)' : 'var(--trace)'; }

  // ---------- santé du serveur ----------
  fetch('/api/health').then(r => r.json()).then(d => {
    const el = document.getElementById('navStatus');
    if (d.apiKeyConfigured) { el.textContent = ''; }
    else { el.textContent = 'Aucune clé ANTHROPIC_API_KEY — voir le README'; el.classList.add('missing'); }
  }).catch(() => {});

  // ================= ROUTEUR ================= //
  const DOSSIER_SUBVIEWS = ['deal', 'extract', 'audit', 'reconciliation', 'verification', 'documents', 'notes', 'export'];
  const TOP_LEVEL_VIEWS = ['dashboard', 'dossiers', 'memoire', 'ingest', 'analyze', 'settings', 'account'];
  let dossierMode = false;
  let currentDoc = null;
  // Le Vault (liste des dossiers) est l'ecran d'arrivee par defaut -- pas
  // l'Assistant : l'analyste arrive sur son travail, le chat est un outil.
  let currentViewName = 'dossiers';
  // Declares ici (et non plus loin, pres du reste du code de l'ecran
  // Agents) : showView() est appelee des le tout debut du script (voir
  // applyRouteFromHash() au boot) et reference ces deux variables via
  // stopAgentsPolling() -- avec `let` plus bas dans le fichier, cet appel
  // precoce tombait dans leur zone morte temporelle ("Cannot access before
  // initialization"), qui interrompait silencieusement showView() avant
  // qu'elle n'atteigne son propre appel a updateLocationHash() en fin de
  // fonction (routage par ancre casse des le premier chargement de page).
  let agentsPollTimer = null;
  let availableAgentTypes = [];
  // true pendant qu'on applique une route lue depuis location.hash (popstate
  // ou chargement initial) : evite que showView() ne repousse une nouvelle
  // entree d'historique en reponse a une navigation qui VIENT deja de
  // l'historique -- sans ce garde-fou, le bouton "precedent" avancerait
  // aussitot au lieu de reculer.
  let syncingRoute = false;
  // Cles "<fonctionnalite>-<dossierId>" deja animees une fois PENDANT cette
  // session (reinitialisee au rechargement de la page, jamais persistee) --
  // le Récapitulatif et la Vérification ne rejouent leur effet "generation
  // en direct" que la toute premiere fois qu'on les voit pour CE dossier ;
  // revisiter le meme onglet ensuite affiche le contenu instantanement,
  // sans re-taper le meme texte deja vu (rejouer l'animation sur un
  // contenu inchange donnerait l'impression trompeuse d'une regeneration).
  const revealedOnce = new Set();

  // Hauteur precise de l'ecran AI Agent (.agent-shell) : mesuree, jamais
  // devinee -- la page n'a pas de mise en page pleine hauteur figee, donc
  // un calc(100vh - Xpx) fixe en CSS ne peut que supposer la hauteur du
  // header (une valeur fausse laissait un vide sous le prompt une fois
  // descendu en bas apres l'envoi d'un message). Recalculee a chaque
  // affichage de la vue et au redimensionnement de la fenetre.
  function updateAgentShellHeight() {
    const shell = document.getElementById('agentShell');
    if (!shell || shell.offsetParent === null) return;
    // Position dans le DOCUMENT (et non a l'ecran) : mesurer rect.top seul
    // rendrait la hauteur dependante du defilement courant, donc une mesure
    // prise page defilee agrandirait la coquille, ce qui allongerait encore
    // la page -- une boucle qui s'auto-entretient.
    const rect = shell.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const h = Math.max(320, window.innerHeight - top);
    // height (et pas seulement min-height) : sans hauteur DEFINIE, le flex:1
    // du journal de conversation ne le contraint pas -- il grandit avec son
    // contenu, la coquille grandit avec lui et pousse l'espace de saisie hors
    // de l'ecran. Avec une hauteur definie, le journal defile a l'interieur
    // et la saisie reste en bas.
    shell.style.height = h + 'px';
    shell.style.minHeight = h + 'px';
    // Le volet source (mode Web) est une colonne soeur : il doit etre borne a
    // la meme hauteur, sinon son contenu (page en mode lecture, tres longue)
    // dicte la hauteur de la ligne de grille et rend la page defilante.
    document.getElementById('agentWebLayout')?.style.setProperty('--agent-shell-h', h + 'px');
    // Hauteur reelle du dock (carte + pastilles, variable selon le retour a
    // la ligne des pastilles) : sert de padding bas au journal pour que le
    // dernier message puisse defiler au-dessus du dock plutot que de rester
    // masque derriere lui.
    const dock = shell.querySelector('.agent-prompt-dock');
    if (dock) shell.style.setProperty('--agent-dock-h', Math.round(dock.getBoundingClientRect().height) + 'px');
  }
  window.addEventListener('resize', updateAgentShellHeight);

  // Auto-agrandissement du textarea de prompt : rows="1" fige le champ a une
  // seule ligne de haut cote navigateur (le retour a la ligne du texte
  // continue de se produire, mais la boite ne grandit pas avec) -- sans ceci,
  // toute ligne au-dela de la premiere est coupee/masquee. Remesure a chaque
  // frappe (scrollHeight apres reset a 'auto' pour permettre un retrecissement
  // si du texte est supprime), plafonnee par max-height en CSS (au-dela,
  // defilement interne normal).
  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }
  function autoResizeAssistantInput() {
    autoResizeTextarea(document.getElementById('assistantInput'));
    updateAgentShellHeight();
  }

  function showView(name) {
    currentViewName = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    if (name === 'dashboard') updateAgentShellHeight();
    const navTarget = DOSSIER_SUBVIEWS.includes(name) ? 'dossiers' : name;
    document.querySelectorAll('.sidebar-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === navTarget));
    if (DOSSIER_SUBVIEWS.includes(name)) dossierMode = true;
    else if (name !== 'analyze') dossierMode = false;
    document.getElementById('simScenarioBar').style.display = (name === 'analyze' && !dossierMode) ? 'flex' : 'none';
    // Copilote du Simulateur : deplace hors de #view-analyze (voir le
    // commentaire HTML a cote de #simFloatChat) -- sa visibilite doit donc
    // etre pilotee ici explicitement plutot que via le display:none/block
    // herite de la vue.
    document.getElementById('simFloatChat').style.display = (name === 'analyze') ? 'flex' : 'none';
    if (name === 'dossiers') renderDossiersList();
    if (name === 'documents' && currentDoc) renderSupportingDocs(currentDoc);
    if (name === 'notes' && currentDoc) syncNotesTextareas(currentDoc.notes || '');
    if (name === 'verification') playVerificationReveal();
    if (name === 'deal') playDealRecapReveal();
    // Assistant flottant : visible seulement sur Données -- se referme (sans
    // perdre la conversation) en quittant l'onglet, pour ne pas rester
    // flottant sur une page sans rapport.
    document.getElementById('dataChatFab').style.display = (name === 'extract') ? 'flex' : 'none';
    if (name !== 'extract') closeDataChatPanel();
    if (name === 'settings') loadSettingsForm();
    if (name === 'account') loadAccountForm();
    // queueMicrotask : showView peut etre invoquee DES LE BOOT (routage par
    // ancre, ligne applyRouteFromHash() plus bas) alors que les constantes
    // que ces rendus consultent (FICHE_LABELS...) sont declarees plus loin
    // dans le script -- un appel direct tomberait dans leur zone morte
    // temporelle (meme piege que agentsPollTimer, voir la note en tete de
    // fichier). La microtache ne s'execute qu'apres l'evaluation complete
    // du script : plus aucune constante en zone morte.
    if (name === 'memoire') queueMicrotask(renderMemoire);
    // Le schema d'extraction reel (renderWorkflows) vit desormais en bas de
    // la page Criteres : il documente ce sur quoi les tests s'appuient.
    if (name === 'settings') queueMicrotask(renderWorkflows);
    // Le sondage du bloc Enrichissement (voir renderDeal/loadEnrichmentBlock)
    // n'a de sens que sur le Sommaire -- l'arreter en quittant la vue evite
    // des requetes inutiles sur les autres pages du dossier.
    if (name !== 'deal') stopAgentsPolling();
    if (!syncingRoute) updateLocationHash();
  }
  function goDossierPage(name) { dossierMode = true; showView(name); }

  // ---------- routage par ancre (#dossiers/<id>/<sous-vue>, #settings, etc.) ----------
  // Reflete la vue active dans l'URL -- permet au bouton precedent/suivant
  // du navigateur de naviguer entre panneaux, et de partager/rafraichir sur
  // un panneau precis au lieu de toujours retomber sur le tableau de bord.
  // history.pushState() (contrairement a location.hash=...) ne declenche
  // jamais 'popstate' ni 'hashchange' lui-meme -- seule une vraie navigation
  // (precedent/suivant) le fait, donc aucun risque de boucle avec showView()
  // ci-dessus.
  function updateLocationHash() {
    const isDossierView = DOSSIER_SUBVIEWS.includes(currentViewName) || (currentViewName === 'analyze' && dossierMode);
    let hash = '';
    if (isDossierView && currentDoc) hash = `#dossiers/${currentDoc.id}/${currentViewName}`;
    else if (currentViewName !== 'dossiers') hash = `#${currentViewName}`;
    if (location.hash === hash) return;
    history.pushState(null, '', location.pathname + location.search + hash);
  }
  async function applyRouteFromHash() {
    const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean);
    syncingRoute = true;
    try {
      if (parts[0] === 'dossiers' && parts[1]) {
        const id = parts[1];
        const subview = parts[2] && (DOSSIER_SUBVIEWS.includes(parts[2]) || parts[2] === 'analyze') ? parts[2] : 'deal';
        if (!currentDoc || currentDoc.id !== id) {
          try {
            currentDoc = await fetchDocument(id);
            applyCurrentDocRenders();
          } catch {
            showView('dossiers');
            return;
          }
        }
        dossierMode = true;
        showView(subview);
      } else if (TOP_LEVEL_VIEWS.includes(parts[0])) {
        if (parts[0] === 'analyze') dossierMode = false;
        showView(parts[0]);
      } else {
        showView('dossiers');
      }
    } finally {
      syncingRoute = false;
    }
  }
  window.addEventListener('popstate', applyRouteFromHash);

  document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.view === 'analyze') dossierMode = false;
    showView(btn.dataset.view);
  }));
  document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.go === 'analyze') dossierMode = false;
    showView(btn.dataset.go);
  }));
  document.querySelectorAll('[data-go-dossier]').forEach(btn => btn.addEventListener('click', () => goDossierPage(btn.dataset.goDossier)));
  // La vue AI Agent est deja "active" en dur dans le HTML (premier ecran
  // affiche) -- mais sans cet appel, showView() n'est jamais invoque avant
  // un premier clic, donc le soulignement bleu du lien de nav correspondant
  // n'apparaissait qu'apres avoir change puis repris cette vue. Sans hash
  // dans l'URL, applyRouteFromHash() retombe elle-meme sur showView('dashboard') --
  // avec un hash (lien partage, rafraichissement, retour navigateur), elle
  // restaure directement le bon panneau (et le bon dossier le cas echeant).
  applyRouteFromHash();

  // ================= DONNÉES ================= //
  async function fetchDocuments() {
    const r = await fetch('/api/documents');
    return r.json();
  }
  async function fetchDocument(id) {
    const r = await fetch(`/api/documents/${id}`);
    return r.json();
  }

  const STATUS_LABELS = {
    uploaded: 'Document reçu…',
    extracting_pages: 'Lecture du texte du document…',
    extracting_identite: "Extraction de la fiche d'identité…",
    extracting_t12: 'Extraction du compte d\'exploitation…',
    extracting_signaux: 'Détection des signaux de risque (locataires, CAPEX)…',
    computing_indicators: 'Vérification et calcul des indicateurs…',
    complete: 'Extraction terminée',
    error: 'Erreur pendant l\'extraction',
    unsupported_scanned: 'Document non pris en charge (scan sans texte)',
  };
  // unsupported_scanned est un cas distinct d'une erreur : le document est
  // lisible mais Leez ne sait pas encore en extraire le texte (scan sans
  // couche texte). Jamais confondu visuellement avec une vraie erreur --
  // le premier est un constat honnête sur une limite connue, le second un
  // vrai incident a corriger/relancer.
  // Stade d'analyse du deal -- toujours fixe par une action manuelle de
  // l'analyste (barre d'action du Triage), jamais deduit. Miroir de la
  // liste blanche serveur (PATCH /documents/:id/stage).
  const STAGE_LABELS = { triage: 'Triage', underwriting: 'Underwriting', comite: 'Comité', attente: 'En attente', rejete: 'Rejeté' };
  const stageBadge = stage => {
    const s = STAGE_LABELS[stage] ? stage : 'triage';
    return `<span class="stage-badge st-${s}">${STAGE_LABELS[s]}</span>`;
  };

  const statusChip = doc => {
    if (doc.status === 'complete') return '<span class="chip conf-high">ANALYSÉ</span>';
    if (doc.status === 'unsupported_scanned') return '<span class="chip conf-scan">SCAN NON PRIS EN CHARGE</span>';
    if (doc.status === 'error') return '<span class="chip conf-low">ERREUR</span>';
    return '<span class="chip status-trace">EN COURS</span>';
  };

  // ================= VAULT (liste des dossiers actifs) ================= //
  async function renderDossiersList() {
    const list = document.getElementById('dossiersList');
    list.innerHTML = '<div class="dossiers-empty">Chargement…</div>';
    const allDocs = await fetchDocuments();
    // Un dossier rejeté sort du Vault : il vit dans Mémoire (motif, rappel
    // en un clic) -- jamais supprimé, simplement plus dans la pile active.
    const docs = allDocs.filter(d => d.stage !== 'rejete');
    renderSidebarRecents(docs);
    if (docs.length === 0) {
      const nbRejetes = allDocs.length - docs.length;
      list.innerHTML = `<div class="dossiers-empty">${nbRejetes > 0 ? 'Aucun dossier actif — les dossiers refusés sont dans Mémoire.' : "Aucun dossier importé pour l'instant."}</div>`;
      return;
    }
    const FOLDER_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h4.3c.4 0 .78.16 1.06.44l1.2 1.2c.28.28.66.44 1.06.44h5.38A1.5 1.5 0 0 1 20 7.58V18.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z"/></svg>';
    list.innerHTML = docs.map(d => {
      const fi = d.ficheIdentite;
      const name = d.displayName || (fi && fi.adresse && fi.adresse.value) || d.filename;
      const type = (fi && fi.typeActif && fi.typeActif.value) ? fi.typeActif.value : null;
      const nbDocs = 1 + (d.supportingCount || 0);
      const dotColor = d.status === 'complete' ? 'var(--green)' : d.status === 'error' ? 'var(--pink)' : d.status === 'unsupported_scanned' ? 'var(--amber)' : 'var(--text-faint)';
      const verif = d.verification && d.verification.total > 0 ? ` · ${Math.round((d.verification.verified / d.verification.total) * 100)} % vérifiés` : '';
      const sub = `${nbDocs} document${nbDocs > 1 ? 's' : ''}${type ? ' · ' + escapeHtml(type) : ''}${d.stage !== 'triage' && STAGE_LABELS[d.stage] ? ' · ' + STAGE_LABELS[d.stage] : ''}${verif}`;
      return `<div class="deal-card" data-doc-id="${d.id}" data-stage="${STAGE_LABELS[d.stage] ? d.stage : 'triage'}">
        <div class="deal-card-thumb">${FOLDER_SVG}</div>
        <div class="deal-card-meta">
          <div class="deal-card-name-row">
            <h3 class="dossier-name">${escapeHtml(name)}</h3>
            <span class="deal-card-dot" style="background:${dotColor};" title="${d.status === 'complete' ? 'Analysé' : STATUS_LABELS[d.status] || d.status}"></span>
            <button class="deal-card-menu" data-delete-id="${d.id}" title="Supprimer ce dossier" aria-label="Options du dossier">···</button>
          </div>
          <div class="deal-card-sub">${sub}</div>
        </div>
      </div>`;
    }).join('');
    applyPipelineFilter();
    list.querySelectorAll('.deal-card').forEach(card => card.addEventListener('click', () => openDossier(card.dataset.docId)));
    list.querySelectorAll('.deal-card-menu').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      const name = btn.closest('.deal-card').querySelector('.dossier-name').textContent;
      if (!confirm(`Supprimer définitivement le dossier « ${name} » et le fichier importé associé ?`)) return;
      await fetch(`/api/documents/${btn.dataset.deleteId}`, { method: 'DELETE' });
      renderDossiersList();
    }));
  }

  // Dossiers recents sous "Vault" dans la sidebar (comme les projets
  // recents Harvey) : les 3 dossiers actifs les plus recents, reels.
  function renderSidebarRecents(docs) {
    const el = document.getElementById('sidebarRecentDossiers');
    if (!el) return;
    el.innerHTML = (docs || []).slice(0, 3).map(d => {
      const name = d.displayName || d.ficheIdentite?.adresse?.value || d.filename;
      return `<button data-recent-id="${d.id}" title="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
    }).join('');
    el.querySelectorAll('[data-recent-id]').forEach(btn => btn.addEventListener('click', () => openDossier(btn.dataset.recentId)));
  }

  // Filtres locaux du pipeline : correspondance de texte + stade d'analyse
  // -- purement côté client, aucune requête, jamais une "recherche
  // intelligente".
  let pipelineStageFilter = '';
  function applyPipelineFilter() {
    const q = (document.getElementById('dossiersFilter')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#dossiersList .deal-card').forEach(card => {
      const matchText = !q || card.textContent.toLowerCase().includes(q);
      const matchStage = !pipelineStageFilter || card.dataset.stage === pipelineStageFilter;
      card.style.display = matchText && matchStage ? '' : 'none';
    });
  }
  document.getElementById('dossiersFilter')?.addEventListener('input', applyPipelineFilter);
  document.querySelectorAll('#vaultTabs .vault-tab').forEach(tab => tab.addEventListener('click', () => {
    pipelineStageFilter = tab.dataset.stageTab;
    document.querySelectorAll('#vaultTabs .vault-tab').forEach(t => t.classList.toggle('active', t === tab));
    applyPipelineFilter();
  }));
  // Tuile "Mémoire du fonds" du Vault -- navigation simple.
  document.querySelectorAll('[data-go-view]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.goView)));


  // ================= OUVERTURE D'UN DOSSIER ================= //
  function applyCurrentDocRenders() {
    const fi = currentDoc.ficheIdentite;
    const name = (fi && fi.adresse && fi.adresse.value) ? fi.adresse.value : currentDoc.filename;
    renderDeal(currentDoc);
    renderExtract(currentDoc);
    renderContexte(currentDoc);
    renderAudit(currentDoc);
    renderReconciliation(currentDoc);
    renderVerification(currentDoc);
    renderExportView(currentDoc);
    syncNotesTextareas(currentDoc.notes || '');
    if (window.LeezSimulator) window.LeezSimulator.setDossierDoc(currentDoc);
    // Presélectionne ce dossier dans l'indicateur de l'Assistant global --
    // cohérence : ouvrir un dossier depuis la liste puis revenir sur
    // l'Assistant retrouve ce même dossier déjà en contexte.
    setAssistantDossierId(currentDoc.id, name);
    // Points de lancement individuels des agents (Analyse/Points d'attention/
    // Vérification) -- comme le bloc Enrichissement, n'a de sens qu'une fois
    // l'extraction terminée (les agents s'appuient sur les données extraites).
    if (currentDoc.status === 'complete') loadAgentLaunchPoints();
  }
  async function openDossier(id) {
    currentDoc = await fetchDocument(id);
    applyCurrentDocRenders();
    goDossierPage('deal');
  }
  // Recharge le dossier courant depuis le serveur sans changer de vue --
  // utilise apres une edition manuelle pour repartir des donnees (et des
  // indicateurs recalcules) reellement en base, sans faire naviguer l'utilisateur.
  async function refreshCurrentDoc() {
    if (!currentDoc) return;
    currentDoc = await fetchDocument(currentDoc.id);
    applyCurrentDocRenders();
  }
  async function patchField(body) {
    const res = await fetch(`/api/documents/${currentDoc.id}/edit`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Échec de l'enregistrement."); }
    await refreshCurrentDoc();
  }
  // Rend une valeur affichee editable au clic : bascule vers un <input>,
  // Entree/blur valide (PATCH + rechargement), Echap annule.
  // Edite la valeur directement dans son element (contenteditable), qui
  // s'ajuste naturellement a la largeur du contenu -- pas un input pleine
  // largeur superposant toute la cellule. Le clic n'est actif que sur ce
  // texte precis, pas sur le reste de la cellule/ligne (qui garde son propre
  // comportement, ex. selection de ligne pour le commentaire IA).
  // Pile globale d'annulation pour les éditions inline (fiche d'identité,
  // état locatif, compte de résultat) : un "bouton retour" unique, quel que
  // soit le champ édité. Chaque entrée réutilise le même `onCommit` que
  // l'édition d'origine (identifie le champ par section/index/clé, jamais
  // par un nœud DOM qui peut disparaître au prochain rendu) avec la valeur
  // d'avant la modification -- annuler revient donc à ré-appliquer cette
  // valeur, ce qui redéclenche le même recalcul serveur qu'une édition
  // normale (le champ reste marqué "MODIFIÉ", ce qui est honnête : il a bien
  // été touché manuellement, y compris pour revenir en arrière).
  let editUndoStack = [];
  function syncUndoButton() {
    const btn = document.getElementById('editUndoBtn');
    btn.disabled = editUndoStack.length === 0;
  }
  function pushUndo(onCommit, previousValue) {
    editUndoStack.push({ onCommit, previousValue });
    if (editUndoStack.length > 20) editUndoStack.shift();
    syncUndoButton();
  }
  document.getElementById('editUndoBtn').addEventListener('click', async () => {
    const entry = editUndoStack.pop();
    syncUndoButton();
    if (entry) await entry.onCommit(entry.previousValue);
  });

  function attachEditableValue(el, { getValue, onCommit }) {
    el.classList.add('editable-text');
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (el.getAttribute('contenteditable') === 'true') return;
      const current = getValue();
      const originalHTML = el.innerHTML;
      el.textContent = current ?? '';
      el.setAttribute('contenteditable', 'true');
      el.classList.add('editing');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let done = false;
      const finish = async commit => {
        if (done) return;
        done = true;
        el.removeEventListener('keydown', onKeydown);
        el.removeEventListener('blur', onBlur);
        el.removeAttribute('contenteditable');
        el.classList.remove('editing');
        const newVal = el.textContent.trim();
        if (commit && newVal !== String(current ?? '')) {
          // onCommit re-rend généralement toute la vue (nouvelles données du
          // serveur) : `el` peut ne plus exister ensuite. On retrouve le
          // nouvel élément équivalent par ses attributs data-* pour y jouer
          // le flash de confirmation, plutôt que de flasher un nœud détaché.
          const sel = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
          pushUndo(onCommit, current ?? '');
          await onCommit(newVal);
          if (sel) window.LeezFmt.flashValue(document.querySelector(sel));
        } else {
          el.innerHTML = originalHTML;
        }
      };
      function onKeydown(ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        if (ev.key === 'Escape') finish(false);
      }
      function onBlur() { finish(true); }
      el.addEventListener('keydown', onKeydown);
      el.addEventListener('blur', onBlur);
    });
  }

  // ---------- comptage réel des champs vérifiés (score de confiance) ----------
  function walkCited(node, acc) {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(n => walkCited(n, acc)); return; }
    if (typeof node !== 'object') return;
    if ('value' in node && 'quote' in node && 'page' in node) {
      acc.total++; if (node.value !== null && node.value !== undefined) acc.verified++;
      return;
    }
    Object.values(node).forEach(v => walkCited(v, acc));
  }
  function confidenceStats(doc) {
    const acc = { total: 0, verified: 0 };
    walkCited(doc.ficheIdentite, acc);
    walkCited(doc.etatLocatif, acc);
    walkCited(doc.t12, acc);
    return acc;
  }

  // ================= SOMMAIRE (deal) ================= //
  // Temps relatif pour les "Requetes recentes" ("il y a 10 min").
  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "a l'instant";
    if (mins < 60) return `il y a ${mins} min`;
    const h = Math.round(mins / 60);
    if (h < 24) return `il y a ${h} h`;
    return new Date(iso).toLocaleDateString('fr-FR');
  }
  function fmtBytes(n) {
    if (n == null) return '\u2014';
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
    return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  }
  // Couleur de pastille par categorie de document (badges de la table des
  // fichiers) -- palette fixe, une couleur par categorie du catalogue.
  const CATEGORY_DOT_COLORS = {
    om: '#b0812a', photos: '#8a63d2', commercialisation: '#c2543a', locatif: '#2f8f5b',
    financier: '#b0812a', technique: '#3a6ea5', reglementaire: '#a5473a', juridique: '#5b5ea6', esg: '#2e7d6e',
  };
  function categoryBadge(id, label) {
    const color = CATEGORY_DOT_COLORS[id] || 'var(--text-faint)';
    return `<span class="file-cat-badge"><span class="file-cat-dot" style="background:${color};"></span>${escapeHtml(label)}</span>`;
  }
  const QUERY_KIND_LABELS = { question: 'Question', analyse: 'Table d\u2019analyse', points: 'Points \u00e0 v\u00e9rifier' };

  function renderDeal(doc) {
    const fi = doc.ficheIdentite || {};
    const val = f => (f && f.value != null) ? f.value : null;
    const valFmt = (key, f) => { const v = val(f); return v != null ? formatFicheValue(key, v) : null; };
    const name = doc.displayName || val(fi.adresse) || doc.filename;
    const typeActif = val(fi.typeActif);
    const stepComplete = doc.status === 'complete';
    const stepError = doc.status === 'error';
    const stepScanned = doc.status === 'unsupported_scanned';
    const nbDocs = 1 + (doc.supportingCountCache ?? 0);
    const subParts = [
      `${nbDocs} document${nbDocs > 1 ? 's' : ''}`,
      stepComplete ? 'Analys\u00e9' : (STATUS_LABELS[doc.status] || doc.status),
      typeActif, valFmt('prixDemande', fi.prixDemande),
      (doc.queries || []).length ? `${doc.queries.length} requ\u00eate${doc.queries.length > 1 ? 's' : ''}` : null,
    ].filter(Boolean);

    let statusBlockHTML = '';
    if (!stepComplete) {
      if (stepError) {
        statusBlockHTML = `<div class="panel" style="padding:22px 26px;margin-top:20px;"><div class="flag"><span class="dot pink"></span><div><div class="flag-title">L'extraction a \u00e9chou\u00e9</div><div class="flag-body">${escapeHtml(doc.errorMessage || 'Erreur inconnue.')}</div><button class="btn btn-solid" id="dealRetryBtn" style="margin-top:12px;">Relancer l'extraction</button></div></div></div>`;
      } else if (stepScanned) {
        statusBlockHTML = `<div class="panel" style="padding:22px 26px;margin-top:20px;"><div class="flag"><span class="dot amber"></span><div><div class="flag-title">Document non exploitable (scan sans texte)</div><div class="flag-body">${escapeHtml(doc.errorMessage || 'Ce PDF semble scann\u00e9, sans couche de texte extractible.')} Demandez au vendeur une version texte du document.</div></div></div></div>`;
      } else {
        statusBlockHTML = `<div class="panel" style="padding:22px 26px;margin-top:20px;"><div class="flag"><span class="dot trace"></span><div><div class="flag-title">Extraction en cours</div><div class="flag-body">${STATUS_LABELS[doc.status] || doc.status}</div></div></div></div>`;
      }
    }

    document.getElementById('dealBody').innerHTML = `
      <div class="dossier-open-head">
        <button class="dossier-back" id="dealBackBtn" aria-label="Retour au Vault">\u2190</button>
        <div class="dossier-open-title">
          <h1>${escapeHtml(name)}</h1>
          <div class="dossier-open-sub">${subParts.map(escapeHtml).join(' \u00b7 ')}</div>
        </div>
        <div class="dossier-open-actions">
          <button class="btn ${doc.stage === 'underwriting' || doc.stage === 'comite' ? 'btn-solid' : 'btn-outline'}" id="dealPursueBtn">${doc.stage === 'rejete' ? '\u21a9 Rappeler et poursuivre' : doc.stage === 'underwriting' || doc.stage === 'comite' ? '\u2713 Poursuivi' : '\u25b6 Poursuivre'}</button>
          <button class="btn btn-outline" id="dealAbandonBtn" ${doc.stage === 'rejete' ? 'disabled' : ''}>\u2715 Abandonner</button>
        </div>
      </div>

      ${doc.stage === 'rejete' && doc.decisionMotif ? `
      <div class="decision-banner">
        <div><div class="decision-title">Dossier refus\u00e9${doc.decidedAt ? ' le ' + new Date(doc.decidedAt).toLocaleDateString('fr-FR') : ''}${doc.decidedBy ? ' par ' + escapeHtml(doc.decidedBy) : ''}</div>
        Motif : ${escapeHtml(doc.decisionMotif)}<br>Ce dossier vit dans M\u00e9moire \u2014 \u00ab Rappeler et poursuivre \u00bb le ram\u00e8ne dans le Vault.</div>
      </div>` : doc.decisionMotif ? `
      <div class="decision-banner recalled">
        <div><div class="decision-title">Rappel\u00e9 dans le Vault \u2014 pr\u00e9c\u00e9demment refus\u00e9${doc.decidedAt ? ' le ' + new Date(doc.decidedAt).toLocaleDateString('fr-FR') : ''}${doc.decidedBy ? ' par ' + escapeHtml(doc.decidedBy) : ''}</div>
        Ancien motif de refus : ${escapeHtml(doc.decisionMotif)}</div>
      </div>` : ''}

      ${statusBlockHTML}

      ${stepComplete ? `
      <div class="deal-ask">
        <div class="deal-chat-log" id="dealChatLog" style="display:none;"></div>
        <div class="deal-ask-card">
          <textarea id="dealChatInput" rows="2" placeholder="Poser une question\u2026"></textarea>
          <div class="deal-ask-bar">
            <div class="deal-ask-controls">
              <div class="ask-select-wrap">
                <button type="button" class="ask-select" id="dealSourcesBtn">Sources : Documents \u2304</button>
                <div class="ask-menu ask-menu-sources" id="dealSourcesMenu" style="display:none;">
                  <label><input type="checkbox" data-source="docs" checked> Documents du dossier</label>
                  <label><input type="checkbox" data-source="web"> Web <span>fiabilit\u00e9 plus faible \u2014 marqu\u00e9 comme externe</span></label>
                  <label><input type="checkbox" data-source="memoire"> M\u00e9moire <span>base de connaissances juridique/financi\u00e8re</span></label>
                </div>
              </div>
            </div>
            <button class="agent-send-btn" id="dealChatSendBtn" aria-label="Envoyer">\u2192</button>
          </div>
        </div>
        <div class="deal-ask-chips">
          <button class="deal-ask-chip" data-chip-mode="analyse">\ud83d\udccb Analyse (crit\u00e8res du fonds)</button>
          <button class="deal-ask-chip" data-chip-mode="points">\u26a0 Points \u00e0 v\u00e9rifier</button>
          <button class="deal-ask-chip" data-chip-mode="question">\ud83d\udcac Question libre</button>
        </div>
      </div>

      <div class="deal-analysis-zone" id="dealAnalysisZone" style="display:none;"></div>

      <div class="deal-section" id="dealQueriesSection" style="${(doc.queries || []).length ? '' : 'display:none;'}">
        <div class="deal-section-head"><span class="deal-section-title">Requ\u00eates r\u00e9centes</span></div>
        <div class="deal-queries" id="dealQueriesRows"></div>
      </div>` : ''}

      <div class="deal-section">
        <div class="deal-section-head">
          <span class="deal-section-title">Documents du dossier</span>
          <span class="deal-section-tools">
            <input type="search" id="dealFilesFilter" class="vault-mini-search" placeholder="Rechercher" autocomplete="off">
            <button class="btn btn-outline" data-go="ingest">\u21e7 Ajouter des fichiers</button>
          </span>
        </div>
        <div style="overflow-x:auto;">
          <table class="deal-files-table">
            <thead><tr><th>Nom</th><th>Cat\u00e9gorie</th><th>Type</th><th>Import\u00e9 le</th><th class="num">Taille</th></tr></thead>
            <tbody id="dealFilesBody">
              <tr data-open-file="/api/documents/${doc.id}/file">
                <td class="file-name">\ud83d\udcc4 ${escapeHtml(doc.filename)}</td>
                <td>${categoryBadge('om', 'Offering Memorandum')}</td>
                <td>Fichier</td>
                <td>${doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString('fr-FR') : '\u2014'}</td>
                <td class="num">${fmtBytes(doc.fileSizeBytes)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>`;

    renderDealQueries(doc);

    // ---------- listeners ----------
    document.getElementById('dealBackBtn')?.addEventListener('click', () => showView('dossiers'));
    document.querySelectorAll('#dealBody [data-go]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.go)));
    document.getElementById('dealPursueBtn')?.addEventListener('click', async () => {
      if (doc.stage === 'underwriting' || doc.stage === 'comite') return;
      await applyStageChange('underwriting');
    });
    document.getElementById('dealAbandonBtn')?.addEventListener('click', () => { if (currentDoc.stage !== 'rejete') openRejectModal(); });
    wireDealChatControls();
    document.querySelectorAll('#dealBody [data-chip-mode]').forEach(chip => chip.addEventListener('click', () => {
      // Analyse = la grille des donnees extraites (onglets Fiche/Contexte/
      // Etat locatif/T12/Surfaces/Indicateurs) -- navigation directe.
      if (chip.dataset.chipMode === 'analyse') {
        logDealQuery('Analyse — grille des données extraites', 'analyse');
        goDossierPage('extract');
        return;
      }
      setDealChatMode(chip.dataset.chipMode);
    }));
    document.getElementById('dealChatSendBtn')?.addEventListener('click', sendDealChatQuestion);
    document.getElementById('dealChatInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDealChatQuestion(); }
    });
    document.getElementById('dealFilesFilter')?.addEventListener('input', () => {
      const q = document.getElementById('dealFilesFilter').value.trim().toLowerCase();
      document.querySelectorAll('#dealFilesBody tr').forEach(tr => {
        tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    document.getElementById('dealRetryBtn')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = 'Relance en cours\u2026';
      try {
        const res = await fetch(`/api/documents/${currentDoc.id}/retry`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '\u00c9chec de la relance.');
        const IN_PROGRESS = ['extracting_pages', 'extracting_identite', 'extracting_t12', 'extracting_signaux', 'computing_indicators'];
        const poll = setInterval(async () => {
          const d2 = await fetchDocument(currentDoc.id);
          if (!IN_PROGRESS.includes(d2.status)) { clearInterval(poll); await refreshCurrentDoc(); }
        }, 2000);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = "Relancer l'extraction";
      }
    });
    loadDealDocuments(doc);
  }

  // Rejoue la sortie d'une requete sur le dossier DEJA ouvert : la grille
  // pour une Analyse, la liste (deterministe) pour Points a verifier, la
  // question pre-remplie pour une Question libre (relancer le modele reste
  // un geste explicite).
  function replayDealQuery(q) {
    if (q.kind === 'analyse') { goDossierPage('extract'); return; }
    if (q.kind === 'points') { if (currentDoc?.status === 'complete') appendDealChatPoints(); return; }
    const input = document.getElementById('dealChatInput');
    if (input) {
      document.querySelector('.deal-ask')?.classList.remove('collapsed');
      input.value = q.label;
      input.focus();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  function renderDealQueries(doc) {
    const rows = document.getElementById('dealQueriesRows');
    if (!rows) return;
    const queries = (doc.queries || []).slice(0, 5);
    document.getElementById('dealQueriesSection').style.display = queries.length ? '' : 'none';
    rows.innerHTML = queries.map((q, i) => `
      <div class="deal-query-row" data-dq-idx="${i}" title="Rouvrir cette requête">
        <span class="deal-query-label">${escapeHtml(q.label)}</span>
        <span class="deal-query-kind">${QUERY_KIND_LABELS[q.kind] || 'Question'}</span>
        <span class="deal-query-by">${escapeHtml(q.by || '')}</span>
        <span class="deal-query-when">${timeAgo(q.at)}</span>
        <button class="deal-query-delete" data-dq-del="${escapeHtml(q.at)}" title="Supprimer cette requête" aria-label="Supprimer cette requête">✕</button>
      </div>`).join('');
    rows.querySelectorAll('[data-dq-idx]').forEach(row => row.addEventListener('click', () => replayDealQuery(queries[+row.dataset.dqIdx])));
    rows.querySelectorAll('[data-dq-del]').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      const res = await fetch(`/api/documents/${doc.id}/queries`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at: btn.dataset.dqDel }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Suppression impossible.'); return; }
      currentDoc.queries = (await res.json()).queries;
      renderDealQueries(currentDoc);
      loadSidebarQueries();
    }));
  }

  // Enregistre la requete dans le journal du dossier (best effort -- un
  // echec ne bloque jamais la reponse elle-meme).
  function logDealQuery(label, kind) {
    fetch(`/api/documents/${currentDoc.id}/queries`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, kind }),
    }).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.queries) { currentDoc.queries = d.queries; renderDealQueries(currentDoc); loadSidebarQueries(); }
    }).catch(() => {});
  }

  // ---------- Requetes recentes de la sidebar (transverses a TOUT Leez) ----------
  // Les 5 dernieres requetes de l'espace de travail, tous dossiers
  // confondus. Cliquer re-ouvre le dossier et remet la sortie : la grille
  // pour une Analyse, la liste pour Points a verifier (deterministes,
  // regenerees a l'identique) ; une Question libre est pre-remplie dans le
  // chat -- relancer un appel au modele reste un geste explicite.
  async function runRecentQuery(q) {
    await openDossier(q.docId);
    replayDealQuery(q);
  }
  function loadSidebarQueries() {
    fetch('/api/documents-queries/recent').then(r => r.ok ? r.json() : []).then(queries => {
      const el = document.getElementById('sidebarQueries');
      if (!el) return;
      if (!Array.isArray(queries) || queries.length === 0) {
        el.innerHTML = '';
        return;
      }
      el.innerHTML = queries.map((q, i) => `<button data-sq-idx="${i}" title="${escapeHtml(q.label)}">
          <span class="sq-label">${escapeHtml(q.label)}</span>
          <span class="sq-meta">${escapeHtml(q.docName || '')} · ${QUERY_KIND_LABELS[q.kind] || 'Question'} · ${timeAgo(q.at)}</span>
        </button>`).join('');
      el.querySelectorAll('[data-sq-idx]').forEach(btn => btn.addEventListener('click', () => runRecentQuery(queries[+btn.dataset.sqIdx])));
    }).catch(() => {});
  }
  loadSidebarQueries();

  // Lignes annexes de la table des documents -- categorie (badge colore),
  // date et taille reelles ; clic = fichier complet dans un nouvel onglet.
  async function loadDealDocuments(doc) {
    const body = document.getElementById('dealFilesBody');
    if (!body) return;
    let supporting = [];
    try { supporting = await fetch(`/api/documents/${doc.id}/supporting`).then(r => r.json()); } catch { /* liste indisponible */ }
    if (Array.isArray(supporting) && supporting.length > 0) {
      // Compte total affiche dans le sous-titre (OM + annexes reelles).
      doc.supportingCountCache = supporting.length;
      body.insertAdjacentHTML('beforeend', supporting.map(s => {
        const cat = SUPPORTING_CATALOG.find(c => c.id === s.category);
        return `<tr data-open-file="/api/documents/${doc.id}/supporting/${s.id}/file">
          <td class="file-name">${s.isImage ? '\ud83d\uddbc' : '\ud83d\udcc4'} ${escapeHtml(s.filename)}</td>
          <td>${categoryBadge(s.category, s.type || cat?.label || s.category)}</td>
          <td>Fichier</td>
          <td>${s.uploadedAt ? new Date(s.uploadedAt).toLocaleDateString('fr-FR') : '\u2014'}</td>
          <td class="num">${fmtBytes(s.sizeBytes)}</td>
        </tr>`;
      }).join(''));
    }
    body.querySelectorAll('[data-open-file]').forEach(tr => tr.addEventListener('click', () => window.open(tr.dataset.openFile, '_blank', 'noopener')));
  }

  // ---------- chat du dossier : modes deterministes + question libre ----------
  function appendDealChatEntry(userLabel, leezHTML) {
    const log = document.getElementById('dealChatLog');
    if (!log) return null;
    log.style.display = 'flex';
    log.querySelector('.deal-chat-empty')?.remove();
    if (userLabel) log.insertAdjacentHTML('beforeend', `<div class="deal-chat-msg user">${escapeHtml(userLabel)}</div>`);
    const el = document.createElement('div');
    el.className = 'deal-chat-msg leez';
    el.innerHTML = leezHTML;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  // ---------- Mode Analyse : grille progressive (criteres du fonds) ----------
  // 100% deterministe -- confronte les criteres du fonds (computeMandateFit,
  // deja calcule serveur) aux donnees extraites, avec construction
  // PROGRESSIVE de la grille : ligne d'etat par etapes, lignes pre-remplies
  // (les criteres sont connus avant lecture), cellules Constate/Verdict/
  // Source qui se remplissent une a une. Jamais un spinner unique.
  const ANALYSIS_PROMPT = "Analyse ce dossier : confronte les données extraites aux critères du fonds et donne un verdict par critère, avec la source de chaque valeur.";
  const POINTS_PROMPT = "Points à vérifier avant de décider : bloquants, à creuser, manquants.";
  // Mode et sources du chat du dossier -- etat module (survit aux re-rendus
  // du dossier). Trois modes, trois formes de sortie : la grille (Analyse),
  // la liste priorisee (Points), la prose citee (Question). Les sources
  // cochees sont reellement transmises au serveur (jamais un simple filtre
  // d'affichage) -- l'analyste voit d'ou viendra la reponse AVANT de la lire.
  const DEAL_MODE_LABELS = { analyse: 'Analyse', points: 'Points à vérifier', question: 'Question' };
  let dealChatMode = 'question';
  let dealChatSources = { docs: true, web: false, memoire: false };

  // Le mode courant se lit sur les chips eux-memes (chip actif surligne) --
  // plus de menu deroulant Mode.
  function syncModeChips() {
    document.querySelectorAll('#dealBody [data-chip-mode]').forEach(chip =>
      chip.classList.toggle('active', chip.dataset.chipMode === dealChatMode));
  }
  function setDealChatMode(mode) {
    dealChatMode = mode;
    syncModeChips();
    const input = document.getElementById('dealChatInput');
    if (!input) return;
    // Le texte APPARAIT en entier, d'un coup -- jamais une animation de frappe.
    if (mode === 'analyse') input.value = ANALYSIS_PROMPT;
    else if (mode === 'points') input.value = POINTS_PROMPT;
    else input.value = '';
    input.focus();
  }
  // Change le mode sans toucher au champ de saisie (retour a Question apres
  // un lancement, ou quand l'analyste edite le prompt a la main -- son texte
  // devient une question libre, jamais silencieusement remplace).
  function setDealChatModeSilent(mode) {
    dealChatMode = mode;
    syncModeChips();
  }
  document.addEventListener('input', e => {
    if (e.target?.id === 'dealChatInput' && e.isTrusted && dealChatMode !== 'question') setDealChatModeSilent('question');
  });

  function updateDealSourcesLabel() {
    const btn = document.getElementById('dealSourcesBtn');
    if (!btn) return;
    const parts = [];
    if (dealChatSources.docs) parts.push('Documents');
    if (dealChatSources.web) parts.push('Web');
    if (dealChatSources.memoire) parts.push('Mémoire');
    btn.textContent = `Sources : ${parts.length ? parts.join(' + ') : 'aucune'} \u2304`;
  }
  function wireDealChatControls() {
    const srcBtn = document.getElementById('dealSourcesBtn');
    const srcMenu = document.getElementById('dealSourcesMenu');
    if (!srcBtn) return;
    const closeMenus = () => { srcMenu.style.display = 'none'; };
    srcBtn.addEventListener('click', e => { e.stopPropagation(); srcMenu.style.display = srcMenu.style.display === 'none' ? '' : 'none'; });
    document.addEventListener('click', closeMenus);
    srcMenu.addEventListener('click', e => e.stopPropagation());
    srcMenu.querySelectorAll('[data-source]').forEach(cb => {
      cb.checked = dealChatSources[cb.dataset.source];
      cb.addEventListener('change', () => { dealChatSources[cb.dataset.source] = cb.checked; updateDealSourcesLabel(); });
    });
    // Restaure l'etat courant (mode/sources) apres un re-rendu du dossier.
    syncModeChips();
    updateDealSourcesLabel();
  }

  async function runDealAnalysis() {
    const doc = currentDoc;
    const zone = document.getElementById('dealAnalysisZone');
    if (!zone) return;
    logDealQuery('Analyse — données du dossier vs critères du fonds', 'analyse');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Le chat se replie en une ligne, la zone de resultat s'ouvre dessous.
    document.querySelector('.deal-ask')?.classList.add('collapsed');
    const input = document.getElementById('dealChatInput');
    if (input) input.value = '';
    zone.style.display = '';

    const fit = doc.audit?.mandateFit;
    if (!fit || !fit.configured || fit.criteria.length === 0) {
      zone.innerHTML = `<div class="panel" style="padding:22px 26px;"><div class="flag"><span class="dot faint"></span><div><div class="flag-title">Aucun critère configuré</div><div class="flag-body">Définissez le mandat du fonds dans l'onglet Critères pour activer l'analyse — la grille confronte chaque critère aux données extraites.</div><button class="btn btn-outline" id="analysisGoCriteria" style="margin-top:10px;">Ouvrir les Critères →</button></div></div></div>`;
      document.getElementById('analysisGoCriteria')?.addEventListener('click', () => showView('settings'));
      return;
    }

    const nbDocs = 1 + (doc.supportingCountCache ?? 0);
    const VERDICT_ICON = { ok: '✓', echec: '✗', indetermine: '⊘' };
    // Grille immediatement visible : lignes = criteres (connus d'avance),
    // colonnes Constate/Verdict/Source en attente (squelette grise).
    zone.innerHTML = `
      <div class="analysis-status" id="analysisStatus"><span class="analysis-status-dot"></span><span id="analysisStatusText">Lecture des données vérifiées… 1 / ${nbDocs} document${nbDocs > 1 ? 's' : ''}</span></div>
      <div class="analysis-summary" id="analysisSummary" style="visibility:hidden;"></div>
      <div class="analysis-split">
        <div class="analysis-grid-wrap">
          <table class="analysis-grid" id="analysisGrid">
            <thead><tr><th>Critère</th><th>Attendu</th><th>Constaté</th><th style="text-align:center;">Verdict</th><th>Source</th></tr></thead>
            <tbody>${fit.criteria.map((c, i) => `
              <tr data-crit-idx="${i}" class="pending">
                <td class="crit-label">${escapeHtml(c.label)}</td>
                <td>${escapeHtml(c.attendu || '—')}</td>
                <td class="cell-constate"><span class="cell-skeleton"></span></td>
                <td class="cell-verdict" style="text-align:center;"><span class="cell-skeleton" style="width:18px;"></span></td>
                <td class="cell-source"><span class="cell-skeleton" style="width:36px;"></span></td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="analysis-source-panel" id="analysisSourcePanel" style="display:none;">
          <div class="interp-source-head">
            <span class="label">Page <span id="analysisSourcePageNum"></span> du document source</span>
            <button class="source-modal-close" id="analysisSourceClose" aria-label="Fermer">✕</button>
          </div>
          <div class="source-modal-body">
            <iframe id="analysisSourceFrame" class="source-modal-frame" title="Page source du document"></iframe>
            <div class="source-modal-text" id="analysisSourceText" style="display:none;"></div>
            <div class="source-modal-quote" id="analysisSourceQuote" style="display:none;"></div>
          </div>
        </div>
      </div>
      <div class="analysis-actions" id="analysisActions" style="visibility:hidden;">
        <a class="btn btn-outline" href="/api/documents/${doc.id}/export/xlsx" download>⬇ Exporter (.xlsx)</a>
        <button class="btn btn-outline" id="analysisCopyBtn">⧉ Copier la grille</button>
        <button class="btn btn-outline" id="analysisPointsBtn">⚠ Points à vérifier</button>
        <span style="flex:1;"></span>
        <button class="btn ${doc.stage === 'underwriting' || doc.stage === 'comite' ? 'btn-solid' : 'btn-outline'}" id="analysisPursueBtn">${doc.stage === 'underwriting' || doc.stage === 'comite' ? '✓ Poursuivi' : '▶ Poursuivre'}</button>
        <button class="btn btn-outline" id="analysisAbandonBtn" ${doc.stage === 'rejete' ? 'disabled' : ''}>✕ Abandonner</button>
      </div>
      <div id="analysisPointsZone"></div>`;
    zone.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

    const statusText = document.getElementById('analysisStatusText');
    if (!reduced) { await sleep(700); }
    statusText.textContent = 'Confrontation aux critères du fonds…';

    // Remplissage progressif, dans le desordre -- chaque ligne complete
    // prend sa couleur de verdict. Les valeurs sont REELLES (deja
    // verifiees) : seule leur apparition est progressive.
    const order = fit.criteria.map((_, i) => i);
    if (!reduced) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const idx of order) {
      if (!reduced) await sleep(260 + Math.random() * 240);
      const c = fit.criteria[idx];
      const tr = zone.querySelector(`tr[data-crit-idx="${idx}"]`);
      if (!tr) continue;
      tr.classList.remove('pending');
      tr.classList.add(`st-${c.status}`);
      tr.querySelector('.cell-constate').innerHTML = c.constate != null ? escapeHtml(c.constate)
        : `<button class="cell-missing" data-missing-crit="${escapeHtml(c.label)}" title="Non trouvé dans l'OM — cliquer pour interroger les documents du dossier">—</button>`;
      tr.querySelector('.cell-verdict').innerHTML = `<span class="verdict-ico v-${c.status}">${VERDICT_ICON[c.status]}</span>`;
      tr.querySelector('.cell-source').innerHTML = c.page
        ? `<button class="cite-link" data-src-page="${c.page}" data-src-quote="${escapeHtml(c.quote || '')}">voir</button>`
        : (c.calcule ? '<span class="label">CALCULÉ</span>' : '—');
    }

    // Tri final : non conformes en haut, puis non trouves, puis conformes --
    // l'information qui fait decider au-dessus de la ligne de flottaison.
    const tbody = zone.querySelector('#analysisGrid tbody');
    const rank = { echec: 0, indetermine: 1, ok: 2 };
    [...tbody.querySelectorAll('tr')]
      .sort((a, b) => rank[fit.criteria[+a.dataset.critIdx].status] - rank[fit.criteria[+b.dataset.critIdx].status])
      .forEach(tr => tbody.appendChild(tr));

    // Bandeau de synthese : decompte des trois verdicts + ecart principal.
    // Pas de score global -- l'analyste voit sur quoi ca casse.
    const counts = { ok: 0, echec: 0, indetermine: 0 };
    fit.criteria.forEach(c => counts[c.status]++);
    document.getElementById('analysisSummary').innerHTML = `
      <div class="analysis-counts">
        <span class="ac ac-ok">${counts.ok} conforme${counts.ok > 1 ? 's' : ''}</span>
        <span class="ac ac-echec">${counts.echec} non conforme${counts.echec > 1 ? 's' : ''}</span>
        <span class="ac ac-indetermine">${counts.indetermine} non trouvé${counts.indetermine > 1 ? 's' : ''}</span>
      </div>
      ${fit.ecartPrincipal ? `<div class="analysis-ecart"><span class="label">ÉCART PRINCIPAL</span><div>${escapeHtml(fit.ecartPrincipal.phrase || fit.ecartPrincipal.label)}</div></div>` : ''}`;
    document.getElementById('analysisSummary').style.visibility = '';
    statusText.textContent = `Analyse terminée · ${fit.criteria.length} critère${fit.criteria.length > 1 ? 's' : ''} confronté${fit.criteria.length > 1 ? 's' : ''}`;
    document.getElementById('analysisStatus').classList.add('done');
    document.getElementById('analysisActions').style.visibility = '';

    // ---------- interactions de la grille ----------
    // "voir" -> panneau source a DROITE (PDF a la bonne page, phrase
    // surlignee), la grille reste visible a gauche.
    zone.querySelectorAll('[data-src-page]').forEach(btn => btn.addEventListener('click', () => {
      const panel = document.getElementById('analysisSourcePanel');
      panel.style.display = '';
      document.getElementById('analysisSourcePageNum').textContent = btn.dataset.srcPage;
      loadSourcePage(Number(btn.dataset.srcPage), btn.dataset.srcQuote, {
        frameEl: document.getElementById('analysisSourceFrame'),
        textEl: document.getElementById('analysisSourceText'),
        quoteEl: document.getElementById('analysisSourceQuote'),
      });
    }));
    document.getElementById('analysisSourceClose')?.addEventListener('click', () => {
      document.getElementById('analysisSourcePanel').style.display = 'none';
    });
    // "—" (non trouve) -> pre-remplit une question ciblee dans le chat sur
    // les autres documents du dossier.
    zone.querySelectorAll('[data-missing-crit]').forEach(btn => btn.addEventListener('click', () => {
      const ask = document.querySelector('.deal-ask');
      ask?.classList.remove('collapsed');
      const inp = document.getElementById('dealChatInput');
      if (inp) { inp.value = `Où trouver « ${btn.dataset.missingCrit} » dans les documents du dossier ?`; inp.focus(); }

      ask?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    // Copie de la grille (TSV) dans le presse-papier.
    document.getElementById('analysisCopyBtn')?.addEventListener('click', async () => {
      const lines = [['Critère', 'Attendu', 'Constaté', 'Verdict'].join('\t')];
      [...tbody.querySelectorAll('tr')].forEach(tr => {
        const c = fit.criteria[+tr.dataset.critIdx];
        lines.push([c.label, c.attendu || '—', c.constate || '—', { ok: 'Conforme', echec: 'Non conforme', indetermine: 'Non trouvé' }[c.status]].join('\t'));
      });
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        const b = document.getElementById('analysisCopyBtn');
        b.textContent = '✓ Copié'; setTimeout(() => { b.textContent = '⧉ Copier la grille'; }, 1800);
      } catch { alert('Copie impossible dans ce navigateur.'); }
    });
    // Points a verifier : enchaine le second mode SOUS la grille, sans
    // repasser par le chat.
    document.getElementById('analysisPointsBtn')?.addEventListener('click', () => {
      const pz = document.getElementById('analysisPointsZone');
      const built = buildPointsHTML(currentDoc);
      pz.innerHTML = `<div class="panel" style="padding:20px 24px;margin-top:16px;"><div class="panel-head" style="padding:0 0 10px;"><h3 style="font-size:1rem;">Points à vérifier</h3></div>${built}</div>`;
      logDealQuery('Points à vérifier avant de décider', 'points');
      pz.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // La decision, accessible directement depuis l'ecran d'analyse.
    document.getElementById('analysisPursueBtn')?.addEventListener('click', async () => {
      if (currentDoc.stage === 'underwriting' || currentDoc.stage === 'comite') return;
      await applyStageChange('underwriting');
    });
    document.getElementById('analysisAbandonBtn')?.addEventListener('click', () => { if (currentDoc.stage !== 'rejete') openRejectModal(); });
  }

  // Mode Points a verifier : alertes deja calculees (audit.cards), ce que
  // le dossier ne dit pas (criteres intestables + points a creuser) --
  // deterministe egalement.
  function buildPointsHTML(doc) {
    const cards = (doc.audit?.cards || []).filter(c => c.niveau === 'rouge' || c.niveau === 'orange');
    const bloquants = (doc.audit?.mandateFit?.criteria || []).filter(c => c.status === 'indetermine');
    const points = doc.audit?.pointsACreuser || [];
    const cardsHTML = cards.length === 0
      ? '<div class="flag"><span class="dot green"></span><div><div class="flag-body">Aucune alerte détectée sur les critères vérifiés par Leez.</div></div></div>'
      : cards.map(c => `<div class="flag"><span class="dot ${c.niveau === 'rouge' ? 'pink' : 'amber'}"></span><div><div class="flag-title">${escapeHtml(c.titre)}</div><div class="flag-body">${escapeHtml(c.constat)}</div></div></div>`).join('');
    const bloquantsHTML = bloquants.length === 0 ? '' : `
      <div class="label" style="margin:14px 0 6px;">BLOQUANT — UN CRITÈRE DU MANDAT NE PEUT PAS ÊTRE TESTÉ</div>
      ${bloquants.map(c => `<div class="flag"><span class="dot pink"></span><div><div class="flag-title">${escapeHtml(c.label)}</div><div class="flag-body">${escapeHtml(c.detail)}</div></div></div>`).join('')}`;
    const pointsHTML = points.length === 0 ? '' : `
      <div class="label" style="margin:14px 0 6px;">À DEMANDER AVANT DE CONCLURE</div>
      ${points.map(p => `<div class="flag"><span class="dot amber"></span><div><div class="flag-title">${escapeHtml(p.titre)}</div><div class="flag-body">${escapeHtml(p.detail || '')}</div></div></div>`).join('')}`;
    return `<div class="label" style="margin-bottom:6px;">ALERTES (${cards.length})</div>
      <div class="flags-list">${cardsHTML}</div>${bloquantsHTML}${pointsHTML}`;
  }
  function appendDealChatPoints() {
    appendDealChatEntry('Points à vérifier avant de décider', buildPointsHTML(currentDoc));
  }

  // Question libre : meme moteur que l'Assistant global (dealChat.js cote
  // serveur -- reponse par paragraphes, chacun avec sa source). Une erreur
  // (ex. credits API epuises) s'affiche telle quelle, jamais masquee.
  async function sendDealChatQuestion() {
    const input = document.getElementById('dealChatInput');
    // Le MODE selectionne dicte la forme de sortie -- jamais une detection
    // de texte. Analyse -> grille progressive ; Points -> liste priorisee ;
    // Question -> prose citee.
    if (dealChatMode === 'analyse') { if (input) input.value = ''; setDealChatModeSilent('question'); goDossierPage('extract'); return; }
    if (dealChatMode === 'points') {
      if (input) input.value = '';
      setDealChatModeSilent('question');
      appendDealChatPoints();
      logDealQuery('Points à vérifier avant de décider', 'points');
      return;
    }
    const q = (input?.value || '').trim();
    if (!q) return;
    if (!dealChatSources.docs && !dealChatSources.web && !dealChatSources.memoire) {
      alert('Cochez au moins une source (Documents, Web ou Mémoire).');
      return;
    }
    input.value = '';
    logDealQuery(q, 'question');
    const thinking = appendDealChatEntry(q, '<span style="color:var(--text-faint);">Réponse en cours…</span>');
    try {
      if (dealChatSources.web) {
        // Recherche web (SSE, meme moteur que l'assistant du dossier) --
        // toujours MARQUEE comme externe : une donnee web ne se presente
        // jamais au meme niveau qu'une citation du document.
        let acc = '', sources = [], streamErr = null;
        await streamSSE('/api/web-search', { question: q, dossierId: currentDoc.id }, evt => {
          if (evt.type === 'delta') { acc += evt.text; thinking.innerHTML = '<div class="web-external-tag">SOURCE EXTERNE — WEB · FIABILITÉ À VÉRIFIER</div>' + formatAssistantText(acc); }
          else if (evt.type === 'done') { sources = evt.sources || []; }
          else if (evt.type === 'error') { streamErr = evt.error; }
        }).catch(err => { streamErr = err.message || String(err); });
        if (streamErr) throw new Error(streamErr);
        if (!acc) { thinking.innerHTML = '<span style="color:var(--text-faint);">Aucune réponse trouvée via la recherche web.</span>'; return; }
        const shown = sources.slice(0, 5);
        thinking.innerHTML = '<div class="web-external-tag">SOURCE EXTERNE — WEB · FIABILITÉ À VÉRIFIER</div>' + formatAssistantText(acc) +
          (shown.length ? `<div class="assistant-web-sources">${shown.map(s => `<a class="assistant-web-source" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">🌐 ${escapeHtml(s.title || s.url)} →</a>`).join('')}</div>` : '');
        return;
      }
      const fd = new FormData();
      fd.append('question', q);
      fd.append('dossierId', currentDoc.id);
      fd.append('useDoc', String(dealChatSources.docs));
      fd.append('useKb', String(dealChatSources.memoire));
      const res = await fetch('/api/assistant/ask', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erreur lors de la réponse.');
      const paras = (d.paragraphs || []).map(p => {
        const src = p.sourceType === 'dossier' && p.page > 0
          ? ` <button class="cite-link" data-cite-page="${p.page}" data-cite-quote="${escapeHtml(p.quote || '')}">p. ${p.page} →</button>` : '';
        return `<p style="margin:0 0 8px;">${escapeHtml(p.text)}${src}</p>`;
      }).join('');
      thinking.innerHTML = paras || '<span style="color:var(--text-faint);">Aucune réponse.</span>';
      if (d.caveat) thinking.insertAdjacentHTML('beforeend', `<p class="assistant-caveat">${escapeHtml(d.caveat)}</p>`);
      thinking.querySelectorAll('[data-cite-page]').forEach(btn => btn.addEventListener('click', () => openSourceModal(Number(btn.dataset.citePage), btn.dataset.citeQuote)));
    } catch (err) {
      thinking.innerHTML = `<span style="color:var(--amber);">${escapeHtml(err.message)}</span>`;
    }
  }

  // Photos du bien affichees sur le Sommaire : reutilise les documents
  // annexes deposes categorie "Photos & visuels" (Documents/Importer), pas
  // de nouvelle upload dediee -- une seule source de verite pour les photos
  // du dossier. Recuperation async separee (comme la Presentation) pour ne
  // pas retarder le reste du Sommaire ; masque entierement la section si
  // aucune photo n'a ete deposee.
  // ---------- décision (stade, rejet avec motif, précédents) ----------
  async function applyStageChange(stage, motif) {
    const res = await fetch(`/api/documents/${currentDoc.id}/stage`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(motif ? { stage, motif } : { stage }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Échec du changement de stade.'); return false; }
    // Repart des donnees reellement en base (motif/date/auteur ecrits par le
    // serveur), jamais d'un etat local optimiste.
    await refreshCurrentDoc();
    return true;
  }
  function openRejectModal() {
    document.getElementById('rejectMotifInput').value = '';
    document.getElementById('rejectModal').classList.add('open');
    document.getElementById('rejectMotifInput').focus();
  }
  function closeRejectModal() { document.getElementById('rejectModal').classList.remove('open'); }
  document.getElementById('rejectModalClose').addEventListener('click', closeRejectModal);
  document.getElementById('rejectCancelBtn').addEventListener('click', closeRejectModal);
  document.getElementById('rejectModalBackdrop').addEventListener('click', closeRejectModal);
  document.getElementById('rejectConfirmBtn').addEventListener('click', async () => {
    const motif = document.getElementById('rejectMotifInput').value.trim();
    if (!motif) { alert('Un motif est obligatoire pour rejeter un dossier.'); return; }
    if (await applyStageChange('rejete', motif)) closeRejectModal();
  });

  // Bloc 4 de la pre-analyse : precedents remontes de la memoire du fonds.
  // Similarite DETERMINISTE et affichee telle quelle (meme type d'actif, ou
  // meme ville citee) -- des comparables issus des propres dossiers du
  // fonds, jamais "du marche", et jamais un score de similarite opaque.
  async function loadDealPrecedents(doc) {
    const el = document.getElementById('dealPrecedents');
    if (!el) return;
    try {
      const all = await fetchDocuments();
      const fi = doc.ficheIdentite || {};
      const myType = (fi.typeActif?.value || '').toLowerCase();
      const myVille = (fi.codePostalVille?.value || '').toLowerCase();
      const matches = all.filter(d => {
        if (d.id === doc.id) return false;
        const t = (d.ficheIdentite?.typeActif?.value || '').toLowerCase();
        const v = (d.ficheIdentite?.codePostalVille?.value || '').toLowerCase();
        return (myType && t && (t.includes(myType) || myType.includes(t))) || (myVille && v && v === myVille);
      });
      if (matches.length === 0) {
        el.innerHTML = '<div class="flag"><span class="dot faint"></span><div><div class="flag-body">Aucun dossier comparable (même typologie ou même ville) dans la mémoire du fonds pour l\'instant.</div></div></div>';
        return;
      }
      el.innerHTML = matches.slice(0, 4).map(d => {
        const name = d.ficheIdentite?.adresse?.value || d.filename;
        const prix = d.ficheIdentite?.prixDemande?.value || '—';
        const cap = d.indicateurs?.capRateRecalcule != null ? fmt2(d.indicateurs.capRateRecalcule) + ' %' : '—';
        const decision = d.stage === 'rejete' && d.decisionMotif
          ? `Refusé${d.decidedAt ? ' le ' + new Date(d.decidedAt).toLocaleDateString('fr-FR') : ''} — ${escapeHtml(d.decisionMotif)}`
          : STAGE_LABELS[d.stage] || 'Triage';
        return `<div class="flag" data-precedent-id="${d.id}" style="cursor:pointer;">
          <span class="dot ${d.stage === 'rejete' ? 'pink' : 'trace'}"></span>
          <div><div class="flag-title">${escapeHtml(name)}</div>
          <div class="flag-body">${escapeHtml(prix)} · capi recalculée ${cap} · ${decision}</div></div>
        </div>`;
      }).join('');
      el.querySelectorAll('[data-precedent-id]').forEach(row => row.addEventListener('click', () => openDossier(row.dataset.precedentId)));
    } catch {
      el.innerHTML = '<div class="flag"><span class="dot faint"></span><div><div class="flag-body">Mémoire indisponible.</div></div></div>';
    }
  }

  async function loadDealPhotos(doc) {
    const gallery = document.getElementById('dealPhotosGallery');
    if (!gallery) return;
    let supporting = [];
    try { supporting = await fetch(`/api/documents/${doc.id}/supporting`).then(r => r.json()); } catch { /* pas bloquant */ }
    if (!currentDoc || currentDoc.id !== doc.id) return; // dossier change entre-temps
    const photos = (Array.isArray(supporting) ? supporting : []).filter(s => s.category === 'photos' && s.isImage);
    if (photos.length === 0) { gallery.style.display = 'none'; gallery.innerHTML = ''; return; }
    const photoUrl = s => `/api/documents/${doc.id}/supporting/${s.id}/file`;
    gallery.innerHTML = `
      <div class="panel-head" style="padding:0 0 10px;"><span class="label">PHOTOS DU BIEN</span></div>
      <div class="deal-photos-strip">${photos.map(s => `<img class="deal-photo-thumb" src="${photoUrl(s)}" alt="${escapeHtml(s.type)}" data-full="${photoUrl(s)}">`).join('')}</div>`;
    gallery.style.display = '';
    gallery.querySelectorAll('.deal-photo-thumb').forEach(img => img.addEventListener('click', () => openPhotoModal(img.dataset.full, img.alt)));
  }
  function openPhotoModal(url, alt) {
    const img = document.getElementById('photoModalImg');
    img.src = url;
    img.alt = alt || '';
    document.getElementById('photoModal').classList.add('open');
    document.getElementById('photoModal').setAttribute('aria-hidden', 'false');
  }
  function closePhotoModal() {
    document.getElementById('photoModal').classList.remove('open');
    document.getElementById('photoModal').setAttribute('aria-hidden', 'true');
    document.getElementById('photoModalImg').src = '';
  }
  document.getElementById('photoModalClose').addEventListener('click', closePhotoModal);
  document.getElementById('photoModalBackdrop').addEventListener('click', closePhotoModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePhotoModal(); });

  // Effet "generation en direct" (meme mecanisme que la Vérification et les
  // reponses de l'Assistant, revealHtmlInto) : les paragraphes sont deja
  // rendus (texte present dans le DOM), on vide puis reecrit chacun
  // caractere par caractere, l'un apres l'autre. Une seule fois par dossier
  // et par session (voir revealedOnce) : le texte reste affiche tel quel
  // (renderDeal l'a deja rempli integralement) au-dela de la premiere vue.
  async function playDealRecapReveal() {
    const body = document.getElementById('dealRecapBody');
    if (!body) return;
    const key = `deal-recap-${currentDoc?.id}`;
    const paragraphs = [...body.querySelectorAll('p')];
    if (revealedOnce.has(key)) {
      // Deja vu cette session -- force le texte final immediatement (au
      // cas ou une revisite tres rapprochee retomberait ici pendant que la
      // toute premiere animation tourne encore) plutot que de laisser
      // l'etat courant, potentiellement partiel, tel quel.
      (currentDoc?.dealRecap || []).forEach((text, i) => { if (paragraphs[i]) paragraphs[i].textContent = text; });
      return;
    }
    revealedOnce.add(key);
    const originals = paragraphs.map(p => p.textContent);
    paragraphs.forEach(p => { p.textContent = ''; });
    for (let i = 0; i < paragraphs.length; i++) {
      if (!originals[i].trim()) continue;
      await revealHtmlInto(paragraphs[i], escapeHtml(originals[i]), { charsPerTick: 3 });
    }
  }

  // ================= EXTRAIRE ================= //
  const FICHE_LABELS = {
    adresse: 'Adresse', codePostalVille: 'Code postal / Ville', sousMarche: 'Sous-marché / Quartier',
    typeActif: "Type d'actif", anneeConstruction: 'Année de construction', anneeRenovation: 'Année de rénovation',
    surfacePonderee: 'Surface pondérée', surfaceUtile: 'Surface utile (SU)', surfaceLocativeGLA: 'Surface locative',
    nombreNiveaux: 'Nombre de niveaux', placesParking: 'Nombre de parkings', classeDPE: 'DPE (classe énergie)',
    nombreLots: 'Nombre de lots', tauxOccupation: 'Taux d\'occupation annoncé (vendeur)', prixDemande: 'Prix de vente demandé (HD/AEM non précisé)',
    rendementAffiche: 'Rendement affiché (hors droits/AEM non précisé)', taxeFonciere: 'Taxe foncière annuelle', chargesCoproPropriete: 'Charges de copropriété annuelles',
    regimeTVA: 'Régime TVA du bien', courtierVendeur: 'Broker / Vendeur',
    montantDette: 'Montant de la dette (structure proposée)', fondsPropresProposes: 'Fonds propres (structure proposée)',
    tauxHonorairesGestion: 'Honoraires de gestion', tauxHonorairesAcquisition: "Commission d'acquisition",
    tauxDroitsMutation: 'Droits de mutation',
    triNetAttendu: 'TRI net attendu', multipleFondsPropresAnnonce: 'Multiple sur fonds propres (MoIC)',
    cashOnCashAnnonce: 'Cash-on-cash', loyerMarcheReference: 'Loyer de marché (mentionné dans le document)',
    raisonVente: 'Raison de la vente', typeProcedure: 'Type de procédure de vente',
    calendrierVente: 'Calendrier de la vente (dates clés)', dureeDetention: 'Durée de détention par le vendeur',
  };
  // tauxOccupation : distinct du TOP calcule dans Indicateurs cles (base
  // surfaces, verifiable) -- sa base de calcul (physique ou financiere)
  // n'est pas garantie par le document, jamais a confondre avec le TOP.
  const FICHE_VENDOR_STATED = ['triNetAttendu', 'multipleFondsPropresAnnonce', 'cashOnCashAnnonce', 'loyerMarcheReference', 'tauxOccupation'];
  // Libelle AFFICHE pour chaque categorie du Compte de resultat -- jamais
  // la valeur STOCKEE (r.lineItem), qui reste celle du schema d'extraction
  // (server/services/extraction.js#T12_LINE_ITEMS) pour ne jamais casser
  // les dossiers deja extraits ni les lookups exacts (indicators.js,
  // consistency.js). Inclut aussi les DEUX anciennes categories fusionnees
  // (Honoraires de gestion / Entretien et reparations, scindees depuis)
  // pour que les dossiers extraits avant la scission restent lisibles.
  const T12_LABEL_MAP = {
    'Revenus locatifs de base': 'Loyers de base',
    'Refacturations de charges': 'Charges refacturées',
    'Autres revenus': 'Autres produits',
    'Vacance et pertes de créances': 'Vacance et impayés',
    'Taxes foncières': 'Taxe foncière et TEOM',
    'Assurance': 'Assurances (PNO / MRI)',
    'Charges communes / fluides': 'Charges non récupérables (copropriété et fluides)',
    'Charges non récupérables sur locaux vacants': 'Charges non récupérables sur locaux vacants',
    'Honoraires de property management': 'Honoraires de property management',
    "Honoraires d'asset management": "Honoraires d'asset management",
    'Entretien courant': 'Entretien courant',
    'GER (gros entretien et renouvellement)': 'GER (gros entretien et renouvellement)',
    // Anciennes categories (dossiers extraits avant la scission) :
    'Honoraires de gestion': 'Honoraires de gestion (non scindé)',
    'Entretien et réparations': 'Entretien et réparations (non scindé)',
  };
  function t12Label(lineItem) { return T12_LABEL_MAP[lineItem] || lineItem; }
  // Champs affiches sous un intertitre "Contexte de la vente" a part dans la
  // fiche d'identite -- doivent rester contigus et en dernier dans
  // FICHE_LABELS pour que l'intertitre s'insere correctement au rendu.
  const FICHE_CONTEXTE_VENTE = ['raisonVente', 'typeProcedure', 'calendrierVente', 'dureeDetention'];
  // Champs numeriques de la fiche d'identite : extraits en texte "propre"
  // (cf. SYSTEM_A dans extraction.js -- point decimal, sans separateur ni
  // symbole) pour rester dans un schema sans champ nullable. L'affichage
  // (separateur de milliers + unite) est donc entierement reconstruit ici,
  // jamais fourni par le modele -- purement une mise en forme, aucune
  // nouvelle donnee. Les champs absents de cette table (adresse, typeActif,
  // classeDPE, dates, texte libre...) restent affiches tels quels.
  const FICHE_FIELD_UNIT = {
    surfacePonderee: 'm2', surfaceUtile: 'm2', surfaceLocativeGLA: 'm2',
    montantDette: 'eur', fondsPropresProposes: 'eur', prixDemande: 'eur', taxeFonciere: 'eur', chargesCoproPropriete: 'eur',
    tauxHonorairesGestion: 'pct', tauxHonorairesAcquisition: 'pct', tauxDroitsMutation: 'pct',
    tauxOccupation: 'pct', rendementAffiche: 'pct', triNetAttendu: 'pct', cashOnCashAnnonce: 'pct',
    nombreNiveaux: 'count', placesParking: 'count', nombreLots: 'count',
    anneeConstruction: 'year', anneeRenovation: 'year',
    multipleFondsPropresAnnonce: 'multiple',
    loyerMarcheReference: 'eur_m2_an',
  };
  function formatFicheValue(key, raw) {
    if (raw == null || raw === '') return raw;
    const unit = FICHE_FIELD_UNIT[key];
    // Champ texte (pas d'unite) : la valeur reste EXACTEMENT celle citee du
    // document (jamais alteree pour la verification de citation), mais un
    // slash ou tiret orphelin en fin de ligne -- artefact frequent d'un
    // champ tronque a l'impression du document source ("Locaux d'activité /")
    // -- n'apporte aucune information et se retire a l'AFFICHAGE seulement.
    if (!unit) return String(raw).replace(/\s*[/,-]\s*$/, '').trim();
    // Retire d'abord les separateurs de milliers a la francaise (espace,
    // espace insecable, espace fine) : parseFloat("42 000 000") s'arrete a la
    // premiere espace et affichait "42 €" pour un prix cite "42 000 000 €" --
    // une trahison de la valeur citee, pire qu'un affichage brut.
    const n = parseFloat(String(raw).replace(/[\s  ]/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return raw;
    switch (unit) {
      case 'eur': return fmt(Math.round(n)) + ' €';
      case 'pct': return fmt2(n) + ' %';
      case 'm2': return fmt(n) + ' m²';
      case 'count': return fmt(n);
      case 'year': return String(Math.round(n));
      case 'multiple': return fmt2(n) + 'x';
      case 'eur_m2_an': return fmt2(n) + ' €/m²/an';
      default: return raw;
    }
  }
  // Onglet "Contexte" -- paragraphes narratifs generes a la demande (cf.
  // extractContexteNarratif cote serveur), distinct des champs courts
  // ci-dessus : duplique ici comme SUPPORTING_CATALOG, faute de module partage.
  const CONTEXTE_THEMES = ['motifVente', 'processusVente', 'historiqueDetention', 'profilAcquereur'];
  const CONTEXTE_THEME_LABELS = {
    motifVente: 'Motif et contexte de la cession',
    processusVente: 'Processus et calendrier de vente',
    historiqueDetention: "Historique de détention et positionnement de l'actif",
    profilAcquereur: "Profil d'acquéreur recherché",
  };

  let currentIdFields = [], currentEtatLocatif = [], currentT12 = [], currentMix = [], currentMetricRows = [];

  function aiPlaceholder() { return `<div class="ai-comment-placeholder"><p>Cliquez sur un élément pour visualiser les commentaires de l'IA.</p></div>`; }
  function setAiComment(html) { aiCarousel = null; document.getElementById('aiCommentBody').innerHTML = html; }
  function aiSourceLinkHTML(data) {
    if (data.page != null) return `<button type="button" class="ai-source-link" data-open-page="${data.page}" data-open-quote="${(data.quote || '').replace(/"/g, '&quot;')}">Voir dans le document →</button>`;
    if (data.sourceLabel) return `<div class="ai-source-label">${data.sourceLabel}</div>`;
    return '';
  }
  function aiCardHTML(data) {
    const color = niveauColor(data.niveau);
    // La CITATION EXACTE d'abord (c'est elle qui fait la valeur du
    // commentaire), puis l'eventuel texte d'analyse, puis le lien source.
    const quoteHTML = data.quote
      ? `<blockquote class="ai-comment-quote">« ${escapeHtml(data.quote)} »<span class="ai-quote-page"> — p.${data.page}</span></blockquote>`
      : '';
    return `<div class="ai-comment-card">
      <div class="ai-comment-dot" style="background:${color};"></div>
      <div class="ai-comment-title">${data.title}</div>
      ${quoteHTML}
      ${data.texte ? `<div class="ai-comment-text">${data.texte}</div>` : ''}
      ${data.formule ? `<div class="ai-comment-formula">${data.formule}</div>` : ''}
      ${aiSourceLinkHTML(data)}
    </div>`;
  }
  function aiGhostHTML(data, dir) {
    const color = niveauColor(data.niveau);
    return `<button type="button" class="ai-comment-ghost" data-ghost-nav="${dir}">
      <div><span class="ai-ghost-dot" style="background:${color};"></span><span class="ai-ghost-title">${data.title}</span></div>
      <div class="ai-ghost-text">${data.texte}</div>
    </button>`;
  }
  let aiCarousel = null;
  function renderAiCarousel() {
    const { items, index, dataFn } = aiCarousel;
    const prev = index > 0 ? dataFn(items[index - 1]) : null;
    const next = index < items.length - 1 ? dataFn(items[index + 1]) : null;
    const body = document.getElementById('aiCommentBody');
    body.innerHTML = `<div class="ai-carousel">${prev ? aiGhostHTML(prev, 'prev') : ''}${aiCardHTML(dataFn(items[index]))}${next ? aiGhostHTML(next, 'next') : ''}</div>`;
    body.querySelectorAll('[data-ghost-nav]').forEach(btn => btn.addEventListener('click', () => aiCarousel.selectFn(index + (btn.dataset.ghostNav === 'prev' ? -1 : 1))));
    body.querySelectorAll('[data-open-page]').forEach(btn => btn.addEventListener('click', () => openSourceModal(btn.dataset.openPage, btn.dataset.openQuote)));
  }
  function setAiCarousel(items, index, dataFn, selectFn) { aiCarousel = { items, index, dataFn, selectFn }; renderAiCarousel(); }

  function identiteCommentData(f) {
    const has = f.field && f.field.value != null;
    // Champ present : la citation exacte EST le commentaire (affichee par
    // aiCardHTML), pas de phrase generique par-dessus.
    return { title: f.label, niveau: 'trace',
      texte: has ? '' : "Donnée absente du document ou dont la citation n'a pas pu être vérifiée : non affichée comme un fait établi.",
      page: has ? f.field.page : null, quote: has ? f.field.quote : null, sourceLabel: has ? null : 'Non vérifié' };
  }
  function t12CommentData(row) {
    const egi = currentDoc?.indicateurs?.revenuBrutEffectif;
    const v = row.montant?.value;
    let texte = "Poste extrait du compte d'exploitation — 12 mois glissants.";
    if (v != null && egi) {
      const part = Math.abs(v) / egi;
      texte = `Ce ${v < 0 ? 'poste de charges' : 'poste de revenu'} représente ${fmtPct1(part)} du revenu brut effectif recalculé (${fmt(egi)} €).`;
    }
    return { title: t12Label(row.lineItem), niveau: 'trace', texte, page: row.montant?.page ?? null, quote: row.montant?.quote ?? null, sourceLabel: row.montant?.page == null ? 'Non vérifié' : null };
  }
  function mixCommentData(m) {
    const totalSf = currentMix.reduce((a, x) => a + (x.surfaceTotale || 0), 0);
    const share = totalSf ? m.surfaceTotale / totalSf : 0;
    const avg = currentDoc?.indicateurs?.loyerMoyenM2;
    let cmp = '';
    if (m.loyerMoyenM2 != null && avg) {
      const diff = (m.loyerMoyenM2 - avg) / avg;
      cmp = Math.abs(diff) < 0.02 ? `, aligné avec le loyer moyen pondéré du bien (${fmt2(avg)} €/m²)`
        : diff > 0 ? `, ${fmtPct1(diff)} au-dessus du loyer moyen pondéré du bien (${fmt2(avg)} €/m²)`
        : `, ${fmtPct1(Math.abs(diff))} en-dessous du loyer moyen pondéré du bien (${fmt2(avg)} €/m²)`;
    }
    return { title: m.tranche, niveau: 'trace',
      texte: `${m.lots} lot(s) pour ${fmt(m.surfaceTotale)} m², soit ${fmtPct1(share)} de la surface totale calculée${cmp}.`,
      sourceLabel: 'Calculé à partir des lignes vérifiées de l\'état locatif' };
  }
  function metricCommentData(m) {
    const interp = m.id ? interpret(m.id, m.raw, fmtPct1) : null;
    return { title: m.label, niveau: interp ? interp.niveau : 'trace',
      texte: interp ? interp.texte : 'Indicateur calculé côté serveur à partir des champs vérifiés.',
      sourceLabel: 'Calculé côté serveur' };
  }

  function fieldValHTML(f, key) {
    const has = f && f.value != null;
    let src;
    // Une correction manuelle reste visible ET tracable : chip CORRIGÉ,
    // citation d'origine du document au survol (jamais effacée).
    if (f?.edited) {
      const origine = f.quote ? ` — citation d'origine : « ${String(f.quote).replace(/"/g, '')} »` : '';
      src = `<span class="chip status-trace" title="Corrigé à la main par l'analyste${origine}">CORRIGÉ</span>`;
    }
    else if (has && FICHE_VENDOR_STATED.includes(key)) src = `<span class="chip conf-mid" title="Chiffre annoncé par le vendeur dans le document — non recalculé ni vérifié indépendamment par Leez">ANNONCÉ PAR LE VENDEUR · p.${f.page}</span>`;
    else src = has ? 'p.' + f.page : '—';
    return `<div class="val ${has ? '' : 'absent'}"><span data-fiche-key="${key}">${has ? formatFicheValue(key, f.value) : 'Non vérifié / absent du document'}</span></div><div class="src">${src}</div>`;
  }
  // Source citee pour CETTE ligne d'etat locatif : champ representatif
  // (loyer annuel en priorite, surface a defaut) -- un seul lien par ligne,
  // pas un par champ individuellement editable.
  function rrSourceHTML(r) {
    const sourceField = r.loyerAnnuel?.page != null ? r.loyerAnnuel : r.surfaceSf;
    if (sourceField?.page == null) return '<span class="label" style="opacity:.5;">—</span>';
    return `<button type="button" class="cite-link" data-open-page="${sourceField.page}" data-open-quote="${(sourceField.quote || '').replace(/"/g, '&quot;')}">Voir dans le document →</button>`;
  }

  // ================= TOASTS (taches d'arriere-plan) =================
  // Notifications persistantes en bas a droite (#toastStack) : permet de
  // lancer une tache longue (ex: AI Insight) puis de naviguer ailleurs sans
  // attendre -- un clic sur la notification "terminee" ramene directement
  // au resultat. Un `id` stable met a jour la MEME notification (spinner ->
  // terminee) plutot que d'en empiler une seconde.
  // `onStop` (optionnel) : appele en plus du retrait visuel si le ✕ est
  // clique PENDANT que status='loading' -- fermer une notification "en
  // cours" doit aussi arreter la recherche sous-jacente, jamais laisser une
  // requete continuer invisiblement en arriere-plan.
  function showToast(id, { text, status = 'loading', onClick, onStop }) {
    const stack = document.getElementById('toastStack');
    let el = stack.querySelector(`[data-toast-id="${CSS.escape(id)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.dataset.toastId = id;
      stack.appendChild(el);
    }
    el.classList.toggle('clickable', status === 'done' && !!onClick);
    const iconHTML = status === 'loading' ? '<span class="toast-spinner"></span>' : '';
    el.innerHTML = `${iconHTML}<div class="toast-text">${text}</div><button type="button" class="toast-close" aria-label="Fermer">✕</button>`;
    el.querySelector('.toast-close').addEventListener('click', e => {
      e.stopPropagation();
      if (status === 'loading' && onStop) onStop();
      el.remove();
    });
    el.onclick = (status === 'done' && onClick) ? () => { onClick(); el.remove(); } : null;
    return el;
  }
  function removeToast(id) {
    document.getElementById('toastStack')?.querySelector(`[data-toast-id="${CSS.escape(id)}"]`)?.remove();
  }

  // ================= AGENTS (orchestration multi-agents) =================
  // Plus d'écran dédié : le point d'entrée principal est le bloc
  // "Enrichissement" du Sommaire (ligne discrète, se déplie en
  // constellation pendant l'exécution ou sur "Voir le détail" -- voir plus
  // bas). Chaque agent reste aussi lançable individuellement depuis la
  // page où sa sortie atterrit (Analyse/Données/Points d'attention/
  // Vérification -- voir wireAgentLaunchInline plus bas). Un seul agent
  // réellement lancable pour l'instant (`locataires`) -- les 5 autres
  // s'affichent en "Bientôt disponible" (`availableAgentTypes` vient du
  // serveur, jamais codé en dur : un futur Lot 2 les active sans toucher à
  // ce fichier).
  const AGENT_LABELS = {
    marche: 'Marché', locataires: 'Locataires', comparables: 'Comparables',
    urbanisme: 'Urbanisme', contradiction: 'Contradiction', synthese: 'Synthèse',
  };
  const ALL_AGENT_TYPES = Object.keys(AGENT_LABELS);
  const RING_AGENT_TYPES = ALL_AGENT_TYPES.filter(t => t !== 'synthese'); // les 5 sur l'ellipse ; synthese est a part, en bas
  const TERMINAL_STATUSES = ['succeeded', 'failed', 'insufficient_data', 'cancelled'];
  const AGENT_STATUS_LABELS = {
    queued: 'En file', running: 'En cours', succeeded: 'Terminé',
    insufficient_data: 'Données insuffisantes', failed: 'Échec', cancelled: 'Annulé',
  };
  const AGENT_TIER_LABELS = { officielle: 'Source officielle', a_confirmer: 'À vérifier vous-même' };
  const AGENT_ASPECT_LABELS = {
    solidite_financiere: 'Solidité financière', actualite: 'Actualité',
    reputation: 'Réputation', forme_juridique: 'Forme juridique',
  };
  // Trois etats visuels, deux couleurs semantiques (--text-accent = en
  // cours, --text-success = termine) -- --text-muted sert de socle neutre
  // pour tout le reste (en attente, bientot disponible, ET les etats
  // "pas un succes net" comme echec/donnees-insuffisantes/annule, qui se
  // distinguent par leur LIBELLE texte sous le noeud, pas par une couleur
  // supplementaire sur l'anneau).
  const AGENT_STATE_BUCKET = {
    soon: 'muted', idle: 'muted', queued: 'muted',
    running: 'accent', succeeded: 'success',
    insufficient_data: 'muted', failed: 'muted', cancelled: 'muted',
  };
  const BUCKET_COLOR = { muted: 'var(--text-muted)', accent: 'var(--text-accent)', success: 'var(--text-success)' };
  // Icones ligne minimalistes (viewBox 24x24, stroke=currentColor via
  // .agents-node-icon) -- une forme reconnaissable par agent, pas de jeu
  // d'icones externe.
  const AGENT_ICONS = {
    marche: '<path d="M4 17l5-5 3 3 7-8"/><path d="M15 6h5v5"/>',
    locataires: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.5c0-4 3-6.5 6.5-6.5s6.5 2.5 6.5 6.5"/>',
    comparables: '<rect x="4" y="12" width="3.6" height="8"/><rect x="10.2" y="7" width="3.6" height="13"/><rect x="16.4" y="3" width="3.6" height="17"/>',
    urbanisme: '<path d="M12 3c-3.3 0-6 2.7-6 6 0 4.5 6 12 6 12s6-7.5 6-12c0-3.3-2.7-6-6-6z"/><circle cx="12" cy="9" r="2.1"/>',
    contradiction: '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/><path d="M9 12.2l2.1 2.1L15.3 9.8"/>',
    synthese: '<path d="M12 3.5l7.5 3.8-7.5 3.8-7.5-3.8z"/><path d="M4.5 12l7.5 3.8 7.5-3.8"/><path d="M4.5 16.3l7.5 3.8 7.5-3.8"/>',
  };
  // agentsPollTimer/availableAgentTypes : declares plus haut dans le
  // fichier (voir le commentaire pres de currentViewName) -- pas ici, pour
  // eviter la zone morte temporelle au premier appel de showView().
  let selectedAgentType = 'locataires'; // agent affiche dans le panneau de detail sous la constellation
  let enrichmentExpanded = false;
  let enrichmentDossierId = null;
  let enrichmentCollapseTimer = null;

  // ---------- geometrie (calculee, jamais positionnee a la main) ----------
  // Centre + rayon horizontal/rayon vertical + un angle par agent reparti
  // sur 360° : ajouter un 7e agent un jour ne demande de changer QUE
  // RING_AGENT_TYPES, la disposition entiere se recalcule seule.
  const HUB = { x: 280, y: 140 };
  const ELLIPSE_RX = 195, ELLIPSE_RY = 85;
  const NODE_R = 26, HUB_R = 32, RING_R = NODE_R + 6;
  const SYNTH_POS = { x: 280, y: 345 };
  const VIEWBOX = '0 0 560 430';

  function nodePosition(index, total) {
    const angle = (-90 + (360 / total) * index) * Math.PI / 180;
    return { x: HUB.x + ELLIPSE_RX * Math.cos(angle), y: HUB.y + ELLIPSE_RY * Math.sin(angle) };
  }
  // Point de controle decale PERPENDICULAIREMENT au segment hub->noeud :
  // c'est ce qui transforme une ligne droite ("lien logique") en courbe
  // ("flux"), pas juste un embellissement visuel.
  function curvedPath(x1, y1, x2, y2, curvature) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const offset = curvature * len;
    const cx = mx + nx * offset, cy = my + ny * offset;
    return `M ${x1.toFixed(1)},${y1.toFixed(1)} Q ${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  function ringCircumference(r) { return 2 * Math.PI * r; }

  function classifyNodeState(agentType, run) {
    if (!availableAgentTypes.includes(agentType)) return 'soon';
    if (!run) return 'idle';
    return run.status;
  }

  function renderAgentNodeSVG(agentType, pos, run, index) {
    const stateKey = classifyNodeState(agentType, run);
    const bucket = AGENT_STATE_BUCKET[stateKey] || 'muted';
    const color = BUCKET_COLOR[bucket];
    const isTerminal = run && TERMINAL_STATUSES.includes(run.status);
    // Progression REELLE (steps_done/steps_total du serveur), jamais
    // interpolee/simulee -- un agent lent = un anneau qui avance lentement.
    const frac = isTerminal ? 1 : (run && run.stepsTotal ? run.stepsDone / run.stepsTotal : 0);
    const circumference = ringCircumference(RING_R);
    const dashoffset = circumference * (1 - Math.max(0, Math.min(1, frac)));
    const statusLabel = stateKey === 'soon' ? 'Bientôt disponible' : (run ? (AGENT_STATUS_LABELS[run.status] || run.status) : 'Pas encore lancé');
    const subColor = run && run.status === 'failed' ? 'var(--pink)' : run && run.status === 'insufficient_data' ? 'var(--text-warning)' : 'var(--text-faint)';
    const iconOffset = NODE_R - 14; // centre une icone 24x24 mise a l'echelle .85 dans le cercle
    return `<g class="agents-node" data-agent-type="${agentType}" data-index="${index}" tabindex="0" role="button" aria-label="${escapeHtml(AGENT_LABELS[agentType])}">
      <circle cx="${pos.x}" cy="${pos.y}" r="${NODE_R}" class="agents-node-fill" style="fill:var(--bg-soft);stroke:${color};" />
      <g class="agents-node-icon" style="stroke:${color};opacity:${bucket === 'muted' ? '.55' : '1'};" transform="translate(${(pos.x - iconOffset).toFixed(1)},${(pos.y - iconOffset).toFixed(1)}) scale(.85)">${AGENT_ICONS[agentType]}</g>
      <circle cx="${pos.x}" cy="${pos.y}" r="${RING_R}" class="agents-node-ring-track" />
      <circle cx="${pos.x}" cy="${pos.y}" r="${RING_R}" class="agents-node-ring" style="stroke:${color};stroke-dasharray:${circumference.toFixed(1)};stroke-dashoffset:${dashoffset.toFixed(1)};" transform="rotate(-90 ${pos.x} ${pos.y})" />
      <text x="${pos.x}" y="${(pos.y + NODE_R + 16).toFixed(1)}" class="agents-node-label">${escapeHtml(AGENT_LABELS[agentType])}</text>
      <text x="${pos.x}" y="${(pos.y + NODE_R + 30).toFixed(1)}" class="agents-node-substatus" style="fill:${subColor};">${escapeHtml(statusLabel)}</text>
    </g>`;
  }
  function renderHubSVG() {
    return `<g class="agents-hub" id="agentsHubBtn" tabindex="0" role="button" aria-label="Lancer les agents disponibles">
      <circle cx="${HUB.x}" cy="${HUB.y}" r="${HUB_R}" class="agents-hub-fill" />
      <text x="${HUB.x}" y="${HUB.y - 5}" class="agents-hub-label">Lancer</text>
      <text x="${HUB.x}" y="${HUB.y + 12}" class="agents-hub-sub">les agents</text>
    </g>`;
  }

  function renderAgentsConstellation(state) {
    availableAgentTypes = state.availableAgentTypes || [];
    const runByType = {};
    for (const t of ALL_AGENT_TYPES) {
      const runs = state.runs.filter(r => r.agentType === t);
      runByType[t] = runs[runs.length - 1] || null; // le plus recent lance
    }

    const positions = {};
    RING_AGENT_TYPES.forEach((t, i) => { positions[t] = nodePosition(i, RING_AGENT_TYPES.length); });

    let svg = `<svg viewBox="${VIEWBOX}" class="agents-svg" role="img" aria-label="Constellation des agents">`;
    // Ellipse fantome : aucune fonction, juste une structure de composition
    // pour eviter l'effet "noeuds poses au hasard" -- seul element purement
    // decoratif conserve.
    svg += `<ellipse class="agents-ghost-ellipse" cx="${HUB.x}" cy="${HUB.y}" rx="${ELLIPSE_RX}" ry="${ELLIPSE_RY}" />`;
    RING_AGENT_TYPES.forEach((t, i) => {
      const p = positions[t];
      const run = runByType[t];
      const active = run && ['queued', 'running'].includes(run.status);
      svg += `<path class="agents-link${active ? ' active' : ''}" data-agent-type="${t}" d="${curvedPath(HUB.x, HUB.y, p.x, p.y, 0.22)}" />`;
    });
    const allDepsTerminal = RING_AGENT_TYPES.every(t => runByType[t] && !['queued', 'running'].includes(runByType[t].status));
    svg += `<path class="agents-link-dashed${allDepsTerminal ? ' ready' : ''}" d="${curvedPath(HUB.x, HUB.y, SYNTH_POS.x, SYNTH_POS.y, 0.1)}" />`;
    svg += renderHubSVG();
    RING_AGENT_TYPES.forEach((t, i) => { svg += renderAgentNodeSVG(t, positions[t], runByType[t], i); });
    svg += renderAgentNodeSVG('synthese', SYNTH_POS, runByType.synthese, RING_AGENT_TYPES.length);
    svg += `</svg>`;

    const wrap = document.getElementById('enrichmentConstellationWrap');
    if (!wrap) return;
    wrap.innerHTML = svg;
    wrap.querySelectorAll('[data-agent-type]').forEach(g => {
      const activate = () => { selectedAgentType = g.dataset.agentType; renderAgentDetail(runByType[selectedAgentType]); };
      g.addEventListener('click', activate);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    });
    const hub = document.getElementById('agentsHubBtn');
    const launchHub = () => launchFromEnrichmentBlock(availableAgentTypes.length ? availableAgentTypes : ['locataires']);
    hub.addEventListener('click', launchHub);
    hub.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launchHub(); } });

    renderAgentDetail(runByType[selectedAgentType]);
  }

  function renderAgentDetail(run) {
    const el = document.getElementById('enrichmentDetail');
    if (!el) return;
    const agentType = selectedAgentType;
    const statusKey = classifyNodeState(agentType, run);
    const statusLabel = statusKey === 'soon' ? 'Bientôt disponible' : (run ? (AGENT_STATUS_LABELS[run.status] || run.status) : 'Pas encore lancé');
    const canLaunch = statusKey !== 'soon' && (!run || TERMINAL_STATUSES.includes(run.status));
    const canCancel = run && ['queued', 'running'].includes(run.status);
    const stepHTML = run && run.currentStepLabel
      ? `<div class="agent-node-step">${escapeHtml(run.currentStepLabel)} (${run.stepsDone}/${run.stepsTotal})</div>` : '';
    const errorHTML = run && run.status === 'failed' && run.errorMessage
      ? `<p class="agent-node-step" style="color:var(--pink);">${escapeHtml(run.errorMessage)}</p>` : '';
    const emptyHTML = run && run.status === 'insufficient_data' ? `<p class="agent-node-step">Aucune donnée exploitable trouvée.</p>` : '';
    const findingsHTML = run && run.findings?.length ? run.findings.map(renderAgentFindingHTML).join('') : '';
    el.innerHTML = `<div class="agent-detail-panel">
      <div class="agent-node-head">
        <span class="agent-node-name">${AGENT_LABELS[agentType]}</span>
        <span class="agent-node-status st-${statusKey}">${escapeHtml(statusLabel)}</span>
      </div>
      ${stepHTML}${errorHTML}${emptyHTML}
      <div class="agent-node-actions">
        ${canLaunch ? `<button class="btn btn-outline" id="agentDetailLaunchBtn">Lancer</button>` : ''}
        ${canCancel ? `<button class="btn btn-outline" id="agentDetailCancelBtn">Annuler</button>` : ''}
      </div>
      ${findingsHTML}
    </div>`;
    document.getElementById('agentDetailLaunchBtn')?.addEventListener('click', () => launchFromEnrichmentBlock([agentType]));
    document.getElementById('agentDetailCancelBtn')?.addEventListener('click', () => cancelAgentRunUI(run.id));
  }

  function renderAgentFindingHTML(f) {
    const tierLabel = AGENT_TIER_LABELS[f.sourceTier] || f.sourceTier;
    const dateLabel = f.sourceDate ? new Date(f.sourceDate).toLocaleDateString('fr-FR') : 'date inconnue';
    const note = f.payload?.note || JSON.stringify(f.payload);
    const who = f.payload?.tenantName ? `<b>${escapeHtml(f.payload.tenantName)}</b> — ` : '';
    const aspectLabel = AGENT_ASPECT_LABELS[f.payload?.aspect] || f.payload?.aspect || f.kind;
    return `<div class="agent-finding">
      <div class="agent-finding-head">
        <span>${who}${escapeHtml(aspectLabel)}</span>
        <span class="agent-tier ${escapeHtml(f.sourceTier)}">${escapeHtml(tierLabel)}</span>
      </div>
      <p>${escapeHtml(note)}</p>
      <a href="${escapeHtml(f.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.sourceLabel || f.sourceUrl)} — ${dateLabel} →</a>
    </div>`;
  }

  // ---------- transport bas niveau, partage par le bloc Enrichissement,
  // le detail de la constellation, et les points de lancement individuels ----------
  async function requestAgentRun(dossierId, agentTypes, tenantNames) {
    const res = await fetch(`/api/dossiers/${dossierId}/agents/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: agentTypes, ...(tenantNames ? { tenantNames } : {}) }),
    });
    return res.json();
  }
  async function cancelAgentRunUI(runId) {
    await fetch(`/api/agent-runs/${runId}/cancel`, { method: 'POST' });
    if (currentDoc) await loadEnrichmentBlock(currentDoc.id);
  }
  async function fetchAgentsState(dossierId) {
    const r = await fetch(`/api/dossiers/${dossierId}/agents/state`);
    return r.json();
  }

  // ---------- bloc "Enrichissement" (Sommaire) ----------
  // Ligne repliee par defaut (etat le plus important du lot : c'est ce que
  // l'analyste voit en ouvrant un dossier). Se deplie automatiquement au
  // lancement et tant qu'un run est actif ; se replie automatiquement 3s
  // apres que tous les agents sont dans un etat terminal. "Voir le detail"
  // deplie manuellement sur un dossier deja termine, sans re-armer ce
  // minuteur (l'analyste doit pouvoir lire tranquillement).
  function timeAgoFr(dateStr) {
    const diffMin = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (diffMin < 1) return "à l'instant";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `il y a ${diffH} h`;
    return `il y a ${Math.floor(diffH / 24)} j`;
  }

  function renderEnrichmentBlock(state) {
    const el = document.getElementById('enrichmentBlock');
    if (!el) return;
    const runs = state.runs || [];
    availableAgentTypes = state.availableAgentTypes || [];
    const anyActive = runs.some(r => ['queued', 'running'].includes(r.status));

    if (enrichmentExpanded || anyActive) {
      el.innerHTML = `
        <div class="enrichment-row">
          <span class="enrichment-label">Enrichissement</span>
          <button type="button" class="enrichment-collapse-btn" id="enrichmentCollapseBtn">Replier ▴</button>
        </div>
        <div class="enrichment-expanded-body">
          <div class="agents-constellation-wrap" id="enrichmentConstellationWrap"></div>
          <div id="enrichmentDetail"></div>
        </div>`;
      document.getElementById('enrichmentCollapseBtn').addEventListener('click', () => {
        clearTimeout(enrichmentCollapseTimer);
        enrichmentExpanded = false;
        renderEnrichmentBlock(state);
      });
      renderAgentsConstellation(state);
      if (anyActive) startAgentsPolling(); else stopAgentsPolling();
      return;
    }

    stopAgentsPolling();
    const byType = {};
    for (const t of ALL_AGENT_TYPES) {
      const rs = runs.filter(r => r.agentType === t);
      byType[t] = rs[rs.length - 1] || null;
    }
    const launchedRuns = ALL_AGENT_TYPES.map(t => byType[t]).filter(Boolean);
    let rowHTML;
    if (launchedRuns.length === 0) {
      rowHTML = `<span class="enrichment-label">Enrichissement non lancé</span>
        <div class="enrichment-actions"><button class="btn btn-outline" id="enrichmentLaunchBtn">Lancer</button></div>`;
    } else {
      const lastRun = launchedRuns.reduce((a, b) => (new Date(a.endedAt || a.createdAt) > new Date(b.endedAt || b.createdAt) ? a : b));
      const failedCount = launchedRuns.filter(r => r.status === 'failed').length;
      const totalSources = launchedRuns.reduce((sum, r) => sum + (r.status === 'succeeded' || r.status === 'insufficient_data' ? (r.sourcesCount || 0) : 0), 0);
      const when = timeAgoFr(lastRun.endedAt || lastRun.createdAt);
      const statusText = failedCount > 0
        ? `Enrichi ${when} · <span style="color:var(--text-warning);">${failedCount} agent${failedCount > 1 ? 's' : ''} en échec</span>`
        : `Enrichi ${when} · ${totalSources} source${totalSources > 1 ? 's' : ''}`;
      rowHTML = `<span class="enrichment-label">${statusText}</span>
        <div class="enrichment-actions">
          <button class="btn btn-outline" id="enrichmentRelaunchBtn">Relancer</button>
          <button type="button" class="enrichment-collapse-btn" id="enrichmentDetailBtn">Voir le détail ▾</button>
        </div>`;
    }
    el.innerHTML = `<div class="enrichment-row">${rowHTML}</div>`;
    document.getElementById('enrichmentLaunchBtn')?.addEventListener('click', () => launchFromEnrichmentBlock(availableAgentTypes.length ? availableAgentTypes : ['locataires']));
    document.getElementById('enrichmentRelaunchBtn')?.addEventListener('click', () => launchFromEnrichmentBlock(availableAgentTypes.length ? availableAgentTypes : ['locataires']));
    document.getElementById('enrichmentDetailBtn')?.addEventListener('click', () => { enrichmentExpanded = true; renderEnrichmentBlock(state); });
  }

  // Sequence de lancement (t0 : requete envoyee -- t0+100·i ms : chaque
  // agent visé confirmé "queued" par la reponse serveur, revele avec un
  // decalage de 100ms par index pour un effet d'impulsion en cascade le
  // long de sa courbe). Le decalage est un choix d'animation assume, mais
  // il n'affiche jamais un etat qui ne soit pas deja reellement confirme
  // par le serveur -- aucune progression simulee au-dela de ce court
  // effet de reveal.
  async function launchFromEnrichmentBlock(agentTypes) {
    if (!currentDoc) return;
    clearTimeout(enrichmentCollapseTimer);
    enrichmentExpanded = true;
    renderEnrichmentBlock({ runs: [], availableAgentTypes });
    const hub = document.getElementById('agentsHubBtn');
    hub?.classList.add('pulse-once');
    const { created } = await requestAgentRun(currentDoc.id, agentTypes);
    (created || []).forEach((c, i) => {
      const idx = RING_AGENT_TYPES.indexOf(c.agentType);
      if (idx < 0) return;
      setTimeout(() => {
        document.querySelector(`.agents-link[data-agent-type="${c.agentType}"]`)?.classList.add('active');
      }, idx * 100);
    });
    await loadEnrichmentBlock(currentDoc.id);
  }

  async function loadEnrichmentBlock(dossierId) {
    enrichmentDossierId = dossierId;
    const state = await fetchAgentsState(dossierId).catch(() => null);
    if (!state || currentDoc?.id !== dossierId || currentViewName !== 'deal') return;
    const anyActive = (state.runs || []).some(r => ['queued', 'running'].includes(r.status));
    if (anyActive) enrichmentExpanded = true;
    renderEnrichmentBlock(state);
  }
  function startAgentsPolling() {
    if (agentsPollTimer) return;
    agentsPollTimer = setInterval(async () => {
      if (!enrichmentDossierId) return stopAgentsPolling();
      const state = await fetchAgentsState(enrichmentDossierId).catch(() => null);
      if (!state || currentDoc?.id !== enrichmentDossierId || currentViewName !== 'deal') return stopAgentsPolling();
      const anyActive = state.runs.some(r => ['queued', 'running'].includes(r.status));
      if (!anyActive) {
        stopAgentsPolling();
        // Vient de terminer (etait actif au tick precedent, sinon
        // startAgentsPolling n'aurait jamais ete (re)declenche) -- replie
        // automatiquement 3s apres, seulement dans ce cas precis (pas sur
        // un "Voir le detail" manuel sur un dossier deja termine).
        clearTimeout(enrichmentCollapseTimer);
        enrichmentCollapseTimer = setTimeout(() => {
          enrichmentExpanded = false;
          renderEnrichmentBlock(state);
        }, 3000);
      }
      renderEnrichmentBlock(state);
    }, 1500);
  }
  function stopAgentsPolling() {
    clearInterval(agentsPollTimer);
    agentsPollTimer = null;
  }

  // ---------- points de lancement individuels (Analyse/Données/Points
  // d'attention/Vérification) ----------
  // Chaque agent est aussi lançable depuis la page où sa sortie atterrit,
  // independamment du bloc Enrichissement -- meme requestAgentRun, meme
  // agent_runs resultant, suivi depuis le Sommaire.
  const AGENT_LAUNCH_POINTS = [
    { containerId: 'agentLaunchMarche', agentType: 'marche' },
    { containerId: 'agentLaunchComparables', agentType: 'comparables' },
    { containerId: 'agentLaunchUrbanisme', agentType: 'urbanisme' },
    { containerId: 'agentLaunchContradiction', agentType: 'contradiction' },
  ];
  async function renderAgentLaunchInline(containerId, agentType) {
    const el = document.getElementById(containerId);
    if (!el || !currentDoc) return;
    const dossierId = currentDoc.id;
    const state = await fetchAgentsState(dossierId).catch(() => null);
    if (!state || currentDoc?.id !== dossierId) return;
    const available = (state.availableAgentTypes || []).includes(agentType);
    const runs = state.runs.filter(r => r.agentType === agentType);
    const run = runs[runs.length - 1] || null;
    const running = run && ['queued', 'running'].includes(run.status);
    const label = AGENT_LABELS[agentType];
    if (!available) {
      el.innerHTML = `<span class="agent-launch-note">Agent ${label} — bientôt disponible</span>`;
      return;
    }
    const btnLabel = running ? 'En cours…' : run ? `Relancer l'agent ${label}` : `Lancer l'agent ${label}`;
    el.innerHTML = `<button type="button" class="btn btn-outline agent-launch-btn" ${running ? 'disabled' : ''}>${escapeHtml(btnLabel)}</button>`;
    el.querySelector('button').addEventListener('click', async () => {
      await requestAgentRun(dossierId, [agentType]);
      showToast(`agent-launch-${agentType}`, { status: 'done', text: `<b>Agent ${escapeHtml(label)} lancé</b>Suivez la progression dans le Sommaire.` });
      setTimeout(() => removeToast(`agent-launch-${agentType}`), 5000);
      renderAgentLaunchInline(containerId, agentType);
    });
  }
  function loadAgentLaunchPoints() {
    AGENT_LAUNCH_POINTS.forEach(p => renderAgentLaunchInline(p.containerId, p.agentType));
  }

  // ================= AI INSIGHT (locataires, État locatif) =================
  // Point d'entree "individuel" (page ou la sortie atterrit, voir spec
  // §7.1) de l'agent 'locataires' : clic sur une ligne d'etat locatif ->
  // lance un agent_run SCOPE a ce seul locataire (tenantNames:[nom]),
  // meme moteur (agents/locataires.js) que le lancement group depuis
  // l'ecran Agents. Ne tourne plus sur une connexion SSE tenue ouverte --
  // sonde /agents/state comme l'ecran Agents, ce qui survit a un
  // changement d'onglet ou un rechargement (le statut vit en base, jamais
  // dans la page, voir spec §5.3). Panneau/modale/notification inchanges,
  // seul le transport sous-jacent change.
  const tenantInsightCache = new Map(); // tenantName -> { dossierId, html }
  const tenantInsightStatus = new Map(); // tenantName -> 'loading' | 'done' | 'error'
  const tenantInsightRuns = new Map(); // tenantName -> agentRunId (recherche en cours)
  const tenantInsightPollTimers = new Map(); // tenantName -> intervalId
  const tenantInsightModal = document.getElementById('tenantInsightModal');

  function renderTenantInsightPanel(tenantName, stepLabel) {
    const body = document.getElementById('tenantInsightBody');
    if (!body) return;
    const status = tenantInsightStatus.get(tenantName);
    if (status === 'done' && tenantInsightCache.has(tenantName)) {
      body.innerHTML = `<button type="button" class="tenant-insight-ready-card" data-tenant-open="${escapeHtml(tenantName)}"><span class="tirc-text"><b>Informations trouvées</b>« ${escapeHtml(tenantName)} » — cliquez pour voir →</span></button>`;
      body.querySelector('[data-tenant-open]').addEventListener('click', () => openTenantInsightModal(tenantName));
    } else if (status === 'loading') {
      body.innerHTML = `<div class="ai-comment-placeholder"><p>« ${escapeHtml(tenantName)} » — ${escapeHtml(stepLabel || 'Recherche en cours…')}</p><button type="button" class="tenant-insight-stop-btn" data-tenant-stop="${escapeHtml(tenantName)}">Arrêter la recherche</button></div>`;
      body.querySelector('[data-tenant-stop]').addEventListener('click', () => stopTenantInsight(tenantName));
    } else if (status === 'error') {
      body.innerHTML = `<div class="ai-comment-placeholder"><p class="assistant-caveat">Échec de la recherche sur « ${escapeHtml(tenantName)} ».</p></div>`;
    } else {
      body.innerHTML = `<div class="ai-comment-placeholder"><p>Lancez l'agent en cliquant sur un élément.</p></div>`;
    }
  }

  function openTenantInsightModal(tenantName) {
    const entry = tenantInsightCache.get(tenantName);
    if (!entry) return;
    document.getElementById('tenantInsightModalName').textContent = tenantName;
    const body = document.getElementById('tenantInsightModalBody');
    body.innerHTML = entry.html;
    tenantInsightModal.classList.add('open'); tenantInsightModal.setAttribute('aria-hidden', 'false');
  }
  function closeTenantInsightModal() { tenantInsightModal.classList.remove('open'); tenantInsightModal.setAttribute('aria-hidden', 'true'); }
  document.getElementById('tenantInsightModalClose').addEventListener('click', closeTenantInsightModal);
  document.getElementById('tenantInsightModalBackdrop').addEventListener('click', closeTenantInsightModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTenantInsightModal(); });

  // Ramene sur le bon dossier + onglet État locatif puis ouvre la modale --
  // declenche par un clic sur la notification "terminee", potentiellement
  // depuis n'importe quelle autre page de l'app.
  async function goToTenantInsightResult(dossierId, tenantName) {
    if (dossierId && (!currentDoc || currentDoc.id !== dossierId)) await openDossier(dossierId);
    goDossierPage('extract');
    document.querySelector('[data-etab="rentroll"]')?.click();
    openTenantInsightModal(tenantName);
  }

  // Demande l'annulation cote serveur (POST /agent-runs/:id/cancel, voir
  // routes/agents.js) -- le prochain tick du sondage en cours verra
  // status:'cancelled' (ecrit immediatement par la route) et nettoiera
  // lui-meme le panneau, pas besoin d'etat local supplementaire ici.
  function stopTenantInsight(tenantName) {
    const runId = tenantInsightRuns.get(tenantName);
    if (runId) fetch(`/api/agent-runs/${runId}/cancel`, { method: 'POST' }).catch(() => {});
  }

  async function runTenantInsight(row) {
    const tenantName = (row?.locataire || '').trim();
    if (!tenantName) {
      document.getElementById('tenantInsightBody').innerHTML = `<div class="ai-comment-placeholder"><p>Aucun nom de locataire extrait pour cette ligne.</p></div>`;
      return;
    }
    const existingStatus = tenantInsightStatus.get(tenantName);
    if (existingStatus === 'done') { openTenantInsightModal(tenantName); renderTenantInsightPanel(tenantName); return; }
    if (existingStatus === 'loading') { renderTenantInsightPanel(tenantName); return; } // deja en cours, rien a refaire
    if (!currentDoc) return;
    const dossierId = currentDoc.id;
    tenantInsightStatus.set(tenantName, 'loading');
    renderTenantInsightPanel(tenantName);
    const toastId = `tenant-insight-${dossierId}-${tenantName}`;
    showToast(toastId, { status: 'loading', text: `<b>Agent IA</b>« ${escapeHtml(tenantName)} » — Recherche en cours…`, onStop: () => stopTenantInsight(tenantName) });

    let runId;
    try {
      const data = await requestAgentRun(dossierId, ['locataires'], [tenantName]);
      const created = (data.created || []).find(c => c.agentType === 'locataires');
      if (!created) throw new Error("Impossible de lancer l'agent locataires.");
      runId = created.id;
    } catch (e) {
      tenantInsightStatus.set(tenantName, 'error');
      showToast(toastId, { status: 'done', text: `<b>Agent IA</b>Échec du lancement pour « ${escapeHtml(tenantName)} »` });
      setTimeout(() => removeToast(toastId), 6000);
      if (currentDoc?.id === dossierId) renderTenantInsightPanel(tenantName);
      return;
    }
    tenantInsightRuns.set(tenantName, runId);

    const poll = async () => {
      let state;
      try { state = await fetchAgentsState(dossierId); } catch { return; } // reessaie au prochain tick plutot que d'abandonner sur un blip reseau
      const run = (state.runs || []).find(r => r.id === runId);
      if (!run) return;
      if (run.status === 'queued' || run.status === 'running') {
        if (currentDoc?.id === dossierId) renderTenantInsightPanel(tenantName, run.currentStepLabel);
        showToast(toastId, { status: 'loading', text: `<b>Agent IA</b>« ${escapeHtml(tenantName)} » — ${escapeHtml(run.currentStepLabel || 'Recherche en cours…')}`, onStop: () => stopTenantInsight(tenantName) });
        return; // pas terminal, on continue de sonder
      }
      clearInterval(tenantInsightPollTimers.get(tenantName));
      tenantInsightPollTimers.delete(tenantName);
      tenantInsightRuns.delete(tenantName);
      if (run.status === 'cancelled') {
        // Arret volontaire : retour a l'etat de depart (pas une erreur), la
        // recherche pourra etre relancee normalement en re-cliquant la ligne.
        tenantInsightStatus.delete(tenantName);
        removeToast(toastId);
        if (currentDoc?.id === dossierId) renderTenantInsightPanel(tenantName);
        return;
      }
      if (run.status === 'failed' || run.status === 'insufficient_data') {
        tenantInsightStatus.set(tenantName, 'error');
        const msg = run.status === 'failed'
          ? `Échec de la recherche sur « ${escapeHtml(tenantName)} »`
          : `Aucune donnée exploitable sur « ${escapeHtml(tenantName)} »`;
        showToast(toastId, { status: 'done', text: `<b>Agent IA</b>${msg}` });
        setTimeout(() => removeToast(toastId), 6000);
        if (currentDoc?.id === dossierId) renderTenantInsightPanel(tenantName);
        return;
      }
      // succeeded -- ce run est scope a CE seul locataire (tenantNames:[tenantName]
      // au lancement), donc tous ses findings lui appartiennent deja ; le
      // filtre sur payload.tenantName reste une securite si jamais un futur
      // lancement groupe (ecran Agents) reutilisait ce meme code de rendu.
      const findings = (run.findings || []).filter(f => f.payload?.tenantName === tenantName);
      const html = findings.length
        ? findings.map(renderAgentFindingHTML).join('')
        : `<p class="assistant-caveat">Aucune donnée exploitable trouvée.</p>`;
      tenantInsightCache.set(tenantName, { dossierId, html });
      tenantInsightStatus.set(tenantName, 'done');
      showToast(toastId, {
        status: 'done',
        text: `<b>Agent IA a terminé</b>« ${escapeHtml(tenantName)} » — cliquez pour voir →`,
        onClick: () => goToTenantInsightResult(dossierId, tenantName),
      });
      if (currentDoc?.id === dossierId) renderTenantInsightPanel(tenantName);
    };
    tenantInsightPollTimers.set(tenantName, setInterval(poll, 1500));
    poll(); // premier retour immediat, pas d'attente de 1.5s avant le premier statut
  }

  // ================= ASSISTANT FLOTTANT DU DOSSIER (onglet Données) =================
  // Meme moteur que l'Assistant global (AI Agent) -- Q/R sur ce dossier
  // (sourceType 'dossier'/'connaissances'/'criteres'/'general', citations
  // verifiees) + mode recherche web (sourceType = lien source cliquable,
  // pas une citation interne) -- mais dans un panneau qui glisse depuis la
  // droite et COUVRE la page plutot qu'une page dediee. Le dossier est
  // toujours currentDoc : pas de selecteur, on est deja dedans. Etat
  // (ouvert/ferme + historique) conserve tant que la page n'est pas
  // rechargee : fermer puis rouvrir retrouve la conversation.
  let dataChatMode = 'normal';
  function openDataChatPanel() {
    document.getElementById('dataChatPanel').classList.add('open');
    document.getElementById('dataChatPanel').setAttribute('aria-hidden', 'false');
    document.getElementById('dataChatInput').focus();
  }
  function closeDataChatPanel() {
    document.getElementById('dataChatPanel').classList.remove('open');
    document.getElementById('dataChatPanel').setAttribute('aria-hidden', 'true');
  }
  document.getElementById('dataChatFab').addEventListener('click', openDataChatPanel);
  document.getElementById('dataChatClose').addEventListener('click', closeDataChatPanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDataChatPanel(); });
  document.getElementById('dataChatWebToggle').addEventListener('click', () => {
    dataChatMode = dataChatMode === 'web' ? 'normal' : 'web';
    const toggle = document.getElementById('dataChatWebToggle');
    toggle.classList.toggle('active', dataChatMode === 'web');
    document.getElementById('dataChatInput').placeholder = dataChatMode === 'web'
      ? 'Ex. « Quels sont les loyers moyens du secteur ? »'
      : 'Posez une question sur ce dossier…';
  });

  function dataChatRow(role, html) {
    const log = document.getElementById('dataChatLog');
    const empty = document.getElementById('dataChatEmpty');
    if (empty) empty.style.display = 'none';
    const row = document.createElement('div');
    row.className = `assistant-chat-msg ${role}`;
    row.innerHTML = html;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }
  function dataChatTypingRow() {
    const row = dataChatRow('assistant typing', '<span class="assistant-typing-dots"><span></span><span></span><span></span></span>');
    row.id = 'dataChatTypingRow';
  }
  function clearDataChatTyping() { document.getElementById('dataChatTypingRow')?.remove(); }

  async function sendDataChatQuestion(question) {
    if (!currentDoc) return;
    dataChatRow('user', `<p>${escapeHtml(question)}</p>`);
    const input = document.getElementById('dataChatInput');
    const btn = document.getElementById('dataChatSendBtn');
    const dossierId = currentDoc.id;
    input.value = ''; input.disabled = true; btn.disabled = true;
    autoResizeTextarea(input);
    dataChatTypingRow();
    try {
      if (dataChatMode === 'web') {
        let row = null, acc = '', sources = [], streamErr = null;
        const log = document.getElementById('dataChatLog');
        await streamSSE('/api/web-search', { question, dossierId }, evt => {
          if (evt.type === 'delta') {
            if (!row) { clearDataChatTyping(); row = dataChatRow('assistant', ''); }
            acc += evt.text;
            row.innerHTML = formatAssistantText(acc);
            log.scrollTop = log.scrollHeight;
          } else if (evt.type === 'done') { sources = evt.sources || []; }
          else if (evt.type === 'error') { streamErr = evt.error; }
        }).catch(err => { streamErr = err.message || String(err); });
        clearDataChatTyping();
        if (streamErr) {
          dataChatRow('assistant', `<p class="assistant-caveat">Erreur : ${escapeHtml(streamErr)}</p>`);
        } else if (!row) {
          dataChatRow('assistant', `<p>Aucune réponse trouvée via la recherche web.</p>`);
        } else {
          const shown = sources.slice(0, 5);
          const sourcesHTML = shown.length
            ? `<div class="assistant-web-sources">${shown.map(s => `<a class="assistant-web-source" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">🌐 ${escapeHtml(s.title || s.url)} →</a>`).join('')}</div>`
            : '';
          row.innerHTML = formatAssistantText(acc) + sourcesHTML;
        }
      } else {
        const res = await fetch('/api/assistant/ask', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, dossierId }),
        });
        const data = await res.json();
        clearDataChatTyping();
        if (!res.ok) throw new Error(data.error || 'Erreur serveur');
        const html = (data.paragraphs || []).map(p => {
          const text = formatAssistantText(p.text);
          if (p.sourceType === 'dossier') return text + `<button class="cite-link assistant-cite" data-open-page="${p.page}" data-open-quote="${(p.quote || '').replace(/"/g, '&quot;')}">Voir la source — page ${p.page} →</button>`;
          if (p.sourceType === 'connaissances') return text + `<div class="assistant-kb-source">Source : ${p.sourceFile} — ${p.sourceSection}${p.page ? ' (p.' + p.page + ')' : ''}</div>`;
          if (p.sourceType === 'criteres') return text + `<div class="assistant-kb-source">Source : Réglages du fonds</div>`;
          return text;
        }).join('');
        const row = dataChatRow('assistant', '');
        await revealHtmlInto(row, html);
        row.querySelectorAll('[data-open-page]').forEach(b => b.addEventListener('click', () => openSourceModal(b.dataset.openPage, b.dataset.openQuote)));
        if (data.caveat) row.insertAdjacentHTML('beforeend', `<p class="assistant-caveat">${escapeHtml(data.caveat)}</p>`);
      }
    } catch (err) {
      clearDataChatTyping();
      dataChatRow('assistant', `<p class="assistant-caveat">Erreur : ${escapeHtml(err.message)}</p>`);
    } finally {
      input.disabled = false; btn.disabled = false; input.focus();
    }
  }
  document.getElementById('dataChatSendBtn').addEventListener('click', () => {
    const input = document.getElementById('dataChatInput');
    const v = input.value.trim();
    if (v) sendDataChatQuestion(v);
  });
  document.getElementById('dataChatInput').addEventListener('input', e => autoResizeTextarea(e.target));
  document.getElementById('dataChatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v) sendDataChatQuestion(v);
    }
  });

  // Estimation best-effort de la prochaine échéance triennale (bail 3/6/9) à
  // partir de la date de prise d'effet réellement extraite, UNIQUEMENT quand
  // aucune date de break n'a été explicitement extraite du document. Parsing
  // volontairement conservateur : retourne null (donc "—", jamais une date
  // inventée) si le format n'est pas reconnu.
  const MOIS_FR_RR = { janv: 0, jan: 0, févr: 1, fev: 1, fevr: 1, mars: 2, avr: 3, mai: 4, juin: 5, juil: 6, août: 7, aout: 7, sept: 8, oct: 9, nov: 10, déc: 11, dec: 11 };
  function parseDateFrRR(str) {
    if (!str) return null;
    const s = String(str).trim().toLowerCase().replace(/\.$/, '');
    let m = s.match(/^([a-zéû]+)\.?\s+(\d{4})$/);
    if (m) {
      const key = Object.keys(MOIS_FR_RR).find(k => m[1].startsWith(k));
      if (key != null) return new Date(parseInt(m[2], 10), MOIS_FR_RR[key], 1);
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    m = s.match(/^(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(parseInt(m[2], 10), parseInt(m[1], 10) - 1, 1);
    m = s.match(/^(\d{4})$/);
    if (m) return new Date(parseInt(m[1], 10), 0, 1);
    return null;
  }
  function estimateProchainBreak3Ans(dateDebutStr) {
    const d = parseDateFrRR(dateDebutStr);
    if (!d) return null;
    const now = new Date();
    const next = new Date(d);
    while (next <= now) next.setFullYear(next.getFullYear() + 3);
    return next.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // Synthèse (premier onglet) : la grille criteres du fonds × bien --
  // Attendu / Constaté / Verdict / Source, sans commentaire, pour voir en
  // un coup d'oeil si ca passe ou pas. Donnees de computeMandateFit (deja
  // calculees serveur), jamais recalculees ici.
  function renderSynthese(doc) {
    const el = document.getElementById('paneSynthese');
    if (!el) return;
    if (doc.status !== 'complete') {
      el.innerHTML = `<div class="deal-chat-empty">${STATUS_LABELS[doc.status] || doc.status}</div>`;
      return;
    }
    const fit = doc.audit?.mandateFit;
    const checks = (doc.consistencyChecks || []).filter(c => c.status && c.status !== 'indetermine');
    const anomalies = checks.filter(c => c.status === 'warning');

    // 1. Verdict global en une phrase -- fonde sur la NATURE des criteres
    // (eliminatoire vs negociable), jamais un score.
    let verdictHTML = '';
    if (fit && fit.configured && fit.criteria.length > 0) {
      const elim = fit.criteria.filter(c => c.status === 'echec' && c.nature === 'eliminatoire').length;
      const nego = fit.criteria.filter(c => c.status === 'echec' && c.nature === 'negociable').length;
      const inconnus = fit.criteria.filter(c => c.status === 'indetermine').length;
      let phrase, tone;
      if (elim > 0) { phrase = `${elim} critère${elim > 1 ? 's' : ''} éliminatoire${elim > 1 ? 's' : ''} non conforme${elim > 1 ? 's' : ''}`; tone = 'var(--pink)'; }
      else if (nego > 0) { phrase = `${nego} critère${nego > 1 ? 's' : ''} négociable${nego > 1 ? 's' : ''} non conforme${nego > 1 ? 's' : ''} — aucun éliminatoire`; tone = 'var(--amber)'; }
      else if (inconnus > 0) { phrase = `Aucun critère non conforme — ${inconnus} non testable${inconnus > 1 ? 's' : ''} faute de donnée`; tone = 'var(--text-muted)'; }
      else { phrase = 'Tous les critères du mandat sont conformes'; tone = 'var(--green)'; }
      verdictHTML = `<div class="synthese-verdict" style="border-color:${tone};"><span style="color:${tone};font-weight:700;">${phrase}</span>${fit.ecartPrincipal ? ` — ${escapeHtml(fit.ecartPrincipal.phrase || '')}` : ''}</div>`;
    }

    // 2. Controles de coherence -- croiser les onglets entre eux et
    // signaler quand les chiffres se contredisent.
    const TAB_OF_CHECK = { loyers_etat_locatif_vs_t12: ['rentroll', 't12'], surfaces_etat_locatif_vs_fiche: ['rentroll'], rendement_recalcule_vs_affiche: [], vacance_vs_t12: ['t12'] };
    const coherenceHTML = checks.length === 0 ? '' : `
      <div class="coherence-block ${anomalies.length ? 'has-anomalies' : ''}">
        <div class="coherence-head"><span>${anomalies.length ? '⚠ CONTRÔLES DE COHÉRENCE' : '✓ CONTRÔLES DE COHÉRENCE'}</span><span class="label">${anomalies.length ? `${anomalies.length} ANOMALIE${anomalies.length > 1 ? 'S' : ''}` : `${checks.length} CONTRÔLES PASSÉS`}</span></div>
        ${anomalies.map(c => `<div class="coherence-row">
          <div class="coherence-text">${escapeHtml(c.label)} — attendu ${fmt(Math.round(c.expected))}, constaté ${fmt(Math.round(c.actual))}${c.deltaPct != null ? ` (écart ${fmt2(c.deltaPct)} %)` : ''}</div>
          <div class="coherence-actions">${(TAB_OF_CHECK[c.check] || []).map(t => `<button class="cite-link" data-goto-tab="${t}">voir ${t === 'rentroll' ? "l'état locatif" : "le compte d'exploitation"} →</button>`).join('')}</div>
        </div>`).join('')}
      </div>`;

    // 3. Grille des criteres enrichie (Ecart + Nature).
    let gridHTML = '';
    if (!fit || !fit.configured || fit.criteria.length === 0) {
      gridHTML = `<div class="deal-chat-empty">Aucun critère configuré — définissez le mandat du fonds dans l'onglet Critères. <button class="cite-link" data-go-criteria>Ouvrir les Critères →</button></div>`;
    } else {
      const ICON = { ok: '✓', echec: '✗', indetermine: '⊘' };
      const rank = { echec: 0, indetermine: 1, ok: 2 };
      const rows = [...fit.criteria].sort((a, b) => rank[a.status] - rank[b.status]);
      gridHTML = `<table class="analysis-grid">
        <thead><tr><th>Critère</th><th>Attendu</th><th>Constaté</th><th class="num">Écart</th><th style="text-align:center;">Verdict</th><th>Nature</th><th>Source</th></tr></thead>
        <tbody>${rows.map(c => `<tr class="st-${c.status}">
          <td class="crit-label">${escapeHtml(c.label)}${c.methode ? ` <span class="crit-methode" title="${escapeHtml(c.methode)}">ⓘ</span>` : ''}</td>
          <td>${escapeHtml(c.attendu || '—')}</td>
          <td>${c.constate != null ? escapeHtml(c.constate) : '<span style="color:var(--text-faint);font-style:italic;">non trouvé</span>'}</td>
          <td class="num">${c.status === 'echec' && c.gapPct != null ? fmt(Math.round(c.gapPct * 100)) + ' %' : '—'}</td>
          <td style="text-align:center;"><span class="verdict-ico v-${c.status}">${ICON[c.status]}</span></td>
          <td><span class="nature-chip ${c.nature}">${c.nature === 'negociable' ? 'Négociable' : 'Éliminatoire'}</span></td>
          <td>${c.page ? `<button class="cite-link" data-syn-page="${c.page}" data-syn-quote="${escapeHtml(c.quote || '')}">voir</button>` : (c.calcule ? `<span class="label" title="${escapeHtml(c.methode || '')}">calculé</span>` : '—')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }

    // 4. Trois colonnes : pour / contre / ce qui manque (= les points a
    // verifier -- c'est ce bloc qui produit le mail au vendeur).
    // Les cartes "Hors critères" (famille Critères) redisent les échecs de
    // la grille juste au-dessus -- exclues pour ne pas compter deux fois.
    const cards = (doc.audit?.cards || []).filter(c => (c.niveau === 'rouge' || c.niveau === 'orange') && c.famille !== 'Critères');
    const pour = (fit?.criteria || []).filter(c => c.status === 'ok').map(c => `${c.label} : ${c.constate || ''}`);
    const contre = [
      ...(fit?.criteria || []).filter(c => c.status === 'echec').map(c => c.ecartPhrase || c.label),
      ...cards.map(c => c.titre),
    ];
    const manque = [
      ...(fit?.criteria || []).filter(c => c.status === 'indetermine').map(c => `${c.label} — non testable faute de donnée`),
      ...(doc.audit?.pointsACreuser || []).map(p => p.titre),
    ];
    const colHTML = (title, items, dot) => `<div class="synthese-col"><div class="label" style="margin-bottom:8px;">${title} (${items.length})</div>${items.length ? items.map(t => `<div class="synthese-col-item"><span class="dot ${dot}"></span>${escapeHtml(t)}</div>`).join('') : '<div class="synthese-col-item" style="color:var(--text-faint);font-style:italic;">Rien à signaler.</div>'}</div>`;
    const colsHTML = `<div class="synthese-cols">${colHTML('CE QUI PLAIDE POUR', pour, 'green')}${colHTML('CE QUI PLAIDE CONTRE', contre, 'pink')}${colHTML('CE QUI MANQUE — À DEMANDER', manque, 'amber')}</div>`;

    el.innerHTML = verdictHTML + coherenceHTML + gridHTML + colsHTML;
    el.querySelector('[data-go-criteria]')?.addEventListener('click', () => showView('settings'));
    el.querySelectorAll('[data-syn-page]').forEach(btn => btn.addEventListener('click', () => openSourceModal(Number(btn.dataset.synPage), btn.dataset.synQuote)));
    el.querySelectorAll('[data-goto-tab]').forEach(btn => btn.addEventListener('click', () => document.querySelector(`[data-etab="${btn.dataset.gotoTab}"]`)?.click()));

    // Compteurs d'anomalies sur les onglets concernes.
    const badge = (name, n) => { const b = document.querySelector(`[data-badge="${name}"]`); if (b) { b.textContent = n; b.style.display = n > 0 ? '' : 'none'; } };
    const perTab = { rentroll: 0, t12: 0 };
    anomalies.forEach(c => (TAB_OF_CHECK[c.check] || []).forEach(t => { if (perTab[t] != null) perTab[t]++; }));
    badge('synthese', anomalies.length + (fit?.criteria || []).filter(c => c.status === 'echec' && c.nature === 'eliminatoire').length);
    badge('rentroll', perTab.rentroll);
    badge('t12', perTab.t12);
  }

  // Contexte "directement écrit" : generation automatique silencieuse (une
  // seule tentative par dossier et par session) a l'ouverture de l'onglet
  // Indicateurs & contexte, si la synthese n'existe pas encore.
  const contexteAutoTried = new Set();
  async function maybeAutoGenerateContexte() {
    const doc = currentDoc;
    if (!doc || doc.status !== 'complete' || doc.contexteNarratif || contexteAutoTried.has(doc.id)) return;
    contexteAutoTried.add(doc.id);
    const status = document.getElementById('contexteInlineStatus');
    if (status) { status.textContent = 'RÉDACTION DU CONTEXTE EN COURS…'; status.style.display = 'block'; }
    try {
      const res = await fetch(`/api/documents/${doc.id}/contexte-narratif`, { method: 'POST' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Échec de la génération.'); }
      await refreshCurrentDoc();
      if (status) status.style.display = 'none';
    } catch (err) {
      if (status) status.textContent = `CONTEXTE INDISPONIBLE : ${escapeHtml(err.message)}`;
    }
  }

  function renderExtract(doc) {
    renderSynthese(doc);
    // En-tete : on sait quel bien on regarde.
    const h1 = document.querySelector('#view-extract .view-head h1');
    if (h1) h1.textContent = `Analyse · ${doc.displayName || doc.ficheIdentite?.adresse?.value || doc.filename}`;
    // Barre de decision fixe en bas (elements statiques, etats par dossier).
    const exp = document.getElementById('analysisExportLink');
    if (exp) exp.href = `/api/documents/${doc.id}/export/xlsx`;
    const pursue = document.getElementById('analysisPursueBtn');
    if (pursue) pursue.textContent = (doc.stage === 'underwriting' || doc.stage === 'comite') ? '✓ Poursuivi' : '▶ Poursuivre';
    const abandon = document.getElementById('analysisAbandonBtn');
    if (abandon) abandon.disabled = doc.stage === 'rejete';
    const fi = doc.ficheIdentite || {};
    currentIdFields = Object.keys(FICHE_LABELS).map(key => ({ key, label: FICHE_LABELS[key], field: fi[key] }));
    document.getElementById('paneIdentite').innerHTML = `<div class="id-fields" style="padding:20px;">${
      currentIdFields.map((f, i) => {
        const enteringContexte = FICHE_CONTEXTE_VENTE.includes(f.key) && !FICHE_CONTEXTE_VENTE.includes(currentIdFields[i - 1]?.key);
        const sectionLabel = enteringContexte ? '<div class="id-section-label">Contexte de la vente</div>' : '';
        return sectionLabel + `<div class="id-field" data-idx="${i}"><span class="label">${f.label}</span>${fieldValHTML(f.field, f.key)}</div>`;
      }).join('')
    }</div>`;
    document.querySelectorAll('#paneIdentite .id-field').forEach(el => el.addEventListener('click', () => {
      document.querySelectorAll('#paneIdentite .id-field').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      const f = currentIdFields[+el.dataset.idx];
      setAiCarousel(currentIdFields, +el.dataset.idx, identiteCommentData, i => document.querySelectorAll('#paneIdentite .id-field')[i]?.click());
      openInspector(f?.field?.page != null ? { page: f.field.page, quote: f.field.quote } : { sourceLabel: 'Champ absent du document — aucune source.' }, 'source');
    }));
    document.querySelectorAll('#paneIdentite .val > [data-fiche-key]').forEach(span => {
      const key = span.dataset.ficheKey;
      attachEditableValue(span, {
        getValue: () => currentDoc.ficheIdentite?.[key]?.value ?? '',
        onCommit: val => patchField({ section: 'ficheIdentite', field: key, value: val }),
      });
    });

    currentEtatLocatif = doc.etatLocatif || [];
    // Nouveau dossier charge : le panneau AI Insight ne doit jamais garder
    // l'etat (carte prete / en cours) d'un LOCATAIRE D'UN AUTRE DOSSIER --
    // les recherches en cours continuent en arriere-plan (toasts), seul
    // l'affichage du panneau repart a zero.
    document.getElementById('tenantInsightBody').innerHTML = `<div class="ai-comment-placeholder"><p>Lancez l'agent en cliquant sur un élément.</p></div>`;
    const totalLoyerRR = currentEtatLocatif.reduce((s, r) => s + (r.loyerAnnuel?.value || 0), 0);
    const rrSpan = (field, idx, text) => `<span data-rr-idx="${idx}" data-rr-field="${field}">${text}</span>`;
    document.getElementById('rrBody').innerHTML = currentEtatLocatif.map((r, i) => {
      const pctLoyer = totalLoyerRR && r.loyerAnnuel?.value != null ? (r.loyerAnnuel.value / totalLoyerRR * 100) : null;
      const loyerMensuel = r.loyerAnnuel?.value != null ? r.loyerAnnuel.value / 12 : null;
      const breakReel = r.prochaineOptionSortie?.value;
      const breakEstime = !breakReel ? estimateProchainBreak3Ans(r.dateDebutBail?.value) : null;
      const breakCell = breakReel ? rrSpan('prochaineOptionSortie', i, breakReel)
        : breakEstime ? `<span class="estimate-value" title="Estimé par Leez à partir de la date de prise d'effet + 3 ans (convention de bail 3/6/9) — non extrait explicitement du document">≈ ${breakEstime}</span>`
        : '—';
      return `
      <tr data-idx="${i}">
        <td>${r.suite || '—'}</td>
        <td>${rrSpan('locataire', i, r.locataire || '—')}</td>
        <td>${rrSpan('activite', i, r.activite || '—')}</td>
        <td class="num">${rrSpan('surfaceSf', i, r.surfaceSf?.value != null ? fmt(r.surfaceSf.value) : '—')}</td>
        <td class="num">${pctLoyer != null ? fmt2(pctLoyer) + ' %' : '—'}</td>
        <td class="num">${rrSpan('loyerFacialPsf', i, r.loyerFacialPsf?.value != null ? fmt2(r.loyerFacialPsf.value) : '—')}</td>
        <td class="num">${rrSpan('loyerEconomiquePsf', i, r.loyerEconomiquePsf?.value != null ? fmt2(r.loyerEconomiquePsf.value) : '—')}</td>
        <td class="num">${loyerMensuel != null ? fmt(Math.round(loyerMensuel)) + ' €' : '—'}</td>
        <td class="num">${rrSpan('loyerAnnuel', i, r.loyerAnnuel?.value != null ? fmt(r.loyerAnnuel.value) + ' €' : '—')}</td>
        <td>${rrSpan('typeIndexation', i, r.typeIndexation?.value || '—')}</td>
        <td>${rrSpan('dateDebutBail', i, r.dateDebutBail?.value || '—')}</td>
        <td>${rrSpan('dateFinBail', i, r.dateFinBail?.value || '—')}</td>
        <td>${breakCell}</td>
        <td>${rrSourceHTML(r)}</td>
      </tr>`;
    }).join('');
    // Clic sur une ligne (hors lien "Voir dans le document", qui gere son
    // propre clic) -> declenche l'AI Insight (recherche web) pour CE
    // locataire, voir runTenantInsight.
    document.getElementById('rrBody').onclick = e => {
      if (e.target.closest('[data-open-page]')) return;
      const tr = e.target.closest('tr');
      if (!tr) return;
      document.querySelectorAll('#rrBody tr').forEach(t => t.classList.remove('selected'));
      tr.classList.add('selected');
      const row = currentEtatLocatif[+tr.dataset.idx];
      const srcField = row.loyerAnnuel?.page != null ? row.loyerAnnuel : row.surfaceSf;
      // COMMENTAIRE : lanceur explicite de la recherche web locataire --
      // jamais lancee automatiquement par un simple clic de ligne.
      setAiComment(`<div class="ai-comment-card">
        <div class="ai-comment-title">${escapeHtml(row.locataire || row.suite || 'Locataire')}</div>
        <div class="ai-comment-text">Recherche web sur ce locataire (santé financière, actualité) — résultat affiché avec ses sources.</div>
        <button type="button" class="btn btn-outline" id="tiLaunchBtn" style="margin-top:10px;">🌐 Lancer la recherche →</button>
      </div>`);
      document.getElementById('tiLaunchBtn')?.addEventListener('click', () => runTenantInsight(row));
      openInspector(srcField?.page != null ? { page: srcField.page, quote: srcField.quote } : { sourceLabel: 'Ligne sans citation de page.' }, 'source');
    };
    document.querySelectorAll('#rrBody [data-rr-field]').forEach(span => {
      const idx = +span.dataset.rrIdx, field = span.dataset.rrField;
      attachEditableValue(span, {
        getValue: () => { const v = currentDoc.etatLocatif[idx][field]; return (v && typeof v === 'object') ? v.value : v; },
        onCommit: val => patchField({ section: 'etatLocatif', index: idx, field, value: val }),
      });
    });
    document.querySelectorAll('#rrBody [data-open-page]').forEach(b => b.addEventListener('click', () => openSourceModal(b.dataset.openPage, b.dataset.openQuote)));

    currentT12 = doc.t12 || [];
    const t12RowsHTML = currentT12.map((r, i) => `
      <tr data-idx="${i}" class="${r.montant?.page && !r.montant?.edited ? 'row-cited' : ''}"><td>${t12Label(r.lineItem)}</td><td class="num"><span data-t12-idx="${i}">${r.montant?.value != null ? (r.montant.value < 0 ? '- ' : '') + fmt(Math.abs(r.montant.value)) + ' €' : '—'}</span></td><td class="mono" style="color:var(--text-faint);font-size:.72rem;">${r.montant?.edited ? 'corrigé' : (r.montant?.page ? 'p.' + r.montant.page : '—')}</td></tr>`).join('');
    // Lignes de synthese (Total des charges / Loyer net-NOI) : jamais
    // extraites, toujours recalculees a partir des postes ci-dessus
    // (computeT12Totals cote serveur) -- pas de data-idx (non cliquables,
    // non editables, exclues du selectRow ci-dessous).
    const indT12 = doc.indicateurs || {};
    const t12SummaryHTML = currentT12.length ? `
      <tr class="t12-summary-row"><td>Total des charges</td><td class="num">${indT12.chargesTotal != null ? (indT12.chargesTotal < 0 ? '- ' : '') + fmt(Math.abs(indT12.chargesTotal)) + ' €' : '—'}</td><td></td></tr>
      <tr class="t12-summary-row t12-noi-row"><td>Loyer net (NOI)</td><td class="num">${indT12.resultatNetExploitation != null ? fmt(indT12.resultatNetExploitation) + ' €' : '—'}</td><td></td></tr>` : '';
    document.getElementById('t12Body').innerHTML = t12RowsHTML + t12SummaryHTML;
    document.getElementById('t12Body').onclick = e => {
      const tr = e.target.closest('tr');
      if (!tr || tr.dataset.idx === undefined) return;
      selectRow('t12Body', tr, currentT12, t12CommentData);
    };
    document.querySelectorAll('#t12Body [data-t12-idx]').forEach(span => {
      const idx = +span.dataset.t12Idx;
      attachEditableValue(span, {
        getValue: () => currentDoc.t12[idx]?.montant?.value ?? '',
        onCommit: val => patchField({ section: 't12', index: idx, field: 'montant', value: val }),
      });
    });

    currentMix = doc.mix || [];
    document.getElementById('mixBody').innerHTML = currentMix.map((m, i) => `
      <tr data-idx="${i}"><td>${m.tranche}</td><td class="num">${m.lots}</td><td class="num">${fmt(m.surfaceTotale)} m²</td><td class="num">${m.loyerMoyenM2 != null ? fmt2(m.loyerMoyenM2) + ' €' : '—'}</td></tr>`).join('');
    document.getElementById('mixBody').onclick = e => { const tr = e.target.closest('tr'); if (!tr) return; selectRow('mixBody', tr, currentMix, mixCommentData); };

    const ind = doc.indicateurs || {};
    currentMetricRows = [
      // WALB/WALT en tete de liste : ce sont les deux premiers indicateurs
      // qu'un comite d'investissement cherche a l'ouverture d'un dossier.
      // WALB = duree residuelle jusqu'a la PROCHAINE echeance reelle
      // (break triennal si mentionne, sinon fin de bail) ; WALT = duree
      // residuelle jusqu'a la fin de bail CONTRACTUELLE, sans tenir compte
      // d'une sortie anticipee possible -- deux notions differentes que les
      // fonds ne confondent jamais.
      { label: 'WALB (durée ferme moyenne pondérée)', value: ind.walb != null ? fmt2(ind.walb) + ' ans' : '—', source: 'état locatif' },
      { label: 'WALT (durée résiduelle moyenne pondérée)', value: ind.walt != null ? fmt2(ind.walt) + ' ans' : '—', source: 'état locatif' },
      { label: 'Prix / m²', value: ind.prixM2 != null ? fmt(ind.prixM2) + ' €' : '—', source: 'calculé' },
      { label: 'Rendement brut facial', value: ind.capRateRecalcule != null ? fmt2(ind.capRateRecalcule) + ' %' : '—', source: 'loyers faciaux ÷ prix demandé — brut, avant charges' },
      { label: 'Taux de capitalisation stabilisé (NOI)', value: ind.capRateStabilise != null ? fmt2(ind.capRateStabilise) + ' %' : '—', source: 'NOI du compte d\u2019exploitation ÷ prix demandé' },
      { label: 'Loyer moyen pondéré', value: ind.loyerMoyenM2 != null ? fmt2(ind.loyerMoyenM2) + ' €/m²' : '—', source: 'calculé' },
      // TOP (taux d'occupation physique, calcule sur les surfaces) : a
      // distinguer du taux annonce par le vendeur dans la Fiche d'identite
      // (base de calcul non garantie identique) -- jamais la meme ligne.
      { label: "TOP — Taux d'occupation physique", value: ind.tauxOccupation != null ? fmt2(ind.tauxOccupation) + ' %' : '—', source: 'calculé', id: 'taux_vacance', raw: ind.tauxVacance != null ? ind.tauxVacance / 100 : null },
      { label: 'Taux de vacance', value: ind.tauxVacance != null ? fmt2(ind.tauxVacance) + ' %' : '—', source: 'calculé' },
      { label: 'Concentration — 1er locataire', value: ind.concentrationTop1 != null ? fmt2(ind.concentrationTop1) + ' %' : '—', source: 'état locatif', id: 'concentration_top1', raw: ind.concentrationTop1 != null ? ind.concentrationTop1 / 100 : null },
      { label: 'Concentration — top 3', value: ind.concentrationTop3 != null ? fmt2(ind.concentrationTop3) + ' %' : '—', source: 'état locatif', id: 'concentration_top3', raw: ind.concentrationTop3 != null ? ind.concentrationTop3 / 100 : null },
      { label: 'Écart facial / économique', value: ind.ecartFacialEconomique != null ? fmt2(ind.ecartFacialEconomique) + ' %' : '—', source: 'état locatif', id: 'ecart_facial_economique', raw: ind.ecartFacialEconomique != null ? ind.ecartFacialEconomique / 100 : null },
      { label: 'Taux de charges non récupérables', value: ind.tauxChargesPct != null ? fmt2(ind.tauxChargesPct) + ' %' : '—', source: "compte d'exploitation", id: 'taux_charges', raw: ind.tauxChargesPct != null ? ind.tauxChargesPct / 100 : null },
      { label: 'Loyers nets encaissés', value: ind.revenuBrutEffectif != null ? fmt(ind.revenuBrutEffectif) + ' €' : '—', source: 'calculé' },
      { label: 'Total des charges', value: ind.chargesTotal != null ? fmt(ind.chargesTotal) + ' €' : '—', source: "compte d'exploitation" },
      { label: "Résultat net d'exploitation (NOI)", value: ind.resultatNetExploitation != null ? fmt(ind.resultatNetExploitation) + ' €' : '—', source: 'calculé' },
      { label: 'Marge NOI (NOI / loyers nets encaissés)', value: ind.margeNOI != null ? fmt2(ind.margeNOI) + ' %' : '—', source: 'calculé' },
      { label: 'LTV estimé', value: ind.ltvEstime != null ? fmt2(ind.ltvEstime) + ' %' : '—', source: 'structure de financement' },
    ];
    document.getElementById('metricsBody').innerHTML = currentMetricRows.map((m, i) => {
      // Concentration top 3 avec ≤ 3 locataires : 100 % par construction --
      // une tautologie, jamais une alerte.
      const tautologie = m.id === 'concentration_top3' && currentEtatLocatif.length <= 3;
      const interp = (m.id && !tautologie) ? interpret(m.id, m.raw, fmtPct1) : null;
      const alerte = interp && (interp.niveau === 'orange' || interp.niveau === 'rouge');
      // Colonne Etat : SEULEMENT une alerte metier (⚠ + explication au
      // survol, seuil inclus). Une donnee extraite sans signal n'affiche
      // rien -- une pastille verte melangerait "extrait" et "sain".
      const etat = alerte ? `<span class="metric-alert" title="${escapeHtml(interp.texte)}">⚠</span>` : '';
      const srcTxt = tautologie ? `${m.source} — ${currentEtatLocatif.length} locataires : 100 % par construction` : m.source;
      return `<tr data-idx="${i}"><td>${m.label}</td><td class="num">${m.value}</td><td class="src">${srcTxt}</td><td style="text-align:center;">${etat}</td></tr>`;
    }).join('');
    document.getElementById('metricsBody').onclick = e => { const tr = e.target.closest('tr'); if (!tr) return; selectRow('metricsBody', tr, currentMetricRows, metricCommentData); };

    // Chrome de la feuille (design "sheet") : titre, lien d'export, compteurs
    // de groupes -- tous derives des donnees deja rendues ci-dessus.
    const sheetTitle = document.getElementById('sheetTitle');
    if (sheetTitle) sheetTitle.textContent = `Grille d'extraction — ${doc.displayName || fi.adresse?.value || doc.filename}`;
    const exportLink = document.getElementById('sheetExportLink');
    if (exportLink) exportLink.href = `/api/documents/${doc.id}/export/xlsx`;
    const setCount = (id, n, unit) => { const el = document.getElementById(id); if (el) el.textContent = `${n} ${unit}${n > 1 ? 's' : ''}`; };
    setCount('groupCountIdentite', currentIdFields.length, 'champ');
    const rrCount = document.getElementById('groupCountRentroll');
    if (rrCount) rrCount.textContent = currentEtatLocatif.length > 1 ? `${currentEtatLocatif.length} baux` : `${currentEtatLocatif.length} bail`;
    setCount('groupCountT12', currentT12.length, 'poste');
    setCount('groupCountMix', currentMix.length, 'tranche');
    setCount('groupCountMetrics', currentMetricRows.length, 'indicateur');
  }

  // Repli/depli des groupes, filtre de lignes et bascule "cellules
  // verifiees" de la feuille d'extraction -- cablage statique (les corps de
  // groupes sont re-remplis par renderExtract, les groupes eux-memes sont
  // fixes dans le HTML).
  document.querySelectorAll('#extractSheet .sheet-group-head').forEach(head => head.addEventListener('click', () => {
    head.closest('.sheet-group').classList.toggle('collapsed');
  }));
  document.getElementById('sheetVerifiedToggle')?.addEventListener('change', e => {
    document.getElementById('extractSheet').classList.toggle('show-verified', e.target.checked);
  });
  document.getElementById('sheetFilter')?.addEventListener('input', () => {
    const q = (document.getElementById('sheetFilter').value || '').trim().toLowerCase();
    document.querySelectorAll('#extractSheet .id-field, #extractSheet tbody tr').forEach(row => {
      row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  document.getElementById('sheetAssistantBtn')?.addEventListener('click', () => goDossierPage('deal'));

  // Onglet "Contexte" : paragraphes redigés par l'IA (pas des champs courts),
  // generes uniquement a la demande de l'analyste (coût d'appel API dedie).
  function renderContexte(doc) {
    const prompt = document.getElementById('contexteGeneratePrompt');
    const body = document.getElementById('contexteBody');
    const btn = document.getElementById('contexteGenerateBtn');
    if (!doc.contexteNarratif) {
      prompt.style.display = 'flex';
      body.style.display = 'none';
      btn.disabled = doc.status !== 'complete';
      return;
    }
    prompt.style.display = 'none';
    body.style.display = 'block';
    body.innerHTML = CONTEXTE_THEMES.map(t => {
      const theme = doc.contexteNarratif[t] || { paragraphe: '', citations: [] };
      const texte = theme.paragraphe && theme.paragraphe.trim() ? theme.paragraphe : 'Non abordé dans le document.';
      const empty = texte === 'Non abordé dans le document.';
      const citationsHTML = (theme.citations || [])
        .map(c => `<button type="button" class="ai-source-link" data-open-page="${c.page}" data-open-quote="${(c.quote || '').replace(/"/g, '&quot;')}">Voir p.${c.page} →</button>`)
        .join('');
      return `<div class="contexte-theme">
        <div class="contexte-theme-title">${CONTEXTE_THEME_LABELS[t]}</div>
        <div class="contexte-theme-text${empty ? ' empty' : ''}">${texte}</div>
        ${citationsHTML ? `<div class="contexte-citations">${citationsHTML}</div>` : ''}
      </div>`;
    }).join('') + `<div class="contexte-disclaimer">SYNTHÈSE RÉDIGÉE PAR L'IA À PARTIR DU DOCUMENT RÉEL — CHAQUE PARAGRAPHE S'APPUIE SUR LES CITATIONS VÉRIFIÉES CI-DESSUS, MAIS LE TEXTE LUI-MÊME EST UNE LECTURE, PAS UNE DONNÉE EXTRAITE VERBATIM.</div>`;
    body.querySelectorAll('[data-open-page]').forEach(b => b.addEventListener('click', () => openSourceModal(b.dataset.openPage, b.dataset.openQuote)));
  }
  // Écran de chargement de la génération du Contexte -- même animation que
  // l'import d'un dossier (#contexteOverlay reprend les classes .import-*
  // telles quelles), avec un titre qui défile sur des phrases indicatives
  // du travail réel en cours (même principe que PHRASES_BY_STATUS, mais un
  // seul appel ici : pas d'étapes distinctes à refléter).
  const CONTEXTE_PHRASES = [
    'Lecture du document réel…',
    'Repérage du contexte de la vente…',
    'Rédaction de la synthèse, paragraphe par paragraphe…',
    'Vérification des citations de chaque paragraphe…',
  ];
  let contexteOverlayTimer = null;
  function startContexteOverlayPhrases() {
    const title = document.getElementById('contexteOverlayTitle');
    let i = 0;
    title.textContent = CONTEXTE_PHRASES[0];
    contexteOverlayTimer = setInterval(() => { i = (i + 1) % CONTEXTE_PHRASES.length; title.textContent = CONTEXTE_PHRASES[i]; }, 2200);
  }
  function stopContexteOverlayPhrases() {
    if (contexteOverlayTimer) clearInterval(contexteOverlayTimer);
    contexteOverlayTimer = null;
  }
  document.getElementById('contexteOverlayCloseBtn').addEventListener('click', () => {
    stopContexteOverlayPhrases();
    const overlay = document.getElementById('contexteOverlay');
    overlay.style.display = 'none';
    overlay.classList.remove('error');
  });

  document.getElementById('contexteGenerateBtn').addEventListener('click', async () => {
    const btn = document.getElementById('contexteGenerateBtn');
    const overlay = document.getElementById('contexteOverlay');
    const overlayError = document.getElementById('contexteOverlayError');
    const overlayCloseBtn = document.getElementById('contexteOverlayCloseBtn');
    btn.disabled = true;
    overlay.classList.remove('complete', 'error');
    overlayError.style.display = 'none';
    overlayCloseBtn.style.display = 'none';
    overlay.style.display = 'flex';
    startContexteOverlayPhrases();
    try {
      const res = await fetch(`/api/documents/${currentDoc.id}/contexte-narratif`, { method: 'POST' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Échec de la génération.'); }
      stopContexteOverlayPhrases();
      overlay.classList.add('complete');
      // Laisse le temps à l'animation de coche de se jouer, comme à la fin
      // d'un import, avant de révéler la synthèse générée.
      setTimeout(async () => {
        overlay.style.display = 'none';
        overlay.classList.remove('complete');
        await refreshCurrentDoc();
        btn.disabled = false;
      }, 1100);
    } catch (err) {
      stopContexteOverlayPhrases();
      overlay.classList.add('error');
      overlayError.style.display = 'block';
      overlayError.textContent = err.message;
      overlayCloseBtn.style.display = 'inline-block';
      btn.disabled = false;
    }
  });

  // ================= NOTES LIBRES ================= //
  // Texte libre de l'analyste, non genere/interprete par le modele -- simple
  // enregistrement autosave. Deux points d'entree pour le meme contenu : le
  // panneau "Notes" (bascule dans le panneau Commentaire IA de l'onglet
  // Données, meme emplacement/taille que le commentaire IA) et l'onglet
  // dedie "Notes" du menu du dossier (plus spacieux, avec le tri par section).
  //
  // Tri par /tag : une ligne commençant par "/motcle" (ex. "/question loyer
  // facial ou économique ?") est classée sous la section "Question" dans
  // l'apercu trie -- pur parsing cote client, le texte enregistre reste tel
  // quel (aucune restructuration des donnees, aucun appel modele). Les tags
  // sont entierement libres : aucune liste fixe, la section est creee a la
  // volee a partir du premier mot suivant le "/".
  let notesSaveTimer = null;
  function parseNotesLines(text) {
    return (text || '').split('\n').map(line => {
      const m = line.match(/^\s*\/(\S+)\s*(.*)$/);
      return m ? { tag: m[1].toLowerCase(), text: m[2] } : { tag: null, text: line };
    });
  }
  function renderNotesSections(text) {
    const container = document.getElementById('notesSections');
    if (!container) return;
    const lines = parseNotesLines(text).filter(l => l.text.trim() !== '' || l.tag);
    const order = [];
    const groups = {};
    lines.forEach(l => {
      const key = l.tag || '__general__';
      const content = l.text.trim();
      if (!content) return;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(content);
    });
    if (order.length === 0) {
      container.innerHTML = `<div class="notes-sections-empty">Vos notes triées apparaîtront ici. Commencez une ligne par <code>/tag</code> (ex. <code>/question</code>, <code>/risque</code>) pour la classer dans une section.</div>`;
      return;
    }
    container.innerHTML = order.map(key => {
      const label = key === '__general__' ? 'Sans étiquette' : key.charAt(0).toUpperCase() + key.slice(1);
      return `<div class="notes-section">
        <div class="notes-section-title">${escapeHtml(label)}</div>
        <ul class="notes-section-list">${groups[key].map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
      </div>`;
    }).join('');
  }
  function syncNotesTextareas(value) {
    const a = document.getElementById('aiNotesTextarea');
    const b = document.getElementById('notesTextarea');
    if (a && a.value !== value) a.value = value;
    if (b && b.value !== value) b.value = value;
    renderNotesSections(value);
  }
  function scheduleSaveNotes(value) {
    if (!currentDoc) return;
    currentDoc.notes = value;
    syncNotesTextareas(value);
    const status = document.getElementById('notesSavedStatus');
    if (status) status.style.display = 'none';
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(async () => {
      await fetch(`/api/documents/${currentDoc.id}/notes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
      });
      if (status) { status.style.display = 'inline'; setTimeout(() => { status.style.display = 'none'; }, 2000); }
    }, 700);
  }
  document.getElementById('aiNotesTextarea').addEventListener('input', e => scheduleSaveNotes(e.target.value));
  document.getElementById('notesTextarea').addEventListener('input', e => scheduleSaveNotes(e.target.value));

  // Mode par defaut : toujours "Commentaire IA", sauf sur l'onglet Contexte
  // (paragraphes de synthese sans commentaire IA par champ associe) ou l'on
  // arrive directement en mode Notes -- cf. setAiMode appele depuis le
  // gestionnaire de clic des extract-tabs plus bas.
  // ---------- tiroir d'inspection (SOURCE | COMMENTAIRE | NOTES) ----------
  // Ferme par defaut, superpose a droite : ne reserve JAMAIS de largeur.
  function switchInspectorTab(tab) {
    document.querySelectorAll('.inspector-tabs .itab').forEach(t => t.classList.toggle('active', t.dataset.itab === tab));
    document.querySelectorAll('.inspector-pane').forEach(p => { p.style.display = p.dataset.ipane === tab ? '' : 'none'; });
  }
  // Compat : l'ancien setAiMode ('ia'/'notes') route vers le tiroir.
  function setAiMode(mode) { switchInspectorTab(mode === 'notes' ? 'notes' : 'commentaire'); }
  function openInspector(ctx = {}, tab = 'source') {
    const drawer = document.getElementById('inspectorDrawer');
    if (!drawer) return;
    const frame = document.getElementById('inspectorFrame');
    const text = document.getElementById('inspectorText');
    const quote = document.getElementById('inspectorQuote');
    const calc = document.getElementById('inspectorCalc');
    const srcLabel = document.getElementById('inspectorSourceLabel');
    calc.style.display = 'none'; frame.style.display = 'none'; text.style.display = 'none'; quote.style.display = 'none';
    if (ctx.page != null) {
      // Pas de bandeau "PAGE N" ni de rappel de citation : le PDF zoome
      // directement sur la phrase, il EST l'information.
      srcLabel.style.display = 'none';
      frame.style.display = '';
      loadSourcePage(ctx.page, ctx.quote, { frameEl: frame, textEl: text, quoteEl: null });
    } else {
      srcLabel.style.display = 'block';
      srcLabel.textContent = 'VALEUR CALCULÉE — PAS DE PAGE SOURCE UNIQUE';
      calc.style.display = 'block';
      calc.textContent = ctx.sourceLabel || 'Calculée par le moteur déterministe à partir des champs vérifiés.';
    }
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    switchInspectorTab(tab);
  }
  function closeInspector() {
    const drawer = document.getElementById('inspectorDrawer');
    drawer?.classList.remove('open');
    drawer?.setAttribute('aria-hidden', 'true');
  }
  document.getElementById('inspectorClose')?.addEventListener('click', closeInspector);
  document.querySelectorAll('.inspector-tabs .itab').forEach(t => t.addEventListener('click', () => switchInspectorTab(t.dataset.itab)));

  function selectRow(bodyId, tr, items, dataFn) {
    const body = document.getElementById(bodyId);
    body.querySelectorAll('tr').forEach(t => t.classList.remove('selected'));
    tr.classList.add('selected');
    const idx = +tr.dataset.idx;
    setAiCarousel(items, idx, dataFn, i => {
      if (i < 0 || i >= items.length) return;
      const target = body.querySelector(`tr[data-idx="${i}"]`);
      if (target) selectRow(bodyId, target, items, dataFn);
    });
    const d = dataFn(items[idx]);
    openInspector({ page: d.page, quote: d.quote, sourceLabel: d.sourceLabel }, 'source');
  }

  const paneLabels = { synthese: 'SYNTHÈSE — CRITÈRES DU FONDS × BIEN', rentroll: 'ÉTAT LOCATIF & RÉPARTITION DES SURFACES', t12: "COMPTE D'EXPLOITATION — 12 MOIS GLISSANTS (T-12)", metrics: 'INDICATEURS CLÉS & CONTEXTE' };
  const paneHints = { synthese: '', rentroll: '', t12: '', metrics: '' };
  document.querySelectorAll('.extract-tabs .etab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.extract-tabs .etab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('[data-pane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-pane="${tab.dataset.etab}"]`).style.display = 'block';
    document.getElementById('etabLabel').textContent = paneLabels[tab.dataset.etab];
    document.getElementById('etabHint').textContent = paneHints[tab.dataset.etab];
    // Panneau lateral : AI Insight sur l'État locatif, Commentaire IA/Notes
    // sur T12/Surfaces/Indicateurs -- et RIEN sur la Synthèse (grille pleine
    // largeur, l'assistant est un panneau a la demande via le bouton 💬).
    // Le tiroir se referme au changement d'onglet (il porte le contexte de
    // la valeur cliquee, plus valable sur un autre ecran).
    closeInspector();
    // Contexte "directement écrit" : genere automatiquement (une fois) a
    // l'ouverture de l'onglet Indicateurs s'il n'existe pas encore.
    if (tab.dataset.etab === 'metrics') maybeAutoGenerateContexte();
  }));
  document.getElementById('analysisBackBtn')?.addEventListener('click', () => goDossierPage('deal'));
  document.getElementById('analysisPursueBtn')?.addEventListener('click', async () => {
    if (currentDoc.stage === 'underwriting' || currentDoc.stage === 'comite') return;
    await applyStageChange('underwriting');
  });
  document.getElementById('analysisAbandonBtn')?.addEventListener('click', () => { if (currentDoc.stage !== 'rejete') openRejectModal(); });

  // ================= PAGE SOURCE (PDF ORIGINAL, ZOOME SUR LA CITATION) ================= //
  // Affiche directement le PDF original (iframe, visualiseur natif du
  // navigateur) plutot qu'une reconstruction texte -- mais avec un fragment
  // "zoom=echelle,left,top" calcule cote serveur (meme localisation de
  // citation que la verification initiale, cf. locateQuote/deriveBox dans
  // verification.js) pour arriver deja zoome sur le bon paragraphe au lieu
  // de laisser l'analyste chercher a l'oeil sur toute la page. Fonction
  // partagee par la modale (onglet Données/Contexte) et le panneau scindé
  // de l'Audit ; conserve le repli texte pour le dossier de demonstration
  // (aucun vrai fichier PDF associe).
  function loadSourcePage(page, quote, { frameEl, textEl, quoteEl }) {
    if (quoteEl) { quoteEl.style.display = quote ? 'block' : 'none'; quoteEl.textContent = quote ? `« ${quote} »` : ''; }
    if (currentDoc.isDemo) {
      frameEl.style.display = 'none'; textEl.style.display = 'block';
      textEl.textContent = 'Chargement…';
      fetch(`/api/documents/${currentDoc.id}/page/${page}`).then(r => r.json())
        .then(d => { textEl.textContent = (d.text || '(page vide)') + '\n\n[Dossier de démonstration — texte reconstruit, aucun fichier PDF réel associé.]'; })
        .catch(() => { textEl.textContent = 'Impossible de charger cette page.'; });
      return;
    }
    frameEl.style.display = 'block'; textEl.style.display = 'none';
    // navpanes=0 : jamais la colonne de vignettes du visualiseur ; zoom=90 :
    // la bonne page s'affiche entiere, centree et lisible -- plus aucun
    // scroll aux coordonnees de la citation (parametres fixes, plus besoin
    // d'interroger le serveur pour un fragment).
    frameEl.src = `/api/documents/${currentDoc.id}/file#page=${page}&navpanes=0&zoom=90`;
  }

  // ================= AUDIT ================= //
  // Chaque carte = un risque reel, calcule cote serveur (interpretation.js)
  // a partir de donnees deja extraites+verifiees. Ce fichier ne fait que les
  // afficher, triees par gravite, avec un lien source cliquable et une
  // action eventuelle vers le simulateur -- aucune logique metier ici.
  function openAuditSource(page, quote) {
    document.getElementById('auditLayout').classList.add('split');
    document.getElementById('auditSourcePageNum').textContent = page;
    loadSourcePage(page, quote, {
      frameEl: document.getElementById('auditSourceFrame'),
      textEl: document.getElementById('auditSourceText'),
      quoteEl: document.getElementById('auditSourceQuote'),
    });
  }
  document.getElementById('auditSourceClose').addEventListener('click', () => document.getElementById('auditLayout').classList.remove('split'));

  function renderAudit(doc) {
    document.getElementById('auditLayout').classList.remove('split');

    if (doc.status !== 'complete') {
      const msg = `<div style="padding:20px 24px;" class="label">${STATUS_LABELS[doc.status] || doc.status}${doc.errorMessage ? ' — ' + doc.errorMessage : ''}</div>`;
      document.getElementById('auditVerdictLabel').textContent = '—';
      document.getElementById('auditVerdictDot').className = 'audit-verdict-dot';
      document.getElementById('auditCounts').innerHTML = '';
      document.getElementById('auditPhrase').textContent = '';
      document.getElementById('auditCards').innerHTML = msg;
      document.getElementById('auditQuestions').innerHTML = '';
      return;
    }

    const audit = doc.audit || { summary: { niveauGlobal: 'vert', verdictLabel: 'Aucune alerte majeure détectée', counts: { rouge: 0, orange: 0, vert: 0 }, phrase: '' }, cards: [], pointsACreuser: [] };
    const niveauClass = n => n === 'rouge' ? 'pink' : n === 'orange' ? 'amber' : 'green';

    // Bandeau de synthèse — verdict en 5 secondes.
    const s = audit.summary;
    document.getElementById('auditVerdictDot').className = 'audit-verdict-dot ' + niveauClass(s.niveauGlobal);
    document.getElementById('auditVerdictLabel').textContent = s.verdictLabel;
    document.getElementById('auditCounts').innerHTML = [
      s.counts.rouge ? `<span class="chip" style="color:var(--pink);border-color:rgba(226,99,92,.4);">${s.counts.rouge} critique${s.counts.rouge > 1 ? 's' : ''}</span>` : '',
      s.counts.orange ? `<span class="chip" style="color:var(--amber);border-color:rgba(224,185,95,.4);">${s.counts.orange} vigilance${s.counts.orange > 1 ? 's' : ''}</span>` : '',
      (!s.counts.rouge && !s.counts.orange) ? `<span class="chip" style="color:var(--green);border-color:rgba(127,217,154,.4);">RAS sur les critères vérifiés</span>` : '',
    ].join('');
    document.getElementById('auditPhrase').textContent = s.phrase;

    // Cartes d'alerte — le travail de lecture déjà fait, tri par gravité déjà appliqué côté serveur.
    const missingSignaux = doc.redFlags == null;
    document.getElementById('auditCards').innerHTML = (audit.cards.length === 0
      ? '<div class="interp-flag-empty">Aucune alerte détectée sur les critères vérifiés par Leez.</div>'
      : audit.cards.map((c, i) => `
        <div class="audit-card ${niveauClass(c.niveau)}" data-audit-idx="${i}" ${c.critereId ? `data-audit-mandate="${c.critereId}"` : ''}>
          <span class="dot ${niveauClass(c.niveau)}"></span>
          <div style="flex:1;">
            <div class="flag-header"><span class="flag-title">${c.titre}</span><span class="chip status-draft">${c.famille}</span></div>
            <div class="flag-body">${c.constat}</div>
            <div class="audit-card-impact">${c.impact}</div>
            <div class="audit-card-actions">
              ${c.page != null ? `<button class="cite-link" data-audit-page="${c.page}" data-audit-quote="${(c.quote || '').replace(/"/g, '&quot;')}">Voir la source →</button>` : ''}
              ${c.actionType === 'simulateur' ? `<button class="cite-link" data-audit-to-sim="${c.capexMontant ?? ''}">${c.actionLabel} →</button>` : ''}
              ${c.critereId ? `<button class="cite-link" data-audit-mandate-btn="${c.critereId}">Comparer tous les critères →</button>` : ''}
              <button class="cite-link" data-audit-kb="${i}">Justifier avec le savoir juridique →</button>
            </div>
            <div class="audit-kb-body" id="auditKbBody${i}" style="display:none;"></div>
          </div>
        </div>`).join('')
    ) + (missingSignaux ? `<p style="font-size:.78rem;color:var(--text-faint);padding:14px 24px;">Les signaux "solvabilité locataire" et "travaux techniques" n'ont pas été extraits pour ce document (importé avant l'ajout de cette fonctionnalité) — réimportez-le pour les obtenir.</p>` : '');
    document.querySelectorAll('#auditCards [data-audit-page]').forEach(btn => btn.addEventListener('click', () => openAuditSource(btn.dataset.auditPage, btn.dataset.auditQuote)));
    document.querySelectorAll('#auditCards [data-audit-to-sim]').forEach(btn => btn.addEventListener('click', () => {
      showView('analyze');
      const montant = parseFloat(btn.dataset.auditToSim);
      if (Number.isFinite(montant) && window.LeezSimulator) window.LeezSimulator.noteCapexHint(montant);
    }));
    document.querySelectorAll('#auditCards [data-audit-kb]').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      const idx = btn.dataset.auditKb;
      const body = document.getElementById(`auditKbBody${idx}`);
      const c = audit.cards[idx];
      if (body.style.display !== 'none') { body.style.display = 'none'; return; }
      body.style.display = 'block';
      body.innerHTML = '<p class="label">Recherche dans le savoir juridique…</p>';
      btn.disabled = true;
      try {
        const res = await fetch('/api/knowledge/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: `${c.titre} — ${c.constat}` }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur serveur');
        if (!data.supported || data.paragraphs.length === 0) {
          body.innerHTML = `<p class="audit-kb-caveat">${data.caveat || "Le savoir juridique disponible ne permet pas de justifier ce point."}</p>`;
        } else {
          body.innerHTML = data.paragraphs.map(p => `<p class="audit-kb-paragraph">${p.text}</p>`).join('')
            + `<div class="audit-kb-sources">${[...new Map(data.paragraphs.map(p => [`${p.sourceFile}|${p.sourceSection}`, p])).values()]
              .map(p => `<span class="label">Source : ${p.sourceFile} — ${p.sourceSection} (p. ${p.page})</span>`).join('')}</div>`;
        }
      } catch (err) {
        body.innerHTML = `<p class="audit-kb-caveat">Impossible d'interroger le savoir juridique : ${err.message}</p>`;
      } finally {
        btn.disabled = false;
      }
    }));
    document.querySelectorAll('#auditCards [data-audit-mandate]').forEach(card => card.addEventListener('click', e => {
      if (e.target.closest('[data-audit-mandate-btn]')) return; // le bouton dédié gère déjà son propre clic
      openMandateModal(card.dataset.auditMandate);
    }));
    document.querySelectorAll('#auditCards [data-audit-mandate-btn]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      openMandateModal(btn.dataset.auditMandateBtn);
    }));

    // Points à creuser — la to-do de décision.
    const questions = audit.pointsACreuser || [];
    document.getElementById('auditQuestions').innerHTML = questions.length === 0
      ? '<p class="label" style="line-height:1.6;">Aucun manque de données identifié sur les critères vérifiés.</p>'
      : `<ul class="audit-questions-list">${questions.map(q => `<li><span class="q-title">${q.titre}</span><span class="q-detail">${q.detail}</span></li>`).join('')}</ul>`;
  }

  // ================= RÉCONCILIATION (OM déclaré vs constaté sur pièces) ================= //
  // Reutilise tel quel doc.reconciliation (server/services/reconciliation.js,
  // deja calcule a partir de champs cites/indicateurs deja verifies) --
  // aucun calcul cote client, juste la mise en forme du tableau.
  const RECONCILIATION_SIGNAL_LABEL = { ok: 'Conforme', warning: 'Écart', critical: 'Écart important', indetermine: 'Donnée insuffisante' };
  function renderReconciliation(doc) {
    const body = document.getElementById('reconciliationBody');
    if (!body) return;
    if (doc.status !== 'complete') {
      body.innerHTML = `<tr><td colspan="4" style="color:var(--text-faint);font-style:italic;">${STATUS_LABELS[doc.status] || doc.status}</td></tr>`;
      return;
    }
    const rows = doc.reconciliation || [];
    body.innerHTML = rows.map(r => {
      const deltaText = r.deltaPct == null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct} %`;
      const signalColorVar = r.signal === 'critical' ? '--pink' : r.signal === 'warning' ? '--amber' : r.signal === 'ok' ? '--green' : '--text-faint';
      return `<tr>
        <td style="text-align:left;font-weight:600;color:var(--text);">${escapeHtml(r.label)}</td>
        <td style="text-align:left;">${r.invoqueLabel ? escapeHtml(r.invoqueLabel) : '<span style="color:var(--text-faint);font-style:italic;">Donnée insuffisante</span>'}</td>
        <td style="text-align:left;">${r.constateLabel ? escapeHtml(r.constateLabel) : '<span style="color:var(--text-faint);font-style:italic;">Donnée insuffisante</span>'}</td>
        <td><span class="chip" style="color:var(${signalColorVar});border-color:var(${signalColorVar});">${deltaText} · ${RECONCILIATION_SIGNAL_LABEL[r.signal]}</span></td>
      </tr>`;
    }).join('');
  }

  // ================= CENTRE D'EXPORT (artéfacts) ================= //
  // Regroupe les artéfacts que Leez sait réellement produire aujourd'hui à
  // partir des données vérifiées du deal : le feeder Excel (formules natives,
  // route serveur /export/xlsx) et la présentation comité (générée dans le
  // navigateur depuis les mêmes données, imprimable en PDF). Rien d'autre --
  // jamais une carte pour un format non encore implémenté.
  function renderExportView(doc) {
    const grid = document.getElementById('exportGrid');
    if (!grid) return;
    const ready = doc.status === 'complete';
    const lockNote = '<span class="export-unavailable">Disponible une fois l\'extraction terminée.</span>';
    grid.innerHTML = `
      <div class="export-card">
        <span class="label">FEEDER DE MODÈLE FINANCIER</span>
        <h3>Export Excel (.xlsx)</h3>
        <p>État locatif, compte d'exploitation (T12) et synthèse restructurés en trois feuilles. Les totaux, le NOI et le taux de capitalisation recalculé sont de vraies formules Excel natives (SUM, SUMIF, références croisées) — le classeur reste vivant si vous corrigez une valeur, prêt à alimenter votre modèle de souscription.</p>
        <div class="export-card-actions">
          ${ready ? `<a class="btn btn-solid" href="/api/documents/${doc.id}/export/xlsx" download>⬇ Télécharger le classeur</a>` : lockNote}
        </div>
      </div>
      <div class="export-card">
        <span class="label">MÉMO IC FLASH</span>
        <h3>Note de comité (.docx)</h3>
        <p>Un mémo Word d'une page : fiche de synthèse, conformité au mandat, points de vigilance, réconciliation OM vs pièces, points à creuser. Gabarit déterministe peuplé des données vérifiées — la recommandation finale (Pass / Deep dive) est laissée vide, à vous.</p>
        <div class="export-card-actions">
          ${ready ? `<a class="btn btn-outline" href="/api/documents/${doc.id}/export/docx" download>⬇ Télécharger le mémo</a>` : lockNote}
        </div>
      </div>
      <div class="export-card">
        <span class="label">PRÉSENTATION</span>
        <h3>Présentation comité</h3>
        <p>Un deck pré-mis en page, peuplé uniquement des données vérifiées du deal (fiche de synthèse, état locatif, indicateurs recalculés), avec copilote de mise en forme. Exportable en PDF via l'impression, ou vers Google Slides.</p>
        <div class="export-card-actions">
          ${ready ? '<button class="btn btn-outline" id="exportOpenPresentationBtn">Ouvrir la présentation →</button>' : lockNote}
        </div>
      </div>`;
    document.getElementById('exportOpenPresentationBtn')?.addEventListener('click', () => openPresentationDeck(currentDoc));
  }

  // ================= MÉMOIRE INSTITUTIONNELLE ================= //
  // Deux blocs, tous deux appuyes sur des donnees REELLES : (1) l'historique
  // des deals du workspace (la vraie memoire du fonds -- table comparables
  // avec les indicateurs deja calcules), (2) la base de connaissances
  // partagee (recherche par similarite existante, kbSearch.js). Si la base
  // est vide, on le dit -- jamais une recherche qui echoue sans explication.
  async function renderMemoire() {
    const body = document.getElementById('memoireDealsBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="8" style="color:var(--text-faint);">Chargement…</td></tr>';
    const allDocs = await fetchDocuments();

    // Deals refusés : la partie la plus précieuse de la mémoire -- motif,
    // auteur, date, et un RAPPEL vers le Vault en un clic (rien n'est
    // jamais supprimé ; un refus n'est pas définitif, le contexte change).
    const rejected = allDocs.filter(d => d.stage === 'rejete');
    const rejBody = document.getElementById('memoireRejectedBody');
    document.getElementById('memoireRejectedCount').textContent = `${rejected.length} REFUSÉ${rejected.length > 1 ? 'S' : ''}`;
    rejBody.innerHTML = rejected.length === 0
      ? '<tr><td colspan="7" style="color:var(--text-faint);font-style:italic;">Aucun dossier refusé pour l\'instant.</td></tr>'
      : rejected.map(d => {
        const name = d.ficheIdentite?.adresse?.value || d.filename;
        const type = d.ficheIdentite?.typeActif?.value || '—';
        const prix = d.ficheIdentite?.prixDemande?.value || '—';
        const when = d.decidedAt ? new Date(d.decidedAt).toLocaleDateString('fr-FR') : '—';
        return `<tr data-doc-id="${d.id}">
          <td style="font-weight:600;color:var(--text);">${escapeHtml(name)}</td><td>${escapeHtml(type)}</td>
          <td class="num">${escapeHtml(prix)}</td><td>${when}</td><td>${escapeHtml(d.decidedBy || '—')}</td>
          <td class="memoire-motif">${escapeHtml(d.decisionMotif || '—')}</td>
          <td><button class="btn btn-outline" data-recall-id="${d.id}" style="white-space:nowrap;">↩ Rappeler dans le Vault</button></td>
        </tr>`;
      }).join('');
    rejBody.querySelectorAll('tr[data-doc-id]').forEach(tr => tr.addEventListener('click', () => openDossier(tr.dataset.docId)));
    rejBody.querySelectorAll('[data-recall-id]').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      const res = await fetch(`/api/documents/${btn.dataset.recallId}/stage`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'triage' }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Échec du rappel.'); return; }
      renderMemoire();
    }));

    const docs = allDocs;
    document.getElementById('memoireDealsCount').textContent = `${docs.length} DEAL${docs.length > 1 ? 'S' : ''}`;
    if (docs.length === 0) {
      body.innerHTML = '<tr><td colspan="8" style="color:var(--text-faint);font-style:italic;">Aucun deal importé pour l\'instant.</td></tr>';
    } else {
      body.innerHTML = docs.map(d => {
        const fi = d.ficheIdentite, ind = d.indicateurs;
        const name = (fi && fi.adresse && fi.adresse.value) ? fi.adresse.value : d.filename;
        const type = (fi && fi.typeActif && fi.typeActif.value) ? fi.typeActif.value : '—';
        const prixDemande = (fi && fi.prixDemande && fi.prixDemande.value) ? fi.prixDemande.value : '—';
        const prixM2 = ind && ind.prixM2 != null ? fmt(ind.prixM2) + ' €/m²' : '—';
        const cap = ind && ind.capRateRecalcule != null ? fmt2(ind.capRateRecalcule) + ' %' : '—';
        const occ = ind && ind.tauxOccupation != null ? fmt2(ind.tauxOccupation) + ' %' : '—';
        const when = new Date(d.uploadedAt);
        const whenTxt = Number.isNaN(when.getTime()) ? '—' : when.toLocaleDateString('fr-FR');
        return `<tr data-doc-id="${d.id}">
          <td style="font-weight:600;color:var(--text);">${name}</td><td>${type}</td>
          <td class="num">${prixDemande}</td><td class="num">${prixM2}</td><td class="num">${cap}</td><td class="num">${occ}</td>
          <td>${stageBadge(d.stage)}</td><td>${whenTxt}</td>
        </tr>`;
      }).join('');
      body.querySelectorAll('tr[data-doc-id]').forEach(tr => tr.addEventListener('click', () => openDossier(tr.dataset.docId)));
    }
    // Contenu reel de la base de connaissances -- affiche honnetement son
    // volume, ou son etat vide.
    try {
      const stats = await (await fetch('/api/knowledge/stats')).json();
      const el = document.getElementById('memoireKbStats');
      el.textContent = stats.chunks > 0
        ? `${stats.chunks} EXTRAITS · ${stats.sources.length} SOURCE${stats.sources.length > 1 ? 'S' : ''}`
        : 'BASE VIDE — AUCUN DOCUMENT DE RÉFÉRENCE INGÉRÉ';
    } catch { /* statut non bloquant */ }
  }

  async function runMemoireKbSearch() {
    const q = (document.getElementById('memoireKbQuery')?.value || '').trim();
    const out = document.getElementById('memoireKbResults');
    if (!q || !out) return;
    out.innerHTML = '<div class="label">RECHERCHE…</div>';
    try {
      const r = await fetch('/api/knowledge/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, k: 5 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur lors de la recherche.');
      if (!d.results || d.results.length === 0) {
        out.innerHTML = '<div class="label">AUCUN RÉSULTAT — LA BASE DE CONNAISSANCES EST PEUT-ÊTRE VIDE.</div>';
        return;
      }
      out.innerHTML = d.results.map(c => `<div class="kb-result">
          <div class="kb-source">${escapeHtml(c.source_file)} · ${escapeHtml(c.section_title || '')}${c.article_ref ? ' · ' + escapeHtml(c.article_ref) : ''} · p. ${c.page_start}${c.page_end !== c.page_start ? '–' + c.page_end : ''}</div>
          <div class="kb-text">${escapeHtml(String(c.content).slice(0, 600))}${String(c.content).length > 600 ? '…' : ''}</div>
        </div>`).join('');
    } catch (err) {
      out.innerHTML = `<div class="label" style="color:var(--amber);">${escapeHtml(err.message)}</div>`;
    }
  }
  document.getElementById('memoireKbSearchBtn')?.addEventListener('click', runMemoireKbSearch);
  document.getElementById('memoireKbQuery')?.addEventListener('keydown', e => { if (e.key === 'Enter') runMemoireKbSearch(); });

  // ================= BIBLIOTHÈQUE DE WORKFLOWS ================= //
  // Page en LECTURE SEULE decrivant ce que Leez extrait et calcule
  // REELLEMENT aujourd'hui (le schema effectif du pipeline, pas un
  // catalogue aspirationnel) : un seul workflow actif, decrit champ par
  // champ depuis les memes catalogues que le reste de l'app.
  function renderWorkflows() {
    const el = document.getElementById('workflowsBody');
    if (!el) return;
    const rentRollFields = ['Lot', 'Locataire', 'Activité', 'Statut', 'Surface (m²)', 'Loyer facial (€/m²/an)', 'Loyer économique (€/m²/an)', 'Loyer mensuel', 'Loyer annuel', 'Indexation', 'Prise d\'effet', 'Échéance', 'Prochaine échéance triennale', 'Clause plancher', 'Franchise', 'Dépôt de garantie', 'Charges récupérables (%)'];
    const signauxFields = ['Locataires en difficulté explicitement mentionnés', 'CAPEX techniques mentionnés non provisionnés', 'Affirmations marketing du vendeur (à confronter)'];
    const indicateursFields = ['Prix / m²', 'Taux de capitalisation recalculé', 'Taux d\'occupation physique (TOP)', 'Revenu brut effectif (EGI)', 'Total des charges', 'Résultat net d\'exploitation (NOI)', 'Match mandat', 'Réconciliation OM vs pièces'];
    const chip = f => `<span class="workflow-field">${escapeHtml(f)}</span>`;
    el.innerHTML = `
      <div class="workflow-card">
        <span class="label">WORKFLOW ACTIF</span>
        <h3>Mémorandum de vente (OM) — Immobilier commercial France</h3>
        <p style="font-family:var(--sans);font-size:.8rem;color:var(--text-muted);line-height:1.6;margin:6px 0 0;">Chaque champ est extrait avec sa citation (page + extrait verbatim), vérifiée automatiquement contre le texte réel du document — un champ dont la citation ne se retrouve pas n'est jamais affiché comme un fait. Les indicateurs sont ensuite recalculés par du code déterministe, jamais par le modèle.</p>
        <div class="workflow-stage">
          <div class="workflow-stage-title">1 · Fiche d'identité du bien</div>
          <div class="workflow-fields">${Object.values(FICHE_LABELS).map(chip).join('')}</div>
        </div>
        <div class="workflow-stage">
          <div class="workflow-stage-title">2 · État locatif (rent roll)</div>
          <div class="workflow-fields">${rentRollFields.map(chip).join('')}</div>
        </div>
        <div class="workflow-stage">
          <div class="workflow-stage-title">3 · Compte d'exploitation (T12) &amp; répartition des surfaces</div>
          <div class="workflow-fields">${['Poste par poste (produits / charges)', 'Montants annuels', 'Tranches de surface', 'Loyer moyen par tranche'].map(chip).join('')}</div>
        </div>
        <div class="workflow-stage">
          <div class="workflow-stage-title">4 · Signaux de risque (uniquement s'ils sont explicites dans le document)</div>
          <div class="workflow-fields">${signauxFields.map(chip).join('')}</div>
        </div>
        <div class="workflow-stage">
          <div class="workflow-stage-title">5 · Calculs déterministes (aucun appel au modèle)</div>
          <div class="workflow-fields">${indicateursFields.map(chip).join('')}</div>
        </div>
        <p class="workflow-note">D'autres modèles (abstraction de baux individuels, T12 seul, rapports techniques PCA/ESG) nécessitent de nouvelles extractions dédiées — ils ne figurent pas ici tant qu'ils n'existent pas réellement.</p>
      </div>`;
  }

  // ================= VÉRIFICATION (affirmations du vendeur) ================= //
  // Repère les affirmations marketing du vendeur (extraction.js), verifie
  // leur citation contre le document reel (verification.js -- une
  // affirmation dont la citation ne se retrouve pas n'arrive JAMAIS jusqu'ici,
  // rejetee cote serveur), puis confronte chacune a une vraie recherche web
  // contextuelle au dossier (webSearch.js#verifyClaimAgainstWeb). Declenche
  // manuellement (comme l'onglet Contexte), avec un affichage PROGRESSIF par
  // SSE plutot qu'une attente bloquante : chaque affirmation implique une
  // vraie recherche web (10-25s observees), donc un lot peut prendre
  // plusieurs minutes.
  const VERIFICATION_DOT_CLASS = { confirme: 'green', nuance: 'amber', contredit: 'pink', donnees_insuffisantes: 'faint' };
  const VERIFICATION_VERDICT_LABELS = { confirme: 'Confirmé', nuance: 'Nuancé', contredit: 'Contredit', donnees_insuffisantes: 'Données insuffisantes' };
  const VERIFICATION_RELIABILITY_LABELS = { officielle: 'Source officielle', a_confirmer: 'À vérifier vous-même' };

  // Favicon reel du domaine source (service public Google, pas de cle) --
  // purement decoratif, degrade proprement (icone cassee) si indisponible,
  // jamais un blocage de l'affichage.
  function faviconUrl(url) { return `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(url)}`; }
  // Pastille compacte (icones + "N sources") plutot qu'une liste de liens
  // jaunes deployee par defaut -- clic pour deployer/replier la vraie liste
  // (liens neutres, jamais colores, voir CSS .verification-source-link).
  function renderClaimSourcesHTML(claim) {
    const sources = claim.sources || [];
    if (!sources.length) return '';
    const pillFavicons = sources.slice(0, 3).map(s => `<img src="${faviconUrl(s.url)}" alt="" loading="lazy">`).join('');
    const list = sources.map(s => `
        <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="verification-source-link">
          <img src="${faviconUrl(s.url)}" alt="" loading="lazy">
          <span>${escapeHtml(s.title || s.url)}</span>
          <span class="verification-reliability">${VERIFICATION_RELIABILITY_LABELS[s.reliability] || 'À vérifier vous-même'}</span>
        </a>`).join('');
    return `<button type="button" class="verification-sources-pill" data-toggle-sources="${claim.id}">
        <span class="vsp-favicons">${pillFavicons}</span>
        <span class="vsp-count">${sources.length} source${sources.length > 1 ? 's' : ''}</span>
      </button>
      <div class="verification-sources-list" id="vsl-${claim.id}">${list}</div>`;
  }
  function renderClaimCard(claim) {
    const dotClass = claim.verdict ? (VERIFICATION_DOT_CLASS[claim.verdict] || '') : '';
    return `<div class="audit-card ${dotClass}" data-claim-id="${claim.id}">
      <span class="dot ${dotClass}" data-reveal="dot"></span>
      <div style="flex:1;">
        <div class="flag-header"><span class="flag-title" data-reveal="title">${escapeHtml(claim.theme || '')}</span><span class="chip status-draft" data-reveal="chip">${claim.verdict ? (VERIFICATION_VERDICT_LABELS[claim.verdict] || '') : 'Recherche en cours…'}</span></div>
        <div class="flag-body" data-reveal="claim">${escapeHtml(claim.claimText || '')}</div>
        <div class="audit-card-actions" data-reveal="cite">
          <button class="cite-link" data-open-page="${claim.page}" data-open-quote="${(claim.quote || '').replace(/"/g, '&quot;')}">Voir la citation — page ${claim.page} →</button>
        </div>
        <div class="verification-justification" data-reveal="justification">${claim.justification ? escapeHtml(claim.justification) : ''}</div>
        <div data-reveal="sources">${renderClaimSourcesHTML(claim)}</div>
      </div>
    </div>`;
  }
  function bindClaimCiteButtons(root) {
    root.querySelectorAll('[data-open-page]').forEach(b => b.addEventListener('click', () => openSourceModal(b.dataset.openPage, b.dataset.openQuote)));
    root.querySelectorAll('[data-toggle-sources]').forEach(b => b.addEventListener('click', () => {
      document.getElementById('vsl-' + b.dataset.toggleSources)?.classList.toggle('open');
    }));
  }
  // Ne construit PAS les cartes ici : elles ne doivent jamais etre visibles
  // avant que l'analyste soit reellement sur l'onglet (voir
  // playVerificationReveal, qui les construit une a une a l'arrivee). Se
  // contente de choisir prompt vs cartes et de vider le conteneur -- sinon
  // un ancien rendu resterait affiche tel quel avant la prochaine visite.
  function renderVerification(doc) {
    const prompt = document.getElementById('verificationGeneratePrompt');
    const cardsEl = document.getElementById('verificationCards');
    const btn = document.getElementById('verificationGenerateBtn');
    const claims = doc.vendorClaims || [];
    cardsEl.innerHTML = '';
    if (!claims.length) {
      prompt.style.display = 'flex';
      cardsEl.style.display = 'none';
      btn.disabled = doc.status !== 'complete';
      return;
    }
    prompt.style.display = 'none';
    cardsEl.style.display = 'block';
  }
  // Effet "generation en direct" : chaque PARTIE d'une carte (pastille de
  // statut, titre, badge de verdict, citation extraite, bouton source
  // document, justification, pastille de sources) apparait l'une apres
  // l'autre -- jamais tout d'un coup -- pour donner l'impression que
  // l'agent construit la carte sous nos yeux, pas seulement le paragraphe
  // de justification. Les parties textuelles (titre/citation/justification)
  // se reecrivent caractere par caractere (revealHtmlInto, meme mecanisme
  // que les reponses de l'Assistant) ; les elements non textuels (pastille,
  // badge, bouton, sources) apparaissent en fondu. Toujours lu depuis le
  // DOM deja rendu (jamais depuis l'objet claim brut) : cette fonction peut
  // donc rejouer indifferemment un resultat deja en base ou tout juste
  // ecrit par renderClaimCard.
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  // Etape 1 (100% synchrone, AUCUN await) : vide/masque TOUTES les parties
  // demandees d'un coup, avant meme de commencer a en reveler une seule --
  // sinon, entre l'ajout de la carte au DOM et le premier await (le fondu
  // du point de statut, ~160ms), le navigateur peut peindre une image ou
  // titre/citation/justification/sources affichent encore leur contenu
  // FINAL en clair, le temps que la boucle les atteigne. Etape 2 : revele
  // chaque partie dans l'ordre.
  async function revealClaimCardParts(cardEl, parts) {
    const items = parts.map(part => {
      const el = cardEl.querySelector(`[data-reveal="${part}"]`);
      if (!el) return null;
      if (part === 'title' || part === 'claim' || part === 'justification') {
        const text = el.textContent;
        el.textContent = '';
        return { part, el, text };
      }
      el.style.transition = 'opacity .25s var(--ease)';
      el.style.opacity = '0';
      return { part, el };
    });
    for (const item of items) {
      if (!item) continue;
      if (item.part === 'title' || item.part === 'claim' || item.part === 'justification') {
        if (!item.text) continue;
        await revealHtmlInto(item.el, escapeHtml(item.text), { charsPerTick: item.part === 'title' ? 2 : 3 });
      } else {
        void item.el.offsetWidth; // force le navigateur a appliquer opacity:0 avant de repasser a 1, sinon pas de transition visible
        item.el.style.opacity = '1';
        await sleep(160);
      }
    }
  }
  const CLAIM_REVEAL_FULL = ['dot', 'title', 'chip', 'claim', 'cite', 'justification', 'sources'];
  const CLAIM_REVEAL_RESULT_ONLY = ['chip', 'justification', 'sources'];
  // Construit les cartes UNE A LA FOIS a partir des donnees brutes (jamais
  // depuis un DOM deja rendu) : le conteneur est vide au depart (aucune
  // carte, pas meme un contour vide) et chaque carte n'est ajoutee au DOM
  // qu'au moment ou son tour arrive, une fois la precedente entierement
  // revelee -- sinon les cartes suivantes resteraient visibles tout du long
  // pendant qu'une seule s'anime, ce qui n'a rien d'une "construction
  // progressive". Une seule fois par dossier et par session (voir
  // revealedOnce) : les visites suivantes affichent toutes les cartes
  // directement, sans rejouer l'effet -- jamais un nouvel appel API dans
  // les deux cas, purement une animation sur des donnees deja en base.
  async function playVerificationReveal() {
    const cardsEl = document.getElementById('verificationCards');
    if (!cardsEl || cardsEl.style.display === 'none') return;
    const claims = currentDoc?.vendorClaims || [];
    if (!claims.length) return;
    const key = `verification-${currentDoc.id}`;
    if (revealedOnce.has(key)) {
      cardsEl.innerHTML = claims.map(renderClaimCard).join('');
      bindClaimCiteButtons(cardsEl);
      return;
    }
    revealedOnce.add(key);
    cardsEl.innerHTML = '';
    for (const claim of claims) {
      const wrap = document.createElement('div');
      wrap.innerHTML = renderClaimCard(claim);
      const cardEl = wrap.firstElementChild;
      cardsEl.appendChild(cardEl);
      bindClaimCiteButtons(cardEl);
      await revealClaimCardParts(cardEl, CLAIM_REVEAL_FULL);
    }
  }
  document.getElementById('verificationGenerateBtn').addEventListener('click', async () => {
    const btn = document.getElementById('verificationGenerateBtn');
    const prompt = document.getElementById('verificationGeneratePrompt');
    const statusEl = document.getElementById('verificationStatus');
    const cardsEl = document.getElementById('verificationCards');
    btn.disabled = true;
    statusEl.style.display = 'block';
    statusEl.textContent = 'Repérage des affirmations du dossier…';
    try {
      await streamSSE(`/api/documents/${currentDoc.id}/vendor-claims`, {}, evt => {
        if (evt.type === 'claims_found') {
          prompt.style.display = 'none';
          cardsEl.style.display = 'block';
          statusEl.textContent = evt.claims.length
            ? `${evt.claims.length} affirmation(s) repérée(s) — recherche des sources en cours…`
            : "Aucune affirmation marketing vérifiable repérée dans ce document.";
          cardsEl.innerHTML = evt.claims.map(c => renderClaimCard({ ...c, verdict: null, justification: '', sources: [] })).join('');
          bindClaimCiteButtons(cardsEl);
          // Squelettes reveles en parallele (pas de justification/sources a
          // ce stade, juste dot/titre/badge "Recherche en cours…"/citation).
          cardsEl.querySelectorAll('.audit-card[data-claim-id]').forEach(cardEl => revealClaimCardParts(cardEl, ['dot', 'title', 'chip', 'claim', 'cite']));
        } else if (evt.type === 'claim_result') {
          // Le squelette (titre/citation) est deja revele -- seuls le
          // badge de verdict, la justification et les sources sont NOUVEAUX,
          // donc les seuls reveles ici (jamais un flash de tout le texte
          // deja affiche).
          const card = cardsEl.querySelector(`[data-claim-id="${evt.claim.id}"]`);
          if (card) {
            card.outerHTML = renderClaimCard({ ...evt.claim, justification: '' });
            bindClaimCiteButtons(cardsEl);
            const newCard = cardsEl.querySelector(`[data-claim-id="${evt.claim.id}"]`);
            const justificationEl = newCard?.querySelector('[data-reveal="justification"]');
            if (justificationEl) justificationEl.textContent = evt.claim.justification || '';
            if (newCard) revealClaimCardParts(newCard, CLAIM_REVEAL_RESULT_ONLY);
          }
        } else if (evt.type === 'claim_error') {
          const body = cardsEl.querySelector(`[data-claim-id="${evt.id}"] .flag-body`);
          body?.insertAdjacentHTML('afterend', `<div class="audit-card-impact">Recherche indisponible pour cette affirmation (${escapeHtml(evt.error || '')}).</div>`);
        } else if (evt.type === 'done') {
          statusEl.style.display = 'none';
          // L'analyste vient de regarder les cartes se construire EN
          // DIRECT (vrai flux SSE) -- inutile de rejouer l'effet une
          // deuxieme fois si il quitte l'onglet puis revient juste apres.
          if (currentDoc) revealedOnce.add(`verification-${currentDoc.id}`);
        } else if (evt.type === 'error') {
          statusEl.textContent = `Erreur : ${evt.error}`;
        }
      });
    } catch (err) {
      statusEl.textContent = `Erreur : ${err.message}`;
    } finally {
      btn.disabled = false;
      currentDoc = await fetchDocument(currentDoc.id);
    }
  });

  // ================= RÉGLAGES DU FONDS ================= //
  async function loadSettingsForm() {
    const criteria = await fetch('/api/settings/fund-criteria').then(r => r.json()).catch(() => ({}));
    document.getElementById('settingsTailleMin').value = criteria.tailleMin ?? '';
    document.getElementById('settingsTailleMax').value = criteria.tailleMax ?? '';
    document.getElementById('settingsTypologies').value = (criteria.typologies || []).join(', ');
    document.getElementById('settingsLocalisation').value = criteria.localisation ?? '';
    document.getElementById('settingsRendement').value = criteria.rendementCibleMin ?? '';
    document.querySelectorAll('#criteriaNatures [data-nature]').forEach(cb => {
      cb.checked = criteria.natures?.[cb.dataset.nature] !== 'negociable';
    });
  }
  document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
    const natures = {};
    document.querySelectorAll('#criteriaNatures [data-nature]').forEach(cb => {
      natures[cb.dataset.nature] = cb.checked ? 'eliminatoire' : 'negociable';
    });
    const body = {
      tailleMin: parseFloat(document.getElementById('settingsTailleMin').value) || null,
      tailleMax: parseFloat(document.getElementById('settingsTailleMax').value) || null,
      typologies: document.getElementById('settingsTypologies').value.split(',').map(s => s.trim()).filter(Boolean),
      localisation: document.getElementById('settingsLocalisation').value.trim() || null,
      rendementCibleMin: parseFloat(document.getElementById('settingsRendement').value) || null,
      natures,
    };
    const errEl = document.getElementById('settingsError');
    if (errEl) errEl.style.display = 'none';
    const res = await fetch('/api/settings/fund-criteria', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      // Bornes aberrantes rejetees par le serveur : l'erreur s'affiche,
      // rien n'est enregistre.
      const d = await res.json().catch(() => ({}));
      if (errEl) { errEl.textContent = d.error || 'Enregistrement refusé.'; errEl.style.display = 'inline'; }
      return;
    }
    const saved = document.getElementById('settingsSaved');
    saved.style.display = 'inline';
    setTimeout(() => { saved.style.display = 'none'; }, 2000);
  });

  // ================= MON COMPTE ================= //
  function showAccountFeedback(elId, message, ok) {
    const el = document.getElementById(elId);
    el.textContent = message;
    el.style.color = ok ? 'var(--green)' : 'var(--pink)';
    el.style.display = 'inline';
  }
  function renderAccountMembers(members) {
    const list = document.getElementById('accountMembersList');
    if (!members.length) { list.innerHTML = '<div class="dossiers-empty">Aucun membre.</div>'; return; }
    const fmtDate = iso => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    list.innerHTML = members.map(m => `
      <div class="account-member-row">
        <div>
          <div class="account-member-email">${escapeHtml(m.email)}${m.isYou ? ' <span class="chip conf-mid">VOUS</span>' : ''}</div>
          <div class="label">Ajouté le ${fmtDate(m.createdAt) || '—'} · Dernière connexion : ${fmtDate(m.lastLoginAt) || 'jamais'}</div>
        </div>
        ${m.isYou ? '' : `<button class="dossier-row-delete" data-remove-member="${m.id}" title="Retirer">✕</button>`}
      </div>`).join('');
    list.querySelectorAll('[data-remove-member]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Retirer ce membre de l\'espace de travail ? Il perdra immédiatement l\'accès aux dossiers.')) return;
      await fetch(`/api/workspace/members/${btn.dataset.removeMember}`, { method: 'DELETE' });
      loadAccountForm();
    }));
  }
  async function loadAccountForm() {
    const [me, ws, members] = await Promise.all([
      fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/workspace').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/workspace/members').then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
    if (me) document.getElementById('accountEmail').value = me.email;
    document.getElementById('accountAdminLink').style.display = me?.isSuperAdmin ? '' : 'none';
    document.getElementById('accountWorkspaceLabel').textContent = ws ? `ESPACE DE TRAVAIL — ${ws.name.toUpperCase()}` : 'ESPACE DE TRAVAIL';
    renderAccountMembers(Array.isArray(members) ? members : []);
  }
  document.getElementById('accountPasswordSaveBtn').addEventListener('click', async () => {
    const btn = document.getElementById('accountPasswordSaveBtn');
    const feedback = document.getElementById('accountPasswordFeedback');
    feedback.style.display = 'none';
    const currentPassword = document.getElementById('accountCurrentPassword').value;
    const newPassword = document.getElementById('accountNewPassword').value;
    const confirmPassword = document.getElementById('accountNewPasswordConfirm').value;
    if (newPassword !== confirmPassword) return showAccountFeedback('accountPasswordFeedback', 'La confirmation ne correspond pas au nouveau mot de passe.', false);
    btn.disabled = true;
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec de la mise à jour.');
      document.getElementById('accountCurrentPassword').value = '';
      document.getElementById('accountNewPassword').value = '';
      document.getElementById('accountNewPasswordConfirm').value = '';
      showAccountFeedback('accountPasswordFeedback', 'Mot de passe mis à jour.', true);
    } catch (err) {
      showAccountFeedback('accountPasswordFeedback', err.message, false);
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('accountAddMemberBtn').addEventListener('click', async () => {
    const btn = document.getElementById('accountAddMemberBtn');
    const feedback = document.getElementById('accountMemberFeedback');
    feedback.style.display = 'none';
    const email = document.getElementById('accountNewMemberEmail').value.trim();
    const password = document.getElementById('accountNewMemberPassword').value;
    btn.disabled = true;
    try {
      const res = await fetch('/api/workspace/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec de l'ajout.");
      document.getElementById('accountNewMemberEmail').value = '';
      document.getElementById('accountNewMemberPassword').value = '';
      showAccountFeedback('accountMemberFeedback', 'Membre ajouté.', true);
      await loadAccountForm();
    } catch (err) {
      showAccountFeedback('accountMemberFeedback', err.message, false);
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('accountLogoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });

  // ================= PRÉSENTATION (deck comité, design sombre) ================= //
  // Navigation/plein ecran/export du deck -- le contenu lui-meme (slides
  // reelles) est injecte dans #dpStage par openPresentationDeck() juste
  // avant l'ouverture, donc les slides sont re-interrogees a chaque open()
  // plutot que capturees une fois (leur nombre varie selon le dossier :
  // simulateur verrouille ou non, etc.).
  const dpOverlay = document.getElementById('deckPreviewOverlay');
  const dpPrevBtn = document.getElementById('dpPrevBtn');
  const dpNextBtn = document.getElementById('dpNextBtn');
  const dpCounter = document.getElementById('dpCurrent');
  const dpTotalEl = document.getElementById('dpTotal');
  let dpIdx = 0;

  function dpSlides() { return Array.from(document.getElementById('dpStage').querySelectorAll('.dp-slide')); }
  function dpShowSlide(i) {
    const slides = dpSlides();
    dpIdx = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, j) => s.classList.toggle('active', j === dpIdx));
    dpCounter.textContent = String(dpIdx + 1);
    dpTotalEl.textContent = String(slides.length);
    dpPrevBtn.disabled = dpIdx === 0;
    dpNextBtn.disabled = dpIdx === slides.length - 1;
  }
  function dpClose() {
    dpOverlay.style.display = 'none';
    document.removeEventListener('keydown', dpOnKeydown);
    if (document.fullscreenElement === dpOverlay) document.exitFullscreen().catch(() => {});
  }
  function dpOnKeydown(e) {
    if (e.key === 'Escape') dpClose();
    else if (e.key === 'ArrowRight') dpShowSlide(dpIdx + 1);
    else if (e.key === 'ArrowLeft') dpShowSlide(dpIdx - 1);
  }
  document.getElementById('dpCloseBtn').addEventListener('click', dpClose);
  dpPrevBtn.addEventListener('click', () => dpShowSlide(dpIdx - 1));
  dpNextBtn.addEventListener('click', () => dpShowSlide(dpIdx + 1));
  document.getElementById('dpFullscreenBtn').addEventListener('click', () => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    if (dpOverlay.requestFullscreen) dpOverlay.requestFullscreen().catch(() => {});
  });
  document.getElementById('dpPrintBtn').addEventListener('click', () => printCurrentSheet(document.getElementById('dpStage').innerHTML));
  // Export Google Slides : necessite une integration serveur (API Google +
  // OAuth) qui n'existe pas encore -- bouton honnete, pas de fausse promesse.
  const dpExportBtn = document.getElementById('dpExportBtn');
  dpExportBtn.addEventListener('click', () => {
    const original = dpExportBtn.textContent;
    dpExportBtn.textContent = 'Bientôt disponible';
    setTimeout(() => { dpExportBtn.textContent = original; }, 2200);
  });

  // Écran de chargement de la génération de la Présentation -- même
  // animation que l'import d'un dossier / la génération du Contexte (voir
  // startContexteOverlayPhrases plus bas), avec un titre qui défile sur des
  // phrases indicatives du travail réel effectué (assemblage de données déjà
  // extraites/vérifiées, pas un nouvel appel au modèle).
  const PRESENTATION_PHRASES = [
    'Reprise des données vérifiées du dossier…',
    'Assemblage des indicateurs et de la situation locative…',
    'Mise en page du deck…',
    'Vérification des citations sources…',
  ];
  let presentationOverlayTimer = null;
  function startPresentationOverlayPhrases() {
    const title = document.getElementById('presentationOverlayTitle');
    let i = 0;
    title.textContent = PRESENTATION_PHRASES[0];
    presentationOverlayTimer = setInterval(() => { i = (i + 1) % PRESENTATION_PHRASES.length; title.textContent = PRESENTATION_PHRASES[i]; }, 1100);
  }
  function stopPresentationOverlayPhrases() {
    if (presentationOverlayTimer) clearInterval(presentationOverlayTimer);
    presentationOverlayTimer = null;
  }
  document.getElementById('presentationOverlayCloseBtn').addEventListener('click', () => {
    stopPresentationOverlayPhrases();
    const overlay = document.getElementById('presentationOverlay');
    overlay.style.display = 'none';
    overlay.classList.remove('error');
  });

  // Point d'entrée unique pour ouvrir la Présentation (rail du dossier ET
  // action "génère la présentation" de l'Assistant) : écran de chargement,
  // construction des slides depuis les vraies données, puis ouverture du
  // deck -- jamais un saut instantané, jamais de contenu d'exemple.
  // Rebranche les boutons "Voir la source" et le champ de date du comité
  // sur le contenu de #dpStage qui vient d'être (re)généré -- utilisé à la
  // fois par openPresentationDeck, setSimulationSnapshot (verrouillage du
  // Simulateur) et l'opération "regenerate" du copilote de la Présentation.
  // Applique un changement de visibilite de carte cote serveur puis
  // reconstruit la diapositive (meme mecanisme que "regenerate"/"edit_field"
  // dans dpApplyOp) -- jamais un simple retrait DOM local, pour que l'etat
  // survive a une regeneration ulterieure de la presentation.
  async function patchPresentationHiddenCards(docId, body) {
    await fetch(`/api/documents/${docId}/presentation-hidden-cards`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    currentDoc = await fetchDocument(docId);
    const html = await buildDeckHTML(currentDoc);
    document.getElementById('dpStage').innerHTML = html;
    wireDpStage(currentDoc);
    dpShowSlide(dpIdx);
  }
  function wireDpStage(doc) {
    document.getElementById('dpStage').querySelectorAll('[data-open-page]').forEach(btn =>
      btn.addEventListener('click', () => openSourceModal(btn.dataset.openPage, btn.dataset.openQuote)));
    document.getElementById('dpStage').querySelectorAll('[data-hide-card]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        patchPresentationHiddenCards(doc.id, { cardId: btn.dataset.hideCard, hidden: true });
      }));
    // Reaffichage individuel (placeholder d'un bloc a slot fixe, ex: colonne
    // d'un `.dp-split`) -- un seul id, jamais un reset global.
    document.getElementById('dpStage').querySelectorAll('[data-show-card]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        patchPresentationHiddenCards(doc.id, { cardId: btn.dataset.showCard, hidden: false });
      }));
    // "Réafficher tout" scope a UNE diapositive (liste d'ids precalculee
    // cote serveur au rendu, voir slideResetNote) -- jamais un reset global,
    // qui effacerait aussi ce qui est masque sur les AUTRES diapositives.
    document.getElementById('dpStage').querySelectorAll('[data-unhide-ids]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        patchPresentationHiddenCards(doc.id, { cardIds: btn.dataset.unhideIds.split(','), hidden: false });
      }));
    const comiteInput = document.getElementById('dpComiteDateInput');
    if (comiteInput) comiteInput.addEventListener('change', () => {
      try { localStorage.setItem('leez.comiteDate.' + doc.id, comiteInput.value); } catch { /* localStorage indisponible : non bloquant */ }
    });
  }
  async function openPresentationDeck(doc) {
    if (!doc) return;
    if (doc.status !== 'complete') {
      assistantChatRow('assistant', `<p class="assistant-caveat">L'extraction de ce dossier doit être terminée avant de générer la présentation.</p>`);
      return;
    }
    const overlay = document.getElementById('presentationOverlay');
    const overlayError = document.getElementById('presentationOverlayError');
    const overlayCloseBtn = document.getElementById('presentationOverlayCloseBtn');
    overlay.classList.remove('complete', 'error');
    overlayError.style.display = 'none';
    overlayCloseBtn.style.display = 'none';
    overlay.style.display = 'flex';
    startPresentationOverlayPhrases();
    try {
      const [html] = await Promise.all([
        buildDeckHTML(doc),
        new Promise(r => setTimeout(r, 900)), // durée minimale perçue, cohérente avec l'écran d'import
      ]);
      document.getElementById('dpStage').innerHTML = html;
      wireDpStage(doc);
      stopPresentationOverlayPhrases();
      overlay.classList.add('complete');
      setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.remove('complete');
        dpOverlay.style.display = 'flex';
        dpShowSlide(0);
        document.addEventListener('keydown', dpOnKeydown);
      }, 700);
    } catch (err) {
      stopPresentationOverlayPhrases();
      overlay.classList.add('error');
      overlayError.style.display = 'block';
      overlayError.textContent = err.message || 'Échec de la génération de la présentation.';
      overlayCloseBtn.style.display = 'inline-block';
    }
  }
  document.getElementById('presentationRailBtn')?.addEventListener('click', () => openPresentationDeck(currentDoc));

  // ================= COPILOTE DE LA PRÉSENTATION (barre flottante) =================
  // Exactement le meme composant visuel que #simFloatChat sur le Simulateur
  // (memes classes .sim-float-*, meme glisser-deposer) et le meme patron
  // "le modele choisit UNIQUEMENT quelle operation, le client l'execute
  // avec des fonctions deja existantes" que interpretSimCopilot -- sauf
  // qu'ici aucune operation ne peut jamais reecrire une donnee verifiee du
  // dossier : uniquement la navigation/l'affichage de la presentation elle-
  // meme (diapositive, date du comite, plein ecran, impression,
  // regeneration, fermeture). Voir server/services/promptPresentation.js.
  const DP_SLIDE_KEYS = ['hero', 'synthese', 'actif', 'locatif', 'echeancier', 'previsionnel', 'rendements', 'vigilance', 'recommandation'];
  const DP_SLIDE_LABELS = {
    hero: 'Titre', synthese: 'Synthèse exécutive', actif: 'Actif & localisation', locatif: 'Analyse locative',
    echeancier: 'Échéancier des baux', previsionnel: 'Prévisionnel financier', rendements: 'Rendements & hypothèses',
    vigilance: 'Points de vigilance', recommandation: 'Recommandation',
  };
  // Image jointe au prochain message (ex: "mets cette image en fond") --
  // l'image elle-meme reste opaque au modele de classification (texte
  // seul lui est envoye, voir sendPresentationPrompt) : seul son
  // EMPLACEMENT (couverture / carte de situation) est choisi par le
  // modele, l'upload reel est un appel deterministe vers l'endpoint deja
  // existant des documents annexes (memes categorie/type que l'onglet
  // Documents -- aucun nouveau pipeline de stockage).
  let dpAttachedFile = null;
  function setDpAttachedFile(file) {
    dpAttachedFile = file;
    const chip = document.getElementById('dpAttachChip');
    if (file) { document.getElementById('dpAttachChipName').textContent = file.name; chip.style.display = 'flex'; }
    else chip.style.display = 'none';
  }
  document.getElementById('dpAttachBtn')?.addEventListener('click', () => document.getElementById('dpAttachInput').click());
  document.getElementById('dpAttachInput')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) setDpAttachedFile(file);
    e.target.value = '';
  });
  document.getElementById('dpAttachChipRemove')?.addEventListener('click', () => setDpAttachedFile(null));

  // Mode aperçu du copilote : classification LOCALE par mots-clés, sans
  // appel au modèle (aucun crédit API consommé) -- pour tester la
  // navigation, la date du comité ou une correction de champ. Beaucoup plus
  // sommaire que le vrai classificateur (promptPresentation.js) : pas
  // censée comprendre une formulation complexe, juste démontrer le
  // mécanisme d'exécution déterministe (dpApplyOp), exactement comme le
  // bouton "Test" de l'import prévisualise l'animation sans appel réel.
  let dpPreviewMode = false;
  const DP_MOCK_SLIDE_KEYWORDS = {
    hero: ['titre', 'couverture', 'accueil'],
    synthese: ['synthese', 'synthèse', 'executive', 'résumé', 'resume'],
    actif: ['actif', 'localisation'],
    locatif: ['locatif', 'analyse locative', 'loyer moyen'],
    echeancier: ['echeancier', 'échéancier', 'bail', 'baux', 'concentration'],
    previsionnel: ['previsionnel', 'prévisionnel', 'noi'],
    rendements: ['rendement', 'tri', 'moic', 'hypothese', 'hypothèse'],
    vigilance: ['vigilance', 'risque'],
    recommandation: ['recommandation', 'conclusion', 'verdict'],
  };
  const DP_MOCK_FIELD_PATTERNS = [
    { field: 'prixDemande', re: /\bprix\b[^0-9]*([\d\s.,]{3,})/i, numeric: true },
    { field: 'surfaceLocativeGLA', re: /\bsurface\b[^0-9]*([\d\s.,]{2,})/i, numeric: true },
    { field: 'anneeConstruction', re: /ann[ée]e? de construction\b[^0-9]*(\d{4})/i, numeric: true },
    { field: 'nombreLots', re: /\blots?\b[^0-9]*(\d+)/i, numeric: true },
    { field: 'placesParking', re: /\bparkings?\b[^0-9]*(\d+)/i, numeric: true },
    { field: 'classeDPE', re: /\bdpe\b[^a-zA-Z]*([a-gA-G])\b/i, numeric: false },
  ];
  function mockInterpretPresentationPrompt(prompt, context) {
    const text = String(prompt || '').toLowerCase();
    if (context?.hasImageAttached && /(image|photo|fond|arri[eè]re-plan|couverture|carte)/.test(text)) {
      const photoType = /(carte|situation)/.test(text) ? 'Carte de situation' : 'Photo de couverture';
      return { supported: true, reason: "Aperçu : association de l'image jointe.", operations: [{ type: 'attach_photo', photoType }] };
    }
    if (/\bdate\b/.test(text) && /comit[ée]/.test(text)) {
      const m = prompt.match(/(\d{1,2}\s+\w+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
      return { supported: true, reason: 'Aperçu : mise à jour de la date du comité.', operations: [{ type: 'set_comite_date', comiteDate: m ? m[0] : prompt.trim() }] };
    }
    if (/plein[\s-]?[ée]cran|fullscreen/.test(text)) {
      return { supported: true, reason: 'Aperçu : bascule plein écran.', operations: [{ type: 'fullscreen', fullscreenAction: 'toggle' }] };
    }
    if (/imprim|export.*pdf/.test(text)) {
      return { supported: true, reason: "Aperçu : lancement de l'impression.", operations: [{ type: 'print' }] };
    }
    if (/r[ée]g[ée]n[èe]re|actualise/.test(text)) {
      return { supported: true, reason: 'Aperçu : régénération de la présentation.', operations: [{ type: 'regenerate' }] };
    }
    if (/\bferme\b|\bquitte\b/.test(text)) {
      return { supported: true, reason: 'Aperçu : fermeture de la présentation.', operations: [{ type: 'close' }] };
    }
    for (const p of DP_MOCK_FIELD_PATTERNS) {
      const m = prompt.match(p.re);
      if (m) {
        const value = p.numeric ? m[1].trim().replace(/\s/g, '').replace(',', '.') : m[1].trim().toUpperCase();
        return { supported: true, reason: 'Aperçu : correction de champ.', operations: [{ type: 'edit_field', field: p.field, fieldValue: value }] };
      }
    }
    for (const [slide, keywords] of Object.entries(DP_MOCK_SLIDE_KEYWORDS)) {
      if (keywords.some(k => text.includes(k))) {
        return { supported: true, reason: 'Aperçu : navigation entre diapositives.', operations: [{ type: 'goto_slide', slide }] };
      }
    }
    return {
      supported: false,
      reason: "Mode aperçu (règles locales simples, pas d'appel au modèle) : aucune commande reconnue. Essayez par exemple « va à la conclusion », « mets la date du comité au 15 septembre 2026 » ou « le prix demandé est en fait 4 300 000 ».",
    };
  }
  document.getElementById('dpPreviewModeBtn')?.addEventListener('click', () => {
    dpPreviewMode = !dpPreviewMode;
    const btn = document.getElementById('dpPreviewModeBtn');
    btn.classList.toggle('active', dpPreviewMode);
    document.getElementById('dpFloatInput').placeholder = dpPreviewMode
      ? 'Mode aperçu (sans crédits) — ex. « va à la conclusion », « le prix demandé est en fait 4 300 000 »…'
      : 'Demandez quelque chose à la présentation…';
    document.getElementById('dpBadge').textContent = dpPreviewMode
      ? 'PRÉSENTATION COMITÉ — MODE APERÇU (COPILOTE SANS APPEL RÉEL)'
      : 'PRÉSENTATION COMITÉ — DONNÉES VÉRIFIÉES';
  });

  async function dpApplyOp(op, preview) {
    if (op.type === 'goto_slide' && op.slide !== 'none') {
      const idx = DP_SLIDE_KEYS.indexOf(op.slide);
      if (idx < 0) return null;
      dpShowSlide(idx);
      return `Diapositive : ${DP_SLIDE_LABELS[op.slide]}.`;
    }
    if (op.type === 'set_comite_date') {
      const input = document.getElementById('dpComiteDateInput');
      if (!input) return null;
      input.value = op.comiteDate;
      input.dispatchEvent(new Event('change'));
      return `Date du comité mise à jour : ${op.comiteDate || 'à définir'}.`;
    }
    if (op.type === 'fullscreen') {
      const exiting = op.fullscreenAction === 'exit' || (op.fullscreenAction !== 'enter' && document.fullscreenElement);
      if (exiting) { document.exitFullscreen().catch(() => {}); return 'Plein écran désactivé.'; }
      if (dpOverlay.requestFullscreen) dpOverlay.requestFullscreen().catch(() => {});
      return 'Plein écran activé.';
    }
    if (op.type === 'print') {
      printCurrentSheet(document.getElementById('dpStage').innerHTML);
      return 'Impression lancée.';
    }
    if (op.type === 'regenerate') {
      if (!currentDoc) return null;
      const html = await buildDeckHTML(currentDoc);
      document.getElementById('dpStage').innerHTML = html;
      wireDpStage(currentDoc);
      dpShowSlide(dpIdx);
      return 'Présentation régénérée avec les données actuelles.';
    }
    if (op.type === 'attach_photo') {
      if (!dpAttachedFile || !currentDoc) return "Aucune image jointe -- utilisez le trombone avant d'envoyer.";
      const photoType = op.photoType === 'Carte de situation' ? 'Carte de situation' : 'Photo de couverture';
      if (preview) {
        return `Aperçu — l'image « ${dpAttachedFile.name} » serait ajoutée comme ${photoType.toLowerCase()} (aucun fichier réellement envoyé en mode aperçu).`;
      }
      try {
        const fd = new FormData();
        fd.append('supportingFiles', dpAttachedFile);
        fd.append('supportingMeta', JSON.stringify([{ category: 'photos', type: photoType }]));
        const res = await fetch(`/api/documents/${currentDoc.id}/supporting`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error("Échec de l'envoi de l'image.");
        setDpAttachedFile(null);
        const html = await buildDeckHTML(currentDoc);
        document.getElementById('dpStage').innerHTML = html;
        wireDpStage(currentDoc);
        dpShowSlide(dpIdx);
        return `Image ajoutée (${photoType.toLowerCase()}) et présentation régénérée.`;
      } catch (err) {
        return `Erreur lors de l'envoi de l'image : ${err.message}`;
      }
    }
    if (op.type === 'edit_field') {
      if (!currentDoc || op.field === 'none') return null;
      if (preview) {
        return `Aperçu — ${FICHE_LABELS[op.field] || op.field} serait mis à jour : ${formatFicheValue(op.field, op.fieldValue) ?? op.fieldValue} (aucune donnée réelle modifiée en mode aperçu).`;
      }
      // Meme mecanisme reel que l'edition manuelle dans l'onglet Donnees
      // (patchField/PATCH .../edit) : le champ est marque "edited": true
      // (badge MODIFIÉ, citation d'origine conservee pour tracabilite) --
      // la valeur vient explicitement de l'analyste, jamais inventee par
      // le modele, qui n'a fait que router vers le bon champ.
      try {
        const res = await fetch(`/api/documents/${currentDoc.id}/edit`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: 'ficheIdentite', field: op.field, value: op.fieldValue }),
        });
        if (!res.ok) throw new Error('Échec de la mise à jour.');
        currentDoc = await fetchDocument(currentDoc.id);
        const html = await buildDeckHTML(currentDoc);
        document.getElementById('dpStage').innerHTML = html;
        wireDpStage(currentDoc);
        dpShowSlide(dpIdx);
        return `${FICHE_LABELS[op.field] || op.field} mis à jour : ${formatFicheValue(op.field, op.fieldValue) ?? op.fieldValue} (modifié manuellement).`;
      } catch (err) {
        return `Erreur lors de la modification : ${err.message}`;
      }
    }
    if (op.type === 'close') {
      dpClose();
      return 'Présentation fermée.';
    }
    return null;
  }
  async function sendPresentationPrompt(prompt) {
    const input = document.getElementById('dpFloatInput');
    const sendBtn = document.getElementById('dpFloatSend');
    const reply = document.getElementById('dpFloatReply');
    const replyText = document.getElementById('dpFloatReplyText');
    if (input) { input.value = ''; input.disabled = true; }
    if (sendBtn) { sendBtn.disabled = true; sendBtn.classList.add('loading'); }
    reply.style.display = 'block';
    replyText.innerHTML = '<span class="sim-typing-dots"><span></span><span></span><span></span></span>';
    try {
      const context = {
        currentSlide: DP_SLIDE_KEYS[dpIdx] || 'hero',
        comiteDate: document.getElementById('dpComiteDateInput')?.value || '',
        simLocked: !!(currentDoc && currentDoc.simulation),
        hasImageAttached: !!dpAttachedFile,
      };
      let spec;
      if (dpPreviewMode) {
        await new Promise(r => setTimeout(r, 350)); // latence factice, coherente avec un vrai appel
        spec = mockInterpretPresentationPrompt(prompt, context);
      } else {
        const res = await fetch('/api/presentation/prompt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, context }),
        });
        spec = await res.json();
        if (!res.ok) throw new Error(spec.error || 'Erreur serveur');
      }
      if (!spec.supported) {
        replyText.textContent = spec.reason || "Cette demande n'est pas prise en charge par la présentation.";
        return;
      }
      const ops = (spec.operations || []).filter(op => op.type !== 'none');
      if (!ops.length) {
        replyText.textContent = "Je n'ai pas identifié d'action claire dans cette instruction.";
        return;
      }
      const descriptions = [];
      for (const op of ops) { const d = await dpApplyOp(op, dpPreviewMode); if (d) descriptions.push(d); }
      replyText.textContent = descriptions.length ? descriptions.join(' ') : 'Fait.';
    } catch (err) {
      replyText.textContent = `Erreur : ${err.message}`;
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove('loading'); }
      if (input) { input.disabled = false; input.focus(); }
      setDpAttachedFile(null);
    }
  }
  const dpFloatSend = document.getElementById('dpFloatSend');
  const dpFloatInput = document.getElementById('dpFloatInput');
  function trySendPresentationPrompt() {
    const v = dpFloatInput.value.trim();
    if (v) { sendPresentationPrompt(v); return; }
    if (dpAttachedFile) { sendPresentationPrompt('Utilise cette image jointe en fond de la diapositive de titre.'); }
  }
  if (dpFloatSend && dpFloatInput) {
    dpFloatSend.addEventListener('click', trySendPresentationPrompt);
    dpFloatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); trySendPresentationPrompt(); } });
  }
  document.getElementById('dpFloatReplyClose')?.addEventListener('click', () => { document.getElementById('dpFloatReply').style.display = 'none'; });

  // Glisser-deposer de la barre flottante -- duplique volontairement
  // initFloatDrag() du Simulateur (public/js/simulator.js) : meme
  // comportement, fichiers distincts, pas de module partage client dans ce
  // projet.
  (function initDpFloatDrag() {
    const widget = document.getElementById('dpFloatChat');
    const handle = document.getElementById('dpFloatHandle');
    if (!widget || !handle) return;
    let dragging = false, offsetX = 0, offsetY = 0;
    function point(e) { return e.touches ? e.touches[0] : e; }
    function start(e) {
      dragging = true;
      const rect = widget.getBoundingClientRect();
      widget.style.left = rect.left + 'px';
      widget.style.top = rect.top + 'px';
      widget.style.bottom = 'auto';
      widget.style.transform = 'none';
      const p = point(e);
      offsetX = p.clientX - rect.left;
      offsetY = p.clientY - rect.top;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', end);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', end);
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      const p = point(e);
      const maxX = window.innerWidth - widget.offsetWidth - 8;
      const maxY = window.innerHeight - widget.offsetHeight - 8;
      const x = Math.max(8, Math.min(p.clientX - offsetX, Math.max(8, maxX)));
      const y = Math.max(8, Math.min(p.clientY - offsetY, Math.max(8, maxY)));
      widget.style.left = x + 'px';
      widget.style.top = y + 'px';
      if (e.touches) e.preventDefault();
    }
    function end() {
      dragging = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', end);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
    }
    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start, { passive: false });
  })();

  // Construit le HTML des slides de la Presentation comite (design sombre
  // .dp-*, meme maquette que l'aperçu initial) a partir des DONNEES
  // REELLEMENT VERIFIEES du dossier -- aucun recalcul ici, uniquement la
  // reprise de ce qui est deja extrait/calcule/verifie ailleurs
  // (ficheIdentite, indicateurs, audit, etatLocatif, doc.simulation
  // verrouille par le Simulateur). Retourne une chaine HTML (au lieu
  // d'assigner directement au DOM) : le caller (openPresentationDeck)
  // l'assigne a #dpStage apres l'ecran de chargement.
  // Couleurs des 3 principaux locataires + "autres" pour le donut de
  // concentration locative (slide 5) -- doivent rester synchronisees avec
  // .dp-legend-dark i.sw1/.sw2/.sw3/.sw4 dans leez.css (conic-gradient ne
  // peut pas lire une classe CSS, on duplique volontairement les couleurs).
  const DP_SWATCH_COLORS = ['#7fb8e0', 'rgba(245,243,238,.4)', 'rgba(245,243,238,.2)', 'rgba(245,243,238,.08)'];

  async function buildDeckHTML(doc) {
    const fi = doc.ficheIdentite || {};
    const ind = doc.indicateurs || {};
    const audit = doc.audit || { summary: null, cards: [] };
    const val = f => (f && f.value != null) ? f.value : null;
    const nc = v => v || 'non communiqué';
    const ncFmt = (key, f) => { const v = val(f); return v != null ? formatFicheValue(key, v) : 'non communiqué'; };
    const complete = doc.status === 'complete';
    const cite = (page, quote, label) => page == null ? '' :
      `<button type="button" class="memo-source-btn" data-open-page="${page}" data-open-quote="${(quote || '').replace(/"/g, '&quot;')}">${label || 'Voir la source →'}</button>`;

    // Masquage generique de n'importe quel element de n'importe quelle
    // diapositive -- jamais une suppression de donnee (voir PATCH
    // /documents/:id/presentation-hidden-cards), seulement un ecart de
    // l'affichage de CETTE presentation. Meme mecanisme que les cartes de
    // l'Audit sur la diapositive Points de vigilance (deja en place), ici
    // generalise : chaque id est un identifiant STABLE et propre a Leez
    // (ex: "hero.prix", "synthese.kpi.walb"), jamais invente dynamiquement
    // a partir d'une donnee variable, pour rester previsible d'une
    // regeneration a l'autre.
    const hiddenIds = new Set(doc.presentationHiddenCards || []);
    const isHidden = id => hiddenIds.has(id);
    const hideBtn = id => `<button type="button" class="dp-hide-btn" data-hide-card="${id}" title="Masquer de la présentation" aria-label="Masquer">✕</button>`;
    // el(id, tag, className, html) : rend l'element normalement (avec son
    // bouton de masquage), ou RIEN s'il est masque -- le bon choix des que
    // le parent n'exige pas un nombre d'enfants fixe (flex/liste/tableau,
    // qui se re-agencent naturellement sans trou).
    const el = (id, tag, className, innerHTML) => isHidden(id) ? '' : `<${tag} class="${className} dp-hideable">${hideBtn(id)}${innerHTML}</${tag}>`;
    // block(id, tag, className, html) : meme chose, mais si masque, GARDE
    // l'element avec un etat vide + un "reafficher" individuel -- reserve
    // aux emplacements dont le parent attend un nombre d'enfants FIXE (les
    // deux colonnes d'un `.dp-split` en grille 2 colonnes) : supprimer
    // l'enfant laisserait la colonne restante seule dans une grille a deux
    // pistes, un vide visuel a moitie de la diapositive.
    const block = (id, tag, className, innerHTML) => isHidden(id)
      ? `<${tag} class="${className} dp-hidden-placeholder"><span>Contenu masqué de cette diapositive — <button type="button" data-show-card="${id}">réafficher</button></span></${tag}>`
      : `<${tag} class="${className} dp-hideable">${hideBtn(id)}${innerHTML}</${tag}>`;

    if (!complete) {
      return `<section class="dp-slide" data-dp="1"><div class="dp-body dp-body-doc">
        <div class="dp-slide-label">Présentation</div>
        <div class="dp-thesis">${doc.filename} — présentation générée une fois l'extraction terminée (${STATUS_LABELS[doc.status] || doc.status}${doc.errorMessage ? ' — ' + doc.errorMessage : ''}).</div>
      </div></section>`;
    }

    const address = nc(val(fi.adresse));
    const typeActif = nc(val(fi.typeActif));
    const surface = ncFmt('surfaceLocativeGLA', fi.surfaceLocativeGLA);
    const prix = ncFmt('prixDemande', fi.prixDemande);
    const prixM2 = ind.prixM2 != null ? fmt(ind.prixM2) + ' €/m²' : 'non calculable';
    const cap = ind.capRateRecalcule != null ? fmt2(ind.capRateRecalcule) + ' %' : 'non calculable';
    const occ = ind.tauxOccupation != null ? fmt2(ind.tauxOccupation) + ' %' : 'non calculable';
    const nbLots = ncFmt('nombreLots', fi.nombreLots);
    const walb = ind.walb != null ? `${fmt2(ind.walb)} an${ind.walb >= 2 ? 's' : ''}` : null;

    const synthese = `${typeActif} de ${surface} situé à ${address}, proposé à ${prix}${prixM2 !== 'non calculable' ? ' (' + prixM2 + ')' : ''}${cap !== 'non calculable' ? ' au taux de capitalisation recalculé de ' + cap : ''}. Le bien est loué à ${occ} auprès de ${nbLots} locataire(s), selon les données extraites et vérifiées du mémorandum de vente.`;

    // Photos : uniquement celles deposees par l'analyste dans Documents --
    // aucune photo generique de remplacement (la photo de couverture EST le
    // fond de la slide 1, jamais une image d'illustration deconnectee du
    // bien reel). Sans photo, la slide 1 reste sur un fond uni sombre.
    let supporting = [];
    try { supporting = await fetch(`/api/documents/${doc.id}/supporting`).then(r => r.json()); } catch { /* pas bloquant */ }
    // Le plus RECEMMENT depose l'emporte (pas le premier) : `supporting`
    // arrive trie par date d'ajout croissante -- si l'analyste remplace sa
    // couverture (ex: via le copilote, "mets cette image en fond"), la
    // nouvelle photo doit prendre le pas sur une eventuelle ancienne du
    // meme type deja presente dans Documents.
    const photos = (Array.isArray(supporting) ? supporting : []).filter(s => s.category === 'photos' && s.isImage);
    const cover = [...photos].reverse().find(s => s.type === 'Photo de couverture') || photos[0] || null;
    const map = [...photos].reverse().find(s => s.type === 'Carte de situation' && s.id !== cover?.id) || null;
    const photoUrl = s => `/api/documents/${doc.id}/supporting/${s.id}/file`;
    const heroStyle = cover
      ? ` style="background-image:linear-gradient(180deg, rgba(0,0,0,.1), rgba(0,0,0,.88) 76%, #000 100%), url('${photoUrl(cover)}');"`
      : '';

    // Date du comite : jamais une donnee du document -- seul champ edite
    // par l'analyste directement dans la Presentation, persiste en local
    // par dossier (voir le listener sur #dpComiteDateInput, openPresentationDeck).
    let comiteDate = '';
    try { comiteDate = localStorage.getItem('leez.comiteDate.' + doc.id) || ''; } catch { /* localStorage indisponible : champ vide, non bloquant */ }

    const rentRoll = doc.etatLocatif || [];
    const totalLoyer = rentRoll.reduce((s, r) => s + (r.loyerAnnuel?.value || 0), 0);

    // Échéancier des baux (slide 5, gauche) : annee reelle extraite
    // (prochaine option de sortie sinon fin de bail, meme priorite que le
    // calcul WALB dans indicators.js) -> somme des loyers par annee.
    const yearTotals = new Map();
    rentRoll.forEach(r => {
      const raw = r.prochaineOptionSortie?.value || r.dateFinBail?.value;
      const loyer = r.loyerAnnuel?.value;
      if (!raw || !loyer) return;
      const m = String(raw).match(/(19|20)\d{2}/);
      if (!m) return;
      yearTotals.set(m[0], (yearTotals.get(m[0]) || 0) + loyer);
    });
    const years = Array.from(yearTotals.keys()).sort();
    const maxYearVal = years.length ? Math.max(...years.map(y => yearTotals.get(y))) : 0;
    const peakYear = years.find(y => yearTotals.get(y) === maxYearVal);
    const echeancierHTML = years.length ? `
          <div class="dp-bars-dark tall">
            ${years.map(y => `<div class="dp-bar-col"><div class="dp-bar${yearTotals.get(y) === maxYearVal ? ' full' : ''}" style="height:${maxYearVal ? (yearTotals.get(y) / maxYearVal * 100) : 0}%"></div><span>${y}</span></div>`).join('')}
          </div>
          <div class="dp-caption">${walb ? 'WALB ' + walb + ' — ' : ''}${peakYear ? fmt2(totalLoyer ? (maxYearVal / totalLoyer * 100) : 0) + ' % des loyers à échéance ' + peakYear : ''}</div>`
      : `<p class="dp-note-dark">Dates d'échéance non exploitables pour ce dossier.</p>`;

    // Concentration locative (slide 5, droite) : top 3 locataires par loyer
    // annuel reel, part de chacun dans le total reel -- "Autres" pour le
    // reste s'il y a plus de 3 locataires, jamais de chiffre invente.
    const sortedTenants = rentRoll.filter(r => r.loyerAnnuel?.value).sort((a, b) => b.loyerAnnuel.value - a.loyerAnnuel.value);
    const top3 = sortedTenants.slice(0, 3).map(r => ({ name: r.locataire || 'Locataire non identifié', pct: totalLoyer ? (r.loyerAnnuel.value / totalLoyer * 100) : 0 }));
    const autresPct = Math.max(0, 100 - top3.reduce((s, t) => s + t.pct, 0));
    const donutSegments = [...top3, ...(autresPct > 0.5 ? [{ name: 'Autres locataires', pct: autresPct }] : [])];
    const concentrationHTML = donutSegments.length ? (() => {
      let acc = 0;
      const stops = donutSegments.map((s, i) => {
        const from = acc; acc += s.pct;
        return `${DP_SWATCH_COLORS[i]} ${from}% ${acc}%`;
      });
      const legend = donutSegments.map((s, i) => `<span><i class="sw${i + 1}"></i>${s.name} — ${fmt2(s.pct)} %</span>`).join('');
      return `<div class="dp-donut big" style="background:conic-gradient(${stops.join(', ')});"></div><div class="dp-legend-dark">${legend}</div>`;
    })() : `<p class="dp-note-dark">Répartition non calculable (aucun loyer annuel exploitable).</p>`;

    // Prevu financier & rendements (slides 6-7) : ne s'affichent que si le
    // Simulateur a ete verrouille pour ce dossier (doc.simulation, ecrit
    // par simulator.js -> POST .../simulation-snapshot sur clic manuel
    // "Verrouiller pour la presentation") -- jamais un chiffre financier
    // invente en l'absence de verrouillage, message explicite a la place.
    const sim = doc.simulation || null;
    const simEmptyHTML = `<p class="dp-note-dark">Simulateur non verrouillé pour ce dossier — ouvrez l'onglet Simulateur, ajustez les hypothèses si besoin, puis cliquez sur « 🔒 Verrouiller pour la présentation » pour générer cette section.</p>`;

    const previsionnelHTML = sim ? el('previsionnel.chart', 'div', '', (() => {
      const annees = sim.businessPlan.annees;
      const maxVal = Math.max(1, ...annees.map(a => Math.max(a.loyersNets, 0)));
      const h = sim.businessPlan.hypotheses;
      return `
        <div class="dp-bars-dark wide">
          ${annees.map(a => `<div class="dp-bar-col"><div class="dp-bar${a.loyersNets === maxVal ? ' full' : ''}" style="height:${Math.max(0, a.loyersNets) / maxVal * 100}%" title="NOI an ${a.annee} : ${fmt(a.loyersNets)} €"></div><span>An ${a.annee}</span></div>`).join('')}
        </div>
        <div class="dp-caption">NOI projeté, année 1 → ${annees.length} (indexation ${fmt2(h.indexationPct)} %/an, vacance modélisée ${fmt2(h.tauxVacancePct)} %)</div>`;
    })()) : simEmptyHTML;

    const rendementsHTML = sim ? `
        <div class="dp-kpi-grid three">
          ${el('rendements.kpi.tri', 'div', 'dp-kpi big', `<span class="dp-kpi-val">${sim.exit.triNetInvestisseurPct != null ? fmt2(sim.exit.triNetInvestisseurPct) + ' %' : '—'}</span><span class="dp-kpi-label">TRI net investisseur</span>`)}
          ${el('rendements.kpi.moic', 'div', 'dp-kpi big', `<span class="dp-kpi-val">${sim.exit.moic != null ? fmt2(sim.exit.moic) + 'x' : '—'}</span><span class="dp-kpi-label">Multiple (MoIC)</span>`)}
          ${el('rendements.kpi.coc', 'div', 'dp-kpi big', `<span class="dp-kpi-val">${sim.keyMetrics.cashOnCashMoyenPct != null ? fmt2(sim.keyMetrics.cashOnCashMoyenPct) + ' %' : '—'}</span><span class="dp-kpi-label">Cash-on-cash moyen</span>`)}
        </div>
        <ul class="dp-assumptions">
          ${el('rendements.assumption.indexation', 'li', '', `<span>Indexation des loyers</span><b>${fmt2(sim.businessPlan.hypotheses.indexationPct)} %/an</b>`)}
          ${el('rendements.assumption.vacance', 'li', '', `<span>Vacance modélisée</span><b>${fmt2(sim.businessPlan.hypotheses.tauxVacancePct)} %</b>`)}
          ${el('rendements.assumption.exitcap', 'li', '', `<span>Rendement de sortie (exit cap)</span><b>${fmt2(sim.exit.rendementSortiePct)} %</b>`)}
          ${el('rendements.assumption.ltv', 'li', '', `<span>LTV</span><b>${sim.capitalStack.ltvPct != null ? fmt2(sim.capitalStack.ltvPct) + ' %' : '—'}</b>`)}
          ${el('rendements.assumption.taux', 'li', '', `<span>Taux d'intérêt</span><b>${fmt2(sim.capitalStack.detteDetail.tauxInteretPct)} %</b>`)}
        </ul>` : simEmptyHTML;

    // Points de vigilance : cartes de l'Audit deja calculees et verifiees
    // (doc.audit.cards, meme donnee que l'onglet Audit) -- pas de colonne
    // "points forts" symetrique, Leez n'a aucune source verifiee pour des
    // points positifs generes.
    // Masquage : affichage uniquement, jamais une suppression -- la carte
    // reste entiere et verifiee dans l'onglet Audit, seul son ID est ecarte
    // ici (voir PATCH /documents/:id/presentation-hidden-cards). L'analyste
    // peut donc "masquer ce qu'il veut" sur CETTE diapositive sans toucher a
    // la donnee source.
    const allCards = audit.cards || [];
    const visibleCards = allCards.filter(c => !isHidden(c.id));
    const vigilanceCards = visibleCards.slice(0, 6);
    const vigilanceHTML = vigilanceCards.length > 0
      ? vigilanceCards.map(c => `<div class="dp-vigilance-item"><button type="button" class="dp-vigilance-hide" data-hide-card="${c.id}" title="Masquer de la présentation" aria-label="Masquer">✕</button><b>${c.titre}</b> — ${c.constat}${cite(c.page, c.quote, 'Source →')}</div>`).join('')
      : `<div class="dp-vigilance-item"><b>${allCards.length > 0 ? 'Toutes les alertes sont masquées' : 'Aucune alerte détectée'}</b> — ${allCards.length > 0 ? "utilisez « Réafficher tout » ci-dessous pour les retrouver." : "l'analyse Leez n'a relevé aucun signal d'alerte sur les critères vérifiés."}</div>`;

    // Un id "connu" par diapositive (STABLE, jamais recalcule a partir d'une
    // donnee variable) -- sert uniquement a batir le "réafficher tout" ci-
    // dessous, scope a la SEULE diapositive concernee (jamais un reset
    // global, qui effacerait aussi ce que l'analyste a masque ailleurs).
    const SLIDE_ELEMENT_IDS = {
      hero: ['hero.prix', 'hero.caprate', 'hero.comite'],
      synthese: ['synthese.thesis', 'synthese.audit', 'synthese.kpi.prixm2', 'synthese.kpi.caprate', 'synthese.kpi.surface', 'synthese.kpi.walb', 'synthese.kpi.occupation', 'synthese.kpi.noi'],
      actif: ['actif.fact.surface', 'actif.fact.annee', 'actif.fact.lots', 'actif.fact.dpe', 'actif.fact.parking', 'actif.location'],
      locatif: [...rentRoll.map((_, i) => `locatif.row.${i}`), 'locatif.kpi.total', 'locatif.kpi.loyerm2', 'locatif.kpi.occupation'],
      echeancier: ['echeancier.chart', 'echeancier.concentration'],
      previsionnel: ['previsionnel.chart'],
      rendements: ['rendements.kpi.tri', 'rendements.kpi.moic', 'rendements.kpi.coc', 'rendements.assumption.indexation', 'rendements.assumption.vacance', 'rendements.assumption.exitcap', 'rendements.assumption.ltv', 'rendements.assumption.taux'],
      vigilance: allCards.map(c => c.id),
      recommandation: ['recommandation.verdict', 'recommandation.thesis', 'recommandation.nextsteps', 'recommandation.nextstep.0', 'recommandation.nextstep.1', 'recommandation.nextstep.2'],
    };
    const slideResetNote = slideKey => {
      const ids = (SLIDE_ELEMENT_IDS[slideKey] || []).filter(isHidden);
      if (!ids.length) return '';
      return `<div class="dp-slide-hidden-note">${ids.length} élément${ids.length > 1 ? 's' : ''} masqué${ids.length > 1 ? 's' : ''} sur cette diapositive — <button type="button" data-unhide-ids="${ids.join(',')}">réafficher tout</button></div>`;
    };

    // Recommandation : reprend le verdict DETERMINISTE de l'Audit Leez
    // (niveauGlobal/verdictLabel/phrase, deja calcules et affiches dans
    // l'onglet Audit) -- jamais un GO/NO-GO invente par un modele, la
    // decision finale reste explicitement au comite.
    const auditSummary = audit.summary || { niveauGlobal: 'vert', verdictLabel: 'Analyse non disponible', phrase: '' };
    const niveauClass = { rouge: 'niveau-rouge', orange: 'niveau-orange', vert: 'niveau-vert' }[auditSummary.niveauGlobal] || 'niveau-vert';

    const dpSlide = (n, label, bodyHTML) => `<section class="dp-slide" data-dp="${n}"><div class="dp-body dp-body-doc"><div class="dp-slide-label">${label}</div>${bodyHTML}</div></section>`;

    return `<section class="dp-slide" data-dp="1">
        <div class="dp-hero"${heroStyle}>
          <div class="dp-hero-content">
            <div class="dp-eyebrow">Présentation comité d'investissement</div>
            <h1 class="dp-title-xl">${address}</h1>
            <div class="dp-sub">${typeActif}${val(fi.sousMarche) ? ' · ' + val(fi.sousMarche) : ''}</div>
            <div class="dp-title-stats">
              ${el('hero.prix', 'div', '', `<span class="dp-stat-label">Prix demandé</span><span class="dp-stat-val">${prix}</span>`)}
              ${el('hero.caprate', 'div', '', `<span class="dp-stat-label">Taux de capitalisation recalculé</span><span class="dp-stat-val">${cap}</span>`)}
              ${el('hero.comite', 'div', '', `<span class="dp-stat-label">Comité du</span><input type="text" class="dp-stat-input" id="dpComiteDateInput" placeholder="À définir" value="${escapeHtml(comiteDate)}">`)}
            </div>
            ${slideResetNote('hero')}
          </div>
        </div>
      </section>`

      + dpSlide(2, "02 — Synthèse exécutive", `
        ${el('synthese.thesis', 'p', 'dp-thesis', synthese)}
        <div class="dp-kpi-grid">
          ${el('synthese.kpi.prixm2', 'div', 'dp-kpi', `<span class="dp-kpi-val">${prixM2}</span><span class="dp-kpi-label">Prix / m²</span>`)}
          ${el('synthese.kpi.caprate', 'div', 'dp-kpi', `<span class="dp-kpi-val">${cap}</span><span class="dp-kpi-label">Taux de capitalisation recalculé</span>`)}
          ${el('synthese.kpi.surface', 'div', 'dp-kpi', `<span class="dp-kpi-val">${surface}</span><span class="dp-kpi-label">Surface GLA</span>`)}
          ${el('synthese.kpi.walb', 'div', 'dp-kpi', `<span class="dp-kpi-val">${walb || '—'}</span><span class="dp-kpi-label">WALB</span>`)}
          ${el('synthese.kpi.occupation', 'div', 'dp-kpi', `<span class="dp-kpi-val">${occ}</span><span class="dp-kpi-label">Occupation (TOP)</span>`)}
          ${el('synthese.kpi.noi', 'div', 'dp-kpi', `<span class="dp-kpi-val">${ind.resultatNetExploitation != null ? fmt(ind.resultatNetExploitation) + ' €' : '—'}</span><span class="dp-kpi-label">NOI</span>`)}
        </div>
        ${auditSummary.phrase ? el('synthese.audit', 'div', 'dp-recommend', `Audit Leez : ${auditSummary.phrase}`) : ''}
        ${slideResetNote('synthese')}`)

      + dpSlide(3, "03 — Le bien et sa localisation", `
        <div class="dp-split">
          <div>
            <h3 class="dp-h3">${typeActif}</h3>
            <ul class="dp-facts">
              ${el('actif.fact.surface', 'li', '', `<span>Surface GLA</span><b>${surface}</b>`)}
              ${el('actif.fact.annee', 'li', '', `<span>Année de construction</span><b>${ncFmt('anneeConstruction', fi.anneeConstruction)}</b>`)}
              ${el('actif.fact.lots', 'li', '', `<span>Nombre de lots</span><b>${nbLots}</b>`)}
              ${el('actif.fact.dpe', 'li', '', `<span>DPE</span><b>${nc(val(fi.classeDPE))}</b>`)}
              ${el('actif.fact.parking', 'li', '', `<span>Places de parking</span><b>${ncFmt('placesParking', fi.placesParking)}</b>`)}
            </ul>
          </div>
          ${map
            ? block('actif.location', 'div', 'dp-location-card', `<img src="${photoUrl(map)}" alt="Carte de situation"><div class="dp-location-name">${nc(val(fi.sousMarche))}</div><div class="dp-location-detail">${address}</div>`)
            : block('actif.location', 'div', 'dp-location-card no-image', `<div class="dp-location-name">${nc(val(fi.sousMarche))}</div><div class="dp-location-detail">${address}<br><em>Aucune carte de situation déposée dans Documents.</em></div>`)}
        </div>
        ${slideResetNote('actif')}`)

      + dpSlide(4, "04 — Analyse locative", `
        <table class="dp-table">
          <thead><tr><th>Locataire</th><th>Activité</th><th>Loyer annuel</th><th>Échéance</th></tr></thead>
          <tbody>${rentRoll.length ? rentRoll.map((r, i) => {
            // <tr> ne peut pas contenir de <button> directement (HTML
            // invalide) -- le bouton de masquage vit dans la derniere <td>.
            const rid = `locatif.row.${i}`;
            if (isHidden(rid)) return '';
            return `<tr><td>${r.locataire || '—'}</td><td>${r.activite || '—'}</td><td>${r.loyerAnnuel?.value != null ? fmt(r.loyerAnnuel.value) + ' €' : '—'}</td><td class="dp-hideable">${hideBtn(rid)}${r.dateFinBail?.value || r.prochaineOptionSortie?.value || 'non communiqué'}</td></tr>`;
          }).join('') : `<tr><td colspan="4">Aucune ligne d'état locatif extraite.</td></tr>`}</tbody>
        </table>
        <div class="dp-kpi-grid three" style="margin-top:28px;">
          ${el('locatif.kpi.total', 'div', 'dp-kpi', `<span class="dp-kpi-val">${totalLoyer ? fmt(totalLoyer) + ' €' : '—'}</span><span class="dp-kpi-label">Loyer total</span>`)}
          ${el('locatif.kpi.loyerm2', 'div', 'dp-kpi', `<span class="dp-kpi-val">${ind.loyerMoyenM2 != null ? fmt(ind.loyerMoyenM2) + ' €/m²' : '—'}</span><span class="dp-kpi-label">Loyer moyen / m²</span>`)}
          ${el('locatif.kpi.occupation', 'div', 'dp-kpi', `<span class="dp-kpi-val">${occ}</span><span class="dp-kpi-label">Occupation (TOP)</span>`)}
        </div>
        ${slideResetNote('locatif')}`)

      + dpSlide(5, "05 — Échéancier des baux", `
        <div class="dp-split dp-split-charts">
          ${block('echeancier.chart', 'div', 'dp-chart-col', echeancierHTML)}
          ${block('echeancier.concentration', 'div', 'dp-chart-col', `<div class="dp-slide-label" style="margin-bottom:8px;">Concentration locative</div>${concentrationHTML}`)}
        </div>
        ${slideResetNote('echeancier')}`)

      + dpSlide(6, "06 — Prévisionnel financier", previsionnelHTML + slideResetNote('previsionnel'))
      + dpSlide(7, "07 — Rendements & hypothèses", rendementsHTML + slideResetNote('rendements'))
      + dpSlide(8, "08 — Points de vigilance", `<div class="dp-vigilance">${vigilanceHTML}${slideResetNote('vigilance')}</div>`)

      + dpSlide(9, "09 — Recommandation", `
        <div class="dp-recommendation">
          ${el('recommandation.verdict', 'div', `dp-go ${niveauClass}`, auditSummary.verdictLabel)}
          ${auditSummary.phrase ? el('recommandation.thesis', 'p', 'dp-thesis', auditSummary.phrase) : ''}
          ${el('recommandation.nextsteps', 'div', 'dp-next-steps', `
            <span>Prochaines étapes usuelles</span>
            <ol>
              ${el('recommandation.nextstep.0', 'li', '', 'Due diligence technique &amp; environnementale')}
              ${el('recommandation.nextstep.1', 'li', '', 'Confirmation des clauses locatives avec le bailleur')}
              ${el('recommandation.nextstep.2', 'li', '', 'Finalisation du financement (term sheet bancaire)')}
            </ol>`)}
          <p class="dp-note-dark">Verdict issu de l'analyse Leez (critères vérifiés) — la décision finale (GO / NO-GO) revient au comité.</p>
          ${slideResetNote('recommandation')}
        </div>`);
  }

  // ================= IMPORTER (upload) ================= //
  // Catalogue des documents annexes -- duplique volontairement
  // server/services/supportingCatalog.js (pas de module partage serveur/
  // client dans ce projet). Garder les deux listes identiques. Stockage
  // seul, aucune extraction : ces fichiers ne passent jamais par le pipeline.
  const SUPPORTING_CATALOG = [
    { id: 'photos', label: 'Photos & visuels', types: [
      'Photo de couverture', 'Photos du bien', 'Plans / vues aériennes', 'Carte de situation',
    ] },
    { id: 'commercialisation', label: 'Commercialisation', types: [
      'Teaser / dossier anonymisé', 'Fiche de commercialisation du broker',
    ] },
    { id: 'locatif', label: 'Locatif', types: [
      'Baux commerciaux (3/6/9) complets', 'Avenants aux baux',
      'État locatif détaillé (rent roll du property manager)', 'États des lieux',
      'Décomptes et régularisations de charges locatives', 'Cautions / garanties / dépôts de garantie',
      "Franchises et mesures d'accompagnement",
    ] },
    { id: 'financier', label: 'Financier / comptable', types: [
      "Comptes d'exploitation réels (3 derniers exercices)", 'Budget prévisionnel',
      "Pro forma / modèle d'underwriting du vendeur", 'Avis de taxe foncière',
      'Budgets et appels de charges de copropriété', "Contrats de gestion, d'assurance, de maintenance",
    ] },
    { id: 'technique', label: 'Technique', types: [
      'DPE (diagnostic de performance énergétique)', 'Audit énergétique',
      'Diagnostics réglementaires (amiante, plomb, électricité, gaz, termites)',
      "Rapport d'audit technique du bâti (structure, toiture, façades)",
      'Plan pluriannuel de travaux / CapEx', 'Plans et surfaces (mesurage, attestation de surface)',
    ] },
    { id: 'reglementaire', label: 'Réglementaire / urbanisme', types: [
      "PLU (plan local d'urbanisme)", 'Permis de construire / déclarations', "Certificat d'urbanisme",
      'ERP (état des risques et pollutions)', "Autorisations d'exploitation (ICPE, ERP si applicable)",
    ] },
    { id: 'juridique', label: 'Juridique / administratif', types: [
      'Titre de propriété', 'État hypothécaire', 'Règlement de copropriété + état descriptif de division',
      "Procès-verbaux d'assemblées générales de copropriété", 'Contentieux / litiges locatifs en cours',
      'Servitudes et baux emphytéotiques éventuels',
    ] },
    { id: 'esg', label: 'ESG', types: [
      'Attestations de conformité environnementale', 'Certifications (BREEAM, HQE, etc.)',
      'Données de consommation énergétique réelles',
    ] },
  ];

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const statusCard = document.getElementById('statusCard');
  const statusTitle = document.getElementById('statusTitle');
  const statusFile = document.getElementById('statusFile');
  const statusBadge = document.getElementById('statusBadge');
  const statusFill = document.getElementById('statusFill');
  const statusError = document.getElementById('statusError');
  const statusSubPhrase = document.getElementById('statusSubPhrase');
  const PCT = { uploaded: 8, extracting_pages: 20, extracting_identite: 40, extracting_t12: 60, extracting_signaux: 75, computing_indicators: 88, complete: 100, error: 100, unsupported_scanned: 100 };

  // Phrases indicatives qui defilent dans le GRAND TITRE pendant chaque etape
  // reelle du pipeline (pas des affirmations factuelles sur des resultats --
  // juste un reflet honnete de ce que Leez est en train de regarder dans le
  // document, pour eviter un titre fige et rester transparent sur le travail
  // reel en cours -- jamais une accroche marketing deconnectee du process).
  const PHRASES_BY_STATUS = {
    uploaded: ['Réception du document…', 'Vérification du fichier…'],
    extracting_pages: ['Lecture du texte page par page…', 'Découpage du document…'],
    extracting_identite: ["Analyse de la fiche d'identité…", 'Repérage des surfaces et du prix…', 'Lecture des clauses du bail…'],
    extracting_t12: ["Lecture du compte d'exploitation…", 'Analyse des postes de charges…', 'Vérification des revenus locatifs…'],
    extracting_signaux: ['Recherche de signaux de risque…', 'Analyse des mentions techniques…'],
    computing_indicators: ['Vérification des citations…', 'Calcul des indicateurs clés…', 'Contrôles de cohérence…'],
  };
  let phraseTimer = null;
  let currentPhraseStatus = null;
  function startPhraseRotation(status) {
    if (status === currentPhraseStatus) return;
    currentPhraseStatus = status;
    if (phraseTimer) clearInterval(phraseTimer);
    const phrases = PHRASES_BY_STATUS[status] || [STATUS_LABELS[status] || status];
    let i = 0;
    statusTitle.textContent = phrases[0];
    phraseTimer = setInterval(() => { i = (i + 1) % phrases.length; statusTitle.textContent = phrases[i]; }, 2500);
  }
  function stopPhraseRotation() {
    if (phraseTimer) clearInterval(phraseTimer);
    phraseTimer = null; currentPhraseStatus = null;
  }

  // ---- OM (dropzone principale) : mise en attente, pas d'envoi immédiat ----
  // Le vrai envoi n'a lieu qu'au clic sur "Charger les documents", pour
  // pouvoir combiner l'OM et les documents annexes dans le même import.
  let stagedOM = null;
  function stageOM(file) {
    if (file.type !== 'application/pdf') { alert('Seuls les fichiers PDF sont acceptés.'); return; }
    stagedOM = file;
    dropzone.classList.add('staged');
    dropzone.querySelector('.primary').textContent = '✓ ' + file.name;
    dropzone.querySelector('.secondary').textContent = 'Cliquez pour remplacer';
    updateIngestSubmitState();
  }
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer.files[0]) stageOM(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) stageOM(fileInput.files[0]); });

  // ---- Documents annexes : une ligne de dépôt par type, dans son catégorie ----
  let stagedSupporting = {}; // clé "categoryId|||type" -> File
  function renderSupportingCategories() {
    document.getElementById('supportingCategories').innerHTML = SUPPORTING_CATALOG.map(cat => `
      <div class="supporting-category">
        <div class="ingest-section-label">${cat.label}</div>
        <div class="supporting-type-grid">
          ${cat.types.map(t => `
            <div class="supporting-type-row" data-cat="${cat.id}" data-type="${t.replace(/"/g, '&quot;')}">
              <div class="type-label">${t}</div>
              <div class="type-file"></div>
              <button type="button" class="type-clear" aria-label="Retirer">✕</button>
              <input type="file" accept="${cat.id === 'photos' ? 'image/jpeg,image/png,image/webp' : 'application/pdf'}">
            </div>`).join('')}
        </div>
      </div>`).join('');
    document.querySelectorAll('.supporting-type-row').forEach(row => {
      const input = row.querySelector('input');
      row.addEventListener('click', e => { if (e.target.closest('.type-clear')) return; input.click(); });
      row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('dragover'); });
      row.addEventListener('dragleave', () => row.classList.remove('dragover'));
      row.addEventListener('drop', e => { e.preventDefault(); row.classList.remove('dragover'); if (e.dataTransfer.files[0]) stageSupporting(row, e.dataTransfer.files[0]); });
      input.addEventListener('change', () => { if (input.files[0]) stageSupporting(row, input.files[0]); });
      row.querySelector('.type-clear').addEventListener('click', e => {
        e.stopPropagation();
        delete stagedSupporting[row.dataset.cat + '|||' + row.dataset.type];
        row.classList.remove('staged');
        row.querySelector('.type-file').textContent = '';
        input.value = '';
        updateIngestSubmitState();
      });
    });
  }
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  function stageSupporting(row, file) {
    const accepted = row.dataset.cat === 'photos' ? IMAGE_TYPES.includes(file.type) : file.type === 'application/pdf';
    if (!accepted) { alert(row.dataset.cat === 'photos' ? 'Seules les images (JPG, PNG, WEBP) sont acceptées ici.' : 'Seuls les fichiers PDF sont acceptés.'); return; }
    stagedSupporting[row.dataset.cat + '|||' + row.dataset.type] = file;
    row.classList.add('staged');
    row.querySelector('.type-file').textContent = '✓ ' + file.name;
    updateIngestSubmitState();
  }

  // ---- État du bouton "Charger les documents" + sélecteur de dossier ----
  async function populateIngestDossierSelect() {
    const select = document.getElementById('ingestDossierSelect');
    try {
      const docs = await fetch('/api/documents').then(r => r.json());
      const real = docs.filter(d => !d.isDemo && d.status === 'complete');
      const current = select.value;
      select.innerHTML = '<option value="">Sélectionner un dossier…</option>' + real.map(d => `<option value="${d.id}">${(d.ficheIdentite?.adresse?.value) || d.filename}</option>`).join('');
      if (current) select.value = current;
    } catch { /* liste indisponible */ }
  }
  // Un seul bouton, à côté de la dropbox OM : "Importer le dossier" pour un
  // document unique (OM seul, ou une seule annexe sans OM), "Tout importer"
  // dès que plusieurs documents sont en attente -- quelle que soit la
  // combinaison OM/annexes.
  function updateIngestSubmitState() {
    const hasOM = !!stagedOM;
    const nbSupporting = Object.keys(stagedSupporting).length;
    const total = (hasOM ? 1 : 0) + nbSupporting;
    const btn = document.getElementById('ingestSubmitBtn');
    const picker = document.getElementById('ingestDossierPicker');
    btn.disabled = total === 0;
    btn.textContent = total > 1 ? 'Tout importer' : 'Importer le dossier';
    if (!hasOM && nbSupporting > 0) {
      picker.style.display = 'flex';
      populateIngestDossierSelect();
    } else {
      picker.style.display = 'none';
    }
  }
  function resetIngestForm() {
    stagedOM = null;
    stagedSupporting = {};
    fileInput.value = '';
    const nameInput = document.getElementById('ingestNameInput');
    if (nameInput) nameInput.value = '';
    dropzone.classList.remove('staged');
    dropzone.querySelector('.primary').textContent = 'Offering Memorandum (OM) — glissez un PDF, ou cliquez pour parcourir';
    dropzone.querySelector('.secondary').textContent = "PDF texte natif · jusqu'à 32 Mo · déclenche l'analyse automatique";
    renderSupportingCategories();
    updateIngestSubmitState();
  }

  document.getElementById('ingestSubmitBtn').addEventListener('click', async () => {
    const hasOM = !!stagedOM;
    const supportingEntries = Object.entries(stagedSupporting);
    if (!hasOM && supportingEntries.length === 0) return;
    const dossierSelect = document.getElementById('ingestDossierSelect');
    if (!hasOM && !dossierSelect.value) { alert('Choisissez le dossier destinataire.'); return; }

    const formData = new FormData();
    const meta = supportingEntries.map(([key]) => { const [category, type] = key.split('|||'); return { category, type }; });
    supportingEntries.forEach(([, file]) => formData.append('supportingFiles', file));
    if (meta.length) formData.append('supportingMeta', JSON.stringify(meta));

    if (hasOM) {
      // Le nom du dossier est choisi par l'analyste -- obligatoire (c'est
      // lui qui identifie la carte dans le Vault et dans Mémoire).
      const dossierName = (document.getElementById('ingestNameInput')?.value || '').trim();
      if (!dossierName) {
        alert("Choisissez d'abord un nom pour ce dossier.");
        document.getElementById('ingestNameInput')?.focus();
        return;
      }
      formData.append('displayName', dossierName);
      formData.append('file', stagedOM);
      statusCard.className = 'import-overlay'; statusCard.style.display = 'flex';
      document.getElementById('statusPhaseLabel').textContent = 'Envoi du document…';
      statusFile.textContent = stagedOM.name;
      statusBadge.textContent = 'EN COURS'; statusBadge.className = 'status-badge running';
      statusFill.style.width = '3%'; document.getElementById('statusPct').textContent = '';
      document.getElementById('statusRetryBtn').style.display = 'none';
      statusError.style.display = 'none'; document.getElementById('statusCloseBtn').style.display = 'none';
      startPhraseRotation('uploaded');
      try {
        const d = await fetch('/api/documents', { method: 'POST', body: formData }).then(r => r.json());
        if (d.error) throw new Error(d.error);
        resetIngestForm();
        pollStatus(d.id);
      } catch (err) { showUploadError(err.message); }
    } else {
      const dossierId = dossierSelect.value;
      const btn = document.getElementById('ingestSubmitBtn');
      btn.disabled = true; btn.textContent = 'Envoi en cours…';
      try {
        const res = await fetch(`/api/documents/${dossierId}/supporting`, { method: 'POST', body: formData });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Échec de l'envoi.");
        resetIngestForm();
        alert(`${meta.length} document(s) ajouté(s) au dossier.`);
      } catch (err) {
        alert(err.message);
        updateIngestSubmitState();
      }
    }
  });

  renderSupportingCategories();
  updateIngestSubmitState();

  // ================= ONGLET DOCUMENTS (annexes stockées, sans extraction) ================= //
  async function renderSupportingDocs(doc) {
    const container = document.getElementById('supportingDocsList');
    container.innerHTML = '<div class="dossiers-empty">Chargement…</div>';
    let list = [];
    try { list = await fetch(`/api/documents/${doc.id}/supporting`).then(r => r.json()); } catch { /* liste indisponible */ }
    if (!Array.isArray(list) || list.length === 0) {
      container.innerHTML = '<div class="dossiers-empty">Aucun document annexe pour ce dossier. <button class="cite-link" id="supportingGoIngest">Ajouter des documents →</button></div>';
      document.getElementById('supportingGoIngest')?.addEventListener('click', () => showView('ingest'));
      return;
    }
    const byCategory = {};
    list.forEach(s => { (byCategory[s.category] = byCategory[s.category] || []).push(s); });
    container.innerHTML = SUPPORTING_CATALOG.filter(cat => byCategory[cat.id]).map(cat => `
      <div class="supporting-doc-category">
        <div class="supporting-doc-category-label">${cat.label}</div>
        ${byCategory[cat.id].map(s => `
          <div class="supporting-doc-row">
            ${s.isImage ? `<img class="supporting-doc-thumb" src="/api/documents/${doc.id}/supporting/${s.id}/file" alt="${s.type}">` : ''}
            <div style="flex:1;">
              <div class="supporting-doc-type">${s.type}</div>
              <div class="supporting-doc-filename">${s.filename}</div>
            </div>
            <div class="supporting-doc-actions">
              <button class="cite-link" data-view-supporting="${s.id}">Voir →</button>
              <button class="dossier-row-delete" data-delete-supporting="${s.id}" title="Supprimer">✕</button>
            </div>
          </div>`).join('')}
      </div>`).join('');
    container.querySelectorAll('[data-view-supporting]').forEach(btn => btn.addEventListener('click', () => {
      window.open(`/api/documents/${doc.id}/supporting/${btn.dataset.viewSupporting}/file`, '_blank');
    }));
    container.querySelectorAll('[data-delete-supporting]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Supprimer ce document ?')) return;
      await fetch(`/api/documents/${doc.id}/supporting/${btn.dataset.deleteSupporting}`, { method: 'DELETE' });
      renderSupportingDocs(doc);
    }));
  }

  let pollTimer = null;
  function pollStatus(id) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      fetch(`/api/documents/${id}`).then(r => r.json()).then(doc => {
        document.getElementById('statusPhaseLabel').textContent = STATUS_LABELS[doc.status] || doc.status;
        const pct = PCT[doc.status] || 50;
        statusFill.style.width = pct + '%';
        document.getElementById('statusPct').textContent = pct + ' %';
        startPhraseRotation(doc.status);
        if (doc.status === 'complete') {
          clearInterval(pollTimer);
          stopPhraseRotation();
          statusBadge.textContent = 'TERMINÉ'; statusBadge.className = 'status-badge complete';
          statusTitle.textContent = 'Dossier prêt';
          statusCard.classList.add('complete');
          fileInput.value = '';
          // Laisse le temps à l'animation de coche de se jouer avant de
          // basculer sur le dossier -- un vrai instant de "c'est bon", pas
          // une bascule sèche.
          setTimeout(() => { statusCard.style.display = 'none'; openDossier(id); }, 1100);
        } else if (doc.status === 'unsupported_scanned') {
          // Jamais confondu avec une vraie erreur : constat honnête sur une
          // limite connue (pas d'OCR), pas un incident. Pas de bouton
          // Relancer -- retenter produirait exactement le même échec.
          clearInterval(pollTimer);
          stopPhraseRotation();
          statusBadge.textContent = 'SCAN NON PRIS EN CHARGE'; statusBadge.className = 'status-badge scanned';
          statusCard.classList.add('error');
          statusError.style.display = 'block';
          statusError.textContent = (doc.errorMessage || 'Ce document semble être un scan sans texte exploitable.') + ' Demandez au vendeur une version texte du document, ou son rent roll au format Excel.';
          document.getElementById('statusCloseBtn').style.display = 'inline-block';
        } else if (doc.status === 'error') {
          clearInterval(pollTimer);
          stopPhraseRotation();
          statusBadge.textContent = 'ERREUR'; statusBadge.className = 'status-badge error';
          statusCard.classList.add('error');
          statusError.style.display = 'block'; statusError.textContent = doc.errorMessage || 'Une erreur est survenue.';
          const retryBtn = document.getElementById('statusRetryBtn');
          retryBtn.style.display = 'inline-block';
          retryBtn.onclick = async () => {
            retryBtn.disabled = true; retryBtn.textContent = 'Relance en cours…';
            try {
              const res = await fetch(`/api/documents/${id}/retry`, { method: 'POST' });
              if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Échec de la relance.');
              statusCard.className = 'import-overlay'; statusError.style.display = 'none';
              retryBtn.style.display = 'none'; retryBtn.disabled = false; retryBtn.textContent = 'Relancer';
              document.getElementById('statusCloseBtn').style.display = 'none';
              statusBadge.textContent = 'EN COURS'; statusBadge.className = 'status-badge running';
              pollStatus(id);
            } catch (err) {
              alert(err.message);
              retryBtn.disabled = false; retryBtn.textContent = 'Relancer';
            }
          };
          document.getElementById('statusCloseBtn').style.display = 'inline-block';
        }
      }).catch(() => {});
    }, 1500);
  }
  function showUploadError(message) {
    stopPhraseRotation();
    statusTitle.textContent = "Échec de l'envoi";
    statusBadge.textContent = 'ERREUR'; statusBadge.className = 'status-badge error';
    statusCard.classList.add('error');
    statusError.style.display = 'block'; statusError.textContent = message;
    document.getElementById('statusCloseBtn').style.display = 'inline-block';
  }
  document.getElementById('statusCloseBtn').addEventListener('click', () => {
    if (pollTimer) clearInterval(pollTimer);
    stopPhraseRotation();
    statusCard.style.display = 'none';
    statusCard.className = 'import-overlay';
    document.getElementById('statusRetryBtn').style.display = 'none';
  });

  // ---- Bouton "Test" : rejoue l'écran de chargement sans importer ni
  // consommer de crédit -- purement local, aucun appel a /api/documents.
  let demoTimer = null;
  function runDemoImportAnimation() {
    if (demoTimer) clearTimeout(demoTimer);
    statusCard.className = 'import-overlay'; statusCard.style.display = 'flex';
    statusFile.textContent = 'exemple-memorandum.pdf — démonstration, aucun appel réel';
    statusFill.style.width = '3%'; document.getElementById('statusPct').textContent = '';
    statusError.style.display = 'none'; document.getElementById('statusCloseBtn').style.display = 'none';
    statusBadge.textContent = 'EN COURS'; statusBadge.className = 'status-badge running';
    const sequence = ['uploaded', 'extracting_pages', 'extracting_identite', 'extracting_t12', 'extracting_signaux', 'computing_indicators'];
    let idx = 0;
    const stepDuration = 1400;
    function advance() {
      if (idx >= sequence.length) {
        stopPhraseRotation();
        document.getElementById('statusPhaseLabel').textContent = 'Terminé';
        statusFill.style.width = '100%'; document.getElementById('statusPct').textContent = '100 %';
        statusBadge.textContent = 'TERMINÉ'; statusBadge.className = 'status-badge complete';
        statusTitle.textContent = 'Dossier prêt';
        statusCard.classList.add('complete');
        demoTimer = setTimeout(() => { statusCard.style.display = 'none'; statusCard.classList.remove('complete'); }, 1400);
        return;
      }
      const status = sequence[idx];
      document.getElementById('statusPhaseLabel').textContent = STATUS_LABELS[status] || status;
      const pct = PCT[status] || 50;
      statusFill.style.width = pct + '%';
      document.getElementById('statusPct').textContent = pct + ' %';
      startPhraseRotation(status);
      idx++;
      demoTimer = setTimeout(advance, stepDuration);
    }
    advance();
  }
  document.getElementById('ingestTestBtn').addEventListener('click', runDemoImportAnimation);

  // ================= MODAL SOURCE ================= //
  const sourceModal = document.getElementById('sourceModal');
  const sourceModalFrame = document.getElementById('sourceModalFrame');
  const sourceModalText = document.getElementById('sourceModalText');
  const sourceModalQuote = document.getElementById('sourceModalQuote');
  const sourceModalPageNum = document.getElementById('sourceModalPageNum');
  function openSourceModal(page, quote) {
    if (!currentDoc || page == null) return;
    sourceModalPageNum.textContent = page;
    loadSourcePage(page, quote, { frameEl: sourceModalFrame, textEl: sourceModalText, quoteEl: sourceModalQuote });
    sourceModal.classList.add('open'); sourceModal.setAttribute('aria-hidden', 'false');
  }
  function closeSourceModal() { sourceModal.classList.remove('open'); sourceModal.setAttribute('aria-hidden', 'true'); sourceModalFrame.src = 'about:blank'; }
  document.getElementById('sourceModalClose').addEventListener('click', closeSourceModal);
  document.getElementById('sourceModalBackdrop').addEventListener('click', closeSourceModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSourceModal(); });

  // ================= COMPARAISON MANDAT (depuis une carte "Hors mandat") ================= //
  // Reutilise le detail complet deja calcule cote serveur (computeMandateFit)
  // -- ne recalcule rien ici. Meme logique de carousel que le panneau
  // "Commentaire de l'IA" : le critère sélectionné est affiché en grand, les
  // critères adjacents apparaissent en aperçu discret au-dessus/en-dessous et
  // sont cliquables pour naviguer, sans fermer la pop-up.
  const mandateModal = document.getElementById('mandateModal');
  function computeMandateChips(criteria) {
    const chips = {};
    let reasonIdx = 0;
    criteria.forEach(c => { chips[c.id] = c.status === 'ok' ? 'CONFORME' : c.status === 'echec' ? `RAISON DE REJET N°${++reasonIdx}` : 'DONNÉE INSUFFISANTE'; });
    return chips;
  }
  function mandateCriterionCardData(c, chips) {
    const niveau = c.status === 'ok' ? 'vert' : c.status === 'echec' ? 'rouge' : 'trace';
    return { title: c.label, niveau, texte: c.detail, formule: chips[c.id] };
  }
  function renderMandateCarousel(index) {
    const fit = currentDoc?.audit?.mandateFit;
    if (!fit || !fit.configured) return;
    const items = fit.criteria;
    const chips = computeMandateChips(items);
    const verdictLabel = { conforme: 'Conforme aux critères', a_examiner: 'Écart à examiner', hors_mandat: 'Hors critères' }[fit.verdict];
    const verdictBadge = document.getElementById('mandateModalVerdict');
    verdictBadge.textContent = verdictLabel;
    verdictBadge.className = `mandate-verdict-badge ${fit.verdict}`;

    const prev = index > 0 ? mandateCriterionCardData(items[index - 1], chips) : null;
    const next = index < items.length - 1 ? mandateCriterionCardData(items[index + 1], chips) : null;
    const container = document.getElementById('mandateModalCriteria');
    container.innerHTML = `<div class="ai-carousel">${prev ? aiGhostHTML(prev, 'prev') : ''}${aiCardHTML(mandateCriterionCardData(items[index], chips))}${next ? aiGhostHTML(next, 'next') : ''}</div>`;
    container.querySelectorAll('[data-ghost-nav]').forEach(btn => btn.addEventListener('click', () => renderMandateCarousel(index + (btn.dataset.ghostNav === 'prev' ? -1 : 1))));
  }
  function openMandateModal(selectedId) {
    const fit = currentDoc?.audit?.mandateFit;
    if (!fit || !fit.configured) return;
    const index = Math.max(0, fit.criteria.findIndex(c => c.id === selectedId));
    renderMandateCarousel(index);
    mandateModal.classList.add('open'); mandateModal.setAttribute('aria-hidden', 'false');
  }
  function closeMandateModal() { mandateModal.classList.remove('open'); mandateModal.setAttribute('aria-hidden', 'true'); }
  document.getElementById('mandateModalClose').addEventListener('click', closeMandateModal);
  document.getElementById('mandateModalBackdrop').addEventListener('click', closeMandateModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMandateModal(); });

  // ================= ASSISTANT (ecran d'accueil global) ================= //
  // Le serveur (askAboutDossier, dealChat.js) ne repond qu'a partir du texte
  // reel du dossier eventuellement selectionne et de la base de
  // connaissances -- chaque citation est deja verifiee cote serveur avant de
  // nous parvenir. Ce bloc affiche, rend les citations "dossier" cliquables
  // (reouvre la meme modale source zoomee que le reste de l'app), gere le
  // selecteur de dossier et les pastilles d'action rapide.
  function assistantChatRow(role, html) {
    const log = document.getElementById('assistantChatLog');
    const empty = document.getElementById('assistantChatEmpty');
    if (empty) empty.style.display = 'none';
    const row = document.createElement('div');
    row.className = `assistant-chat-msg ${role}`;
    row.innerHTML = html;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }
  function assistantTypingRow() {
    const row = assistantChatRow('assistant typing', '<span class="assistant-typing-dots"><span></span><span></span><span></span></span>');
    row.id = 'assistantTypingRow';
  }
  function clearAssistantTyping() {
    document.getElementById('assistantTypingRow')?.remove();
  }
  // Volet source du mode Web : clic sur un lien -> resserre le chat a
  // gauche et ouvre la vraie page a droite (voir .agent-web-layout dans
  // leez.css, meme principe que le volet source de l'Audit) au lieu d'une
  // nouvelle fenetre/onglet qui masquerait l'analyse en cours.
  // La plupart des sites refusent l'iframe (X-Frame-Options / CSP) : on
  // demande d'abord au serveur si la page est integrable (voir
  // routes/webPage.js). Si oui -> iframe (la vraie page, en direct) ; sinon
  // -> message clair + lien pour l'ouvrir dans un nouvel onglet. Jamais de
  // reconstruction/extraction de repli -- soit la vraie page, soit rien.
  async function openAgentWebSource(url, title) {
    const frame = document.getElementById('agentWebSourceFrame');
    const hint = document.getElementById('agentWebSourceHint');
    document.getElementById('agentWebLayout').classList.add('split');
    document.getElementById('agentWebSourceLabel').textContent = title || url;
    document.getElementById('agentWebSourceOpenTab').href = url;
    frame.src = 'about:blank'; frame.style.display = 'none';
    hint.style.display = 'flex'; hint.textContent = 'Chargement…';
    updateAgentShellHeight();
    try {
      const res = await fetch(`/api/web-page?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impossible de charger cette page.');
      if (data.embeddable) {
        hint.style.display = 'none';
        frame.style.display = 'block';
        frame.src = url;
      } else {
        hint.style.display = 'flex';
        hint.textContent = "Ce site refuse l'affichage intégré — ouvrez-la avec ↗.";
      }
    } catch (err) {
      hint.style.display = 'flex';
      hint.textContent = `Erreur de chargement : ${err.message}`;
    }
  }
  function closeAgentWebSource() {
    document.getElementById('agentWebLayout').classList.remove('split');
    const frame = document.getElementById('agentWebSourceFrame');
    frame.src = 'about:blank';
    frame.style.display = 'none';
    updateAgentShellHeight();
  }
  document.getElementById('agentWebSourceClose').addEventListener('click', closeAgentWebSource);
  async function renderAssistantAnswer(data) {
    if (!data.supported || !data.paragraphs.length) {
      assistantChatRow('assistant', `<p>${escapeHtml(data.caveat || "Je n'ai pas trouvé de réponse fiable dans ce dossier.")}</p>`);
      return;
    }
    const html = data.paragraphs.map(p => {
      const text = formatAssistantText(p.text);
      if (p.sourceType === 'dossier') {
        return text + `<button class="cite-link assistant-cite" data-open-page="${p.page}" data-open-quote="${(p.quote || '').replace(/"/g, '&quot;')}">Voir la source — page ${p.page} →</button>`;
      }
      if (p.sourceType === 'connaissances') {
        return text + `<div class="assistant-kb-source">Source : ${p.sourceFile} — ${p.sourceSection}${p.page ? ' (p.' + p.page + ')' : ''}</div>`;
      }
      if (p.sourceType === 'criteres') {
        return text + `<div class="assistant-kb-source">Source : Réglages du fonds</div>`;
      }
      if (p.sourceType === 'image') {
        return text + `<div class="assistant-kb-source">Source : image jointe</div>`;
      }
      // 'general' (conversation normale) et 'none' (transition) : texte seul, sans citation.
      return text;
    }).join('');
    const fullHtml = html + (data.caveat ? `<p class="assistant-caveat">${escapeHtml(data.caveat)}</p>` : '');
    const row = assistantChatRow('assistant', '');
    await revealHtmlInto(row, fullHtml);
    row.querySelectorAll('[data-open-page]').forEach(b => b.addEventListener('click', () => openSourceModal(b.dataset.openPage, b.dataset.openQuote)));
  }
  // Execute l'action classifiee par le serveur en reutilisant exactement les
  // fonctions deja construites -- jamais de nouvelle logique de generation
  // ou de calcul ici. L'Assistant etant desormais global (pas de dossier
  // "ouvert" par defaut), on ouvre d'abord le dossier selectionne si besoin.
  async function executeAssistantAction(action, dossierId, btn) {
    if (!dossierId) {
      // Pas de message d'erreur : on ouvre directement la pop-up de choix
      // et on retient l'action, déclenchée dès que l'analyste choisit un
      // dossier (voir setAssistantDossierId) ; la pastille cliquée reste
      // en bleu (halo persistant, comme le mode Web) tant qu'on attend.
      pendingAssistantAction = { action, btn };
      btn?.classList.add('active');
      openAssistantDossierModal(false);
      return;
    }
    if (!currentDoc || currentDoc.id !== dossierId) await openDossier(dossierId);
    if (action === 'generate_presentation') {
      await openPresentationDeck(currentDoc);
    } else if (action === 'lock_simulation') {
      if (window.LeezSimulator && window.LeezSimulator.lockCurrentSimulation) {
        goDossierPage('analyze');
        window.LeezSimulator.lockCurrentSimulation();
      } else {
        assistantChatRow('assistant', `<p class="assistant-caveat">Le Simulateur n'est pas disponible pour verrouiller les hypothèses.</p>`);
      }
    }
  }
  // ---------- indicateur de dossier + pop-up de choix ----------
  function getAssistantDossierId() {
    return document.getElementById('assistantDossierCombo')?.dataset.value || '';
  }
  // Le sélecteur de dossier n'est visible que lorsqu'il sert à quelque
  // chose : une action en attend un (pendingAssistantAction) ou un dossier
  // est déjà choisi (contexte repris d'un dossier ouvert). Au repos --
  // écran d'accueil de l'AI Agent, rien encore demandé -- il reste
  // entièrement masqué : titre, pastilles, prompt, rien d'autre.
  function updateDossierBarVisibility() {
    const left = document.getElementById('assistantDossierLeft');
    if (!left) return;
    const visible = !!pendingAssistantAction || !!getAssistantDossierId();
    left.classList.toggle('dl-hidden', !visible);
    left.setAttribute('aria-hidden', String(!visible));
  }
  // Choisit un dossier : met a jour l'etiquette affichee et, si une action
  // ("génère la présentation"/"verrouille le simulateur") attendait un
  // dossier pour se lancer (voir pendingAssistantAction plus bas), la
  // déclenche immédiatement -- l'analyste n'a plus besoin de recliquer sur
  // la pastille apres avoir choisi le dossier. Retire aussi le halo bleu
  // laissé sur cette pastille pendant l'attente.
  function setAssistantDossierId(id, label) {
    const combo = document.getElementById('assistantDossierCombo');
    if (!combo) return;
    combo.dataset.value = id;
    document.getElementById('assistantDossierTriggerLabel').textContent = label || 'Aucun — mode général';
    if (pendingAssistantAction && id) {
      const { action, btn } = pendingAssistantAction;
      pendingAssistantAction = null;
      btn?.classList.remove('active');
      runAssistantQuickAction(action, id);
    } else if (!id) {
      pendingAssistantAction?.btn?.classList.remove('active');
      pendingAssistantAction = null;
    } else if (!currentDoc || currentDoc.id !== id) {
      // Necessaire pour que les citations "Voir la source" de la reponse du
      // chat (loadSourcePage, qui lit currentDoc) fonctionnent meme si
      // l'analyste choisit un dossier ici sans jamais etre passe par l'onglet
      // Dossiers -- sans naviguer (pas de goDossierPage, contrairement a
      // openDossier), on reste sur l'ecran AI Agent.
      fetchDocument(id).then(doc => { currentDoc = doc; }).catch(() => {});
    }
    updateDossierBarVisibility();
  }
  const assistantDossierModal = document.getElementById('assistantDossierModal');
  async function populateAssistantDossierModal(includeNone) {
    const body = document.getElementById('assistantDossierModalBody');
    body.innerHTML = '<p class="dossier-modal-empty">Chargement…</p>';
    try {
      const docs = await fetchDocuments();
      const complete = docs.filter(d => d.status === 'complete');
      if (!complete.length && !includeNone) {
        body.innerHTML = '<p class="dossier-modal-empty">Aucun dossier disponible — importez-en un via « Importer un dossier ».</p>';
        return;
      }
      const noneHTML = includeNone ? `<button type="button" class="dossier-modal-option" data-value="">Aucun — mode général</button>` : '';
      body.innerHTML = `<div class="dossier-modal-list">${noneHTML}${complete.map(d => `<button type="button" class="dossier-modal-option" data-value="${d.id}">${(d.ficheIdentite?.adresse?.value) || d.filename}</button>`).join('')}</div>`;
      body.querySelectorAll('.dossier-modal-option').forEach(opt => opt.addEventListener('click', () => {
        hideAssistantDossierModal();
        setAssistantDossierId(opt.dataset.value, opt.textContent);
      }));
    } catch { body.innerHTML = '<p class="dossier-modal-empty">Liste des dossiers indisponible pour le moment.</p>'; }
  }
  function hideAssistantDossierModal() {
    assistantDossierModal.classList.remove('open');
    assistantDossierModal.setAttribute('aria-hidden', 'true');
  }
  // "includeNone" : true pour un clic manuel sur l'indicateur (revenir au
  // mode général reste un choix valide), false quand la pop-up sert à
  // compléter une action qui exige un dossier (le mode général ne
  // répondrait pas au besoin).
  function openAssistantDossierModal(includeNone) {
    populateAssistantDossierModal(includeNone);
    assistantDossierModal.classList.add('open');
    assistantDossierModal.setAttribute('aria-hidden', 'false');
  }
  function closeAssistantDossierModal() {
    hideAssistantDossierModal();
    // Fermeture sans choix (croix / clic hors pop-up / Échap) : annule
    // l'action en attente et retire le halo bleu de la pastille.
    pendingAssistantAction?.btn?.classList.remove('active');
    pendingAssistantAction = null;
    updateDossierBarVisibility();
  }
  document.getElementById('assistantDossierModalClose').addEventListener('click', closeAssistantDossierModal);
  document.getElementById('assistantDossierModalBackdrop').addEventListener('click', closeAssistantDossierModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && assistantDossierModal.classList.contains('open')) closeAssistantDossierModal(); });
  document.getElementById('assistantDossierTrigger')?.addEventListener('click', () => openAssistantDossierModal(true));
  // Mode par defaut = 'normal' (Assistant) -- pas de bouton dedie pour ce
  // mode, seule la pastille "Rechercher sur le web" bascule vers 'web' (et
  // reclique dessus pour revenir a 'normal') : un clic = une bascule, jamais
  // deux boutons a gerer.
  let assistantMode = 'normal';
  // Action "génère la présentation"/"verrouille le simulateur" en attente
  // d'un dossier : posee par le clic sur une pastille quand aucun dossier
  // n'est encore selectionne (voir plus bas), consommee par
  // setAssistantDossierId() des que l'analyste en choisit un.
  let pendingAssistantAction = null;
  const QUICK_LABELS = { generate_presentation: 'Génère la présentation', lock_simulation: 'Verrouille le simulateur pour la présentation' };
  // Declenchement direct (pas de passage par le chat/LLM -- ni echange de
  // message, ni les trois points d'attente) : le texte apparait brievement
  // dans l'espace de prompt pour confirmer visuellement l'action demandee,
  // puis l'ecran de chargement de la Presentation (ou le verrouillage du
  // Simulateur) s'enchaine immediatement.
  function runAssistantQuickAction(quick, dossierId, btn) {
    const input = document.getElementById('assistantInput');
    if (input && QUICK_LABELS[quick]) { input.value = QUICK_LABELS[quick]; input.disabled = true; autoResizeAssistantInput(); }
    Promise.resolve(executeAssistantAction(quick, dossierId, btn)).finally(() => {
      if (input && QUICK_LABELS[quick]) { input.value = ''; input.disabled = false; autoResizeAssistantInput(); }
    });
  }
  // Image jointe a la prochaine question posee a l'Assistant (mode normal
  // uniquement) -- ephemere, consommee a l'envoi (voir sendAssistantQuestion),
  // jamais stockee en base contrairement aux documents annexes d'un dossier.
  let assistantAttachedImage = null;
  function setAssistantAttachedImage(file) {
    const chip = document.getElementById('assistantAttachChip');
    assistantAttachedImage = file || null;
    if (!file) {
      chip.style.display = 'none';
      document.getElementById('assistantAttachInput').value = '';
      return;
    }
    document.getElementById('assistantAttachChipName').textContent = file.name;
    document.getElementById('assistantAttachChipImg').src = URL.createObjectURL(file);
    chip.style.display = 'flex';
  }
  document.getElementById('assistantAttachBtn').addEventListener('click', () => document.getElementById('assistantAttachInput').click());
  document.getElementById('assistantAttachInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) setAssistantAttachedImage(file);
  });
  document.getElementById('assistantAttachChipRemove').addEventListener('click', () => setAssistantAttachedImage(null));

  document.querySelectorAll('[data-agent-quick]').forEach(btn => btn.addEventListener('click', () => {
    const quick = btn.dataset.agentQuick;
    const dossierId = getAssistantDossierId();
    if (quick === 'web') {
      assistantMode = assistantMode === 'web' ? 'normal' : 'web';
      btn.classList.toggle('active', assistantMode === 'web');
      document.getElementById('assistantInput').placeholder = assistantMode === 'web'
        ? 'Ex. « Quels sont les derniers comparables de vente dans ce secteur ? »'
        : 'Assignez une tâche ou posez une question…';
      document.getElementById('assistantInput').focus();
      // La recherche web n'accepte pas d'image jointe (endpoint distinct,
      // sans vision) -- on desactive le trombone et on retire toute image en
      // attente plutot que de la laisser silencieusement ignoree a l'envoi.
      document.getElementById('assistantAttachBtn').disabled = assistantMode === 'web';
      if (assistantMode === 'web') setAssistantAttachedImage(null);
    } else if (quick === 'dossier') {
      // Ouvre directement la pop-up de choix (meme pop-up que celle
      // declenchee par l'indicateur de dossier ou par une action en attente)
      // -- une fois choisi, setAssistantDossierId revele l'indicateur
      // "DOSSIER : ..." (voir updateDossierBarVisibility) : c'est LA ou le
      // contexte selectionne reste visible en permanence, pas besoin d'un
      // etat "actif" separe sur cette pastille elle-meme.
      openAssistantDossierModal(true);
      document.getElementById('assistantInput').focus();
    } else {
      // Si aucun dossier n'est selectionne, executeAssistantAction ouvre
      // elle-meme la pop-up de choix et retient l'action (voir plus haut),
      // en gardant CETTE pastille (btn) en bleu tant qu'on attend -- rien
      // de special a gerer ici, meme chemin dans tous les cas.
      runAssistantQuickAction(quick, dossierId, btn);
    }
  }));
  async function sendAssistantQuestion(question) {
    // La classe d'abord : en conversation le dock passe en absolu avec un
    // autre rembourrage, donc sa hauteur ne peut etre mesuree (pour
    // --agent-dock-h) qu'une fois ce style applique.
    document.getElementById('agentShell')?.classList.add('is-chatting');
    updateAgentShellHeight();
    // Capturee avant reinitialisation (setAssistantAttachedImage(null) plus
    // bas videra la puce) -- consommee une seule fois, pour CETTE question.
    const attachedImage = assistantMode === 'normal' ? assistantAttachedImage : null;
    const imageThumbHTML = attachedImage
      ? `<img class="assistant-msg-image" src="${URL.createObjectURL(attachedImage)}" alt="Image jointe">`
      : '';
    assistantChatRow('user', `${imageThumbHTML}<p>${escapeHtml(question)}</p>`);
    const input = document.getElementById('assistantInput');
    const btn = document.getElementById('assistantSendBtn');
    const dossierId = getAssistantDossierId();
    input.value = ''; input.disabled = true; btn.disabled = true;
    autoResizeAssistantInput();
    setAssistantAttachedImage(null);
    assistantTypingRow();
    try {
      if (assistantMode === 'web') {
        // Vrai stream token par token (voir routes/webSearch.js) : aucune
        // verification par citation a attendre ici (la "citation" EST le
        // lien source, verifiable en un clic), donc rien n'empeche
        // d'afficher le texte du modele au fur et a mesure qu'il arrive.
        let row = null;
        let acc = '';
        let sources = [];
        let streamErr = null;
        const log = document.getElementById('assistantChatLog');
        await streamSSE('/api/web-search', { question, dossierId }, evt => {
          if (evt.type === 'delta') {
            if (!row) { clearAssistantTyping(); row = assistantChatRow('assistant', ''); }
            acc += evt.text;
            row.innerHTML = formatAssistantText(acc);
            if (log) log.scrollTop = log.scrollHeight;
          } else if (evt.type === 'done') {
            sources = evt.sources || [];
          } else if (evt.type === 'error') {
            streamErr = evt.error;
          }
        }).catch(err => { streamErr = err.message || String(err); });
        clearAssistantTyping();
        if (streamErr) {
          assistantChatRow('assistant', `<p class="assistant-caveat">Erreur : ${escapeHtml(streamErr)}</p>`);
        } else if (!row) {
          assistantChatRow('assistant', `<p>${escapeHtml('Aucune réponse trouvée via la recherche web.')}</p>`);
        } else {
          const shown = sources.slice(0, 5);
          const sourcesHTML = shown.length
            ? `<div class="assistant-web-sources">${shown.map(s => `<button type="button" class="assistant-web-source" data-web-url="${escapeHtml(s.url)}" data-web-title="${escapeHtml(s.title || s.url)}">🌐 ${escapeHtml(s.title || s.url)} →</button>`).join('')}</div>`
            : '';
          row.innerHTML = formatAssistantText(acc) + sourcesHTML;
          row.querySelectorAll('[data-web-url]').forEach(b => b.addEventListener('click', () => openAgentWebSource(b.dataset.webUrl, b.dataset.webTitle)));
        }
      } else {
        // Avec image : multipart (le corps JSON par defaut est plafonne trop
        // bas cote serveur pour porter un fichier en base64). Sans image :
        // JSON simple, inchange.
        let res;
        if (attachedImage) {
          const fd = new FormData();
          fd.append('question', question);
          fd.append('dossierId', dossierId);
          fd.append('image', attachedImage);
          res = await fetch('/api/assistant/ask', { method: 'POST', body: fd });
        } else {
          res = await fetch('/api/assistant/ask', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, dossierId }),
          });
        }
        const data = await res.json();
        clearAssistantTyping();
        if (!res.ok) throw new Error(data.error || 'Erreur serveur');
        await renderAssistantAnswer(data);
        if (data.action && data.action !== 'none') await executeAssistantAction(data.action, dossierId);
      }
    } catch (err) {
      clearAssistantTyping();
      assistantChatRow('assistant', `<p class="assistant-caveat">Erreur : ${escapeHtml(err.message)}</p>`);
    } finally {
      input.disabled = false; btn.disabled = false; input.focus();
    }
  }
  document.getElementById('assistantSendBtn').addEventListener('click', () => {
    const input = document.getElementById('assistantInput');
    const v = input.value.trim();
    if (v) sendAssistantQuestion(v);
  });
  document.getElementById('assistantInput').addEventListener('input', autoResizeAssistantInput);
  document.getElementById('assistantInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v) sendAssistantQuestion(v);
    }
  });

  // Appele par simulator.js apres verrouillage reussi du snapshot -- met a
  // jour currentDoc.simulation en place, SANS passer par
  // refreshCurrentDoc()/applyCurrentDocRenders (qui rappellerait
  // window.LeezSimulator.setDossierDoc et reinitialiserait les curseurs que
  // l'analyste vient justement de verrouiller). Si la Presentation est
  // ouverte au moment du verrouillage, la reconstruit silencieusement avec
  // les nouveaux chiffres -- sinon rien a faire, le prochain "genere la
  // presentation" repartira des donnees a jour.
  async function setSimulationSnapshot(simulation) {
    if (!currentDoc) return;
    currentDoc.simulation = simulation;
    if (dpOverlay.style.display !== 'none') {
      const html = await buildDeckHTML(currentDoc);
      document.getElementById('dpStage').innerHTML = html;
      wireDpStage(currentDoc);
      dpShowSlide(dpIdx);
    }
  }
  window.LeezApp = { fetchDocuments, fetchDocument, openSourceModal, setSimulationSnapshot };
})();
