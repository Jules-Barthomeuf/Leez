// Mon compte > Personnalisation : le meme ecran que dans Klocka (mode,
// couleur d'accent, fond, couleur de la barre, halo, police). Chaque geste
// s'applique aussitot a toute l'application et s'enregistre sur le compte
// (public/js/personnalisation.js).
(function () {
  const P = window.LeezPerso;
  const E = window.LeezPersoEtat;
  const zone = document.getElementById('persoPanneau');
  if (!P || !E || !zone) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COCHE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const PIPETTE = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5l5 5M17 2.5l4.5 4.5-3 3-4.5-4.5zM13.5 8.5l-9 9V21h3.5l9-9"/></svg>';
  let etatEnreg = '';

  const pastille = ({ cle, valeur, mot, actif, rond = null, texteRond = '' }) => `
    <button type="button" class="perso-pastille ${rond ? 'avec-rond' : ''}" data-cle="${cle}" data-valeur="${esc(JSON.stringify(valeur))}" aria-pressed="${actif}">
      ${rond ? `<span class="perso-rond ${rond === 'arc' ? 'arc' : ''}" style="${rond !== 'arc' ? `background:${rond};` : ''}${texteRond ? `color:${texteRond};` : ''}">${rond === 'arc' ? PIPETTE : actif ? COCHE : ''}</span>` : ''}${esc(mot)}
    </button>`;

  const ligne = (titre, texte, contenu) => `<div class="perso-ligne"><div><h4>${titre}</h4><p>${texte}</p></div><div>${contenu}</div></div>`;

  // p : les preferences appliquees. L'evenement leez:theme les porte, car il part avant que l'etat courant soit mis a jour.
  function rendre(p = E.courant()) {
    const theme = P.themeEffectif(p);
    const accentPerso = /^#/.test(p.accent);
    const accents = Object.entries(P.ACCENTS).map(([k, a]) => pastille({ cle: 'accent', valeur: k, mot: a.nom, actif: p.accent === k, rond: a[theme], texteRond: theme === 'clair' ? '#fff' : '#121312' })).join('')
      + `<label class="perso-pastille avec-rond" aria-pressed="${accentPerso}"><span class="perso-rond ${accentPerso ? '' : 'arc'}" style="${accentPerso ? `background:${p.accent};color:#121312;` : ''}">${accentPerso ? COCHE : PIPETTE}</span>Personnaliser<input type="color" class="perso-couleur" data-couleur="accent" value="${accentPerso ? p.accent : (p.accent_perso || P.accentHex(p.accent, theme))}"></label>`;
    const fonds = (t) => Object.entries(P.FONDS[t]).map(([k, f]) => pastille({ cle: `fond_${t}`, valeur: k, mot: f.nom, actif: p[`fond_${t}`] === k })).join('');
    const barres = (t) => {
      const v = p[`barre_${t}`];
      const perso = /^#/.test(v);
      return Object.entries(P.BARRES[t]).map(([k, b]) => pastille({ cle: `barre_${t}`, valeur: k, mot: b.nom, actif: v === k, rond: b.teinte, texteRond: t === 'clair' ? '#1c1d1c' : '#f2f2f0' })).join('')
        + `<label class="perso-pastille avec-rond" aria-pressed="${perso}"><span class="perso-rond ${perso ? '' : 'arc'}" style="${perso ? `background:${v};` : ''}">${perso ? '' : PIPETTE}</span>Personnaliser<input type="color" class="perso-couleur" data-couleur="barre_${t}" value="${perso ? v : P.BARRES[t].origine.teinte}"></label>`;
    };
    const barreActuelle = P.barreHex(p, theme);
    const avert = !P.barreLisible(barreActuelle, theme) ? `<div class="perso-avert">Cette teinte rend le texte de la barre difficile à lire : choisissez-la plus ${theme === 'clair' ? 'claire' : 'sombre'}.</div>` : '';
    zone.innerHTML = `
      <h2 class="perso-titre">Personnalisation</h2>
      <p class="perso-sous">Pour vous seul, sur tous vos appareils.</p>
      ${ligne('Mode', "Sombre, clair, ou celui de l'appareil, qui change avec lui.", `<div class="perso-choix">${P.MODES.map(([v, mot]) => pastille({ cle: 'mode', valeur: v, mot, actif: p.mode === v })).join('')}</div>`)}
      ${ligne("Couleur d'accent", 'Boutons, liens, états actifs et pastilles. En clair, la teinte descend d\'un cran pour rester lisible.', `<div class="perso-choix">${accents}</div>`)}
      ${ligne('Fond', "Le fond de l'application, pour chacun des deux modes.", `<div class="perso-sousgroupe">En sombre</div><div class="perso-choix">${fonds('sombre')}</div><div class="perso-sousgroupe">En clair</div><div class="perso-choix">${fonds('clair')}</div>`)}
      ${ligne('Couleur de la barre', 'La barre de gauche, et avec elle le fond des panneaux, des fiches et des listes. Une teinte proposée, ou la vôtre : toujours lisible.', `<div class="perso-sousgroupe">En sombre</div><div class="perso-choix">${barres('sombre')}</div><div class="perso-sousgroupe">En clair</div><div class="perso-choix">${barres('clair')}</div>${avert}`)}
      ${ligne('Halo', "Les nappes de couleur derrière les pages, en sombre. Le clair n'en a jamais.", `<div class="perso-choix">${pastille({ cle: 'halo', valeur: true, mot: 'Avec', actif: p.halo })}${pastille({ cle: 'halo', valeur: false, mot: 'Sans', actif: !p.halo })}</div>`)}
      ${ligne('Police', 'La police de toute l\'application.', `<div class="perso-choix">${Object.entries(P.POLICES).map(([k, f]) => `<button type="button" class="perso-pastille" data-cle="police" data-valeur='${JSON.stringify(k)}' aria-pressed="${p.police === k}" style="font-family:${esc(f.css)}">${esc(f.nom)}</button>`).join('')}</div><div class="perso-etat">${esc(etatEnreg)}</div>`)}`;
  }

  function changer(modif) {
    etatEnreg = 'Enregistrement…';
    E.changer(modif).then(() => { etatEnreg = 'Enregistré sur votre compte.'; rendre(); }).catch((e) => { etatEnreg = e.message; rendre(); });
    rendre();
  }

  zone.addEventListener('click', (ev) => {
    const b = ev.target.closest('button.perso-pastille[data-cle]');
    if (!b) return;
    changer({ [b.dataset.cle]: JSON.parse(b.dataset.valeur) });
  });
  // La pipette : la couleur suit le curseur en direct, l'enregistrement part au relache.
  zone.addEventListener('input', (ev) => {
    const c = ev.target.closest('input.perso-couleur');
    if (!c) return;
    const modif = { [c.dataset.couleur]: c.value };
    if (c.dataset.couleur === 'accent') modif.accent_perso = c.value;
    E.changer(modif).catch(() => {});
  });
  zone.addEventListener('change', (ev) => {
    const c = ev.target.closest('input.perso-couleur');
    if (!c) return;
    const modif = { [c.dataset.couleur]: c.value };
    if (c.dataset.couleur === 'accent') modif.accent_perso = c.value;
    changer(modif);
  });
  window.addEventListener('leez:theme', (e) => { if (!document.activeElement || !document.activeElement.classList.contains('perso-couleur')) rendre(e.detail.prefs); });
  rendre();
}());
