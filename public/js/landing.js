(() => {
  // Carousel vertical : ce sont les LIGNES qui defilent (translateY du
  // track) a travers une fenetre fixe de 5 emplacements ; le masque CSS sur
  // .lp-carousel illumine le centre et efface le haut/bas, donc c'est le
  // texte qui passe qui s'illumine en traversant le centre -- aucune classe
  // de couleur geree ici, uniquement la position.
  //
  // Boucle infinie sans coupure visible : le track contient 2 doublons des
  // 2 DERNIERS elements en tete, les 6 elements reels, puis 3 doublons des
  // 3 PREMIERS elements en queue (defini directement dans landing.html).
  // Avec une fenetre de 5 emplacements (centre = position 2), afficher
  // l'element reel n°0 au centre correspond a la position de track 2 (juste
  // apres les 2 doublons de tete) -- et de nouveau a la position 8 une fois
  // les 6 elements reels parcourus, puisque track[6..10] == track[0..4] en
  // contenu (meme texte). On peut donc, une fois l'animation vers la
  // position 8 terminee, revenir silencieusement (sans transition) a la
  // position 2 : le rendu est pixel-identique, aucun saut visible.
  const track = document.getElementById('lpCarouselTrack');
  const wrap = document.getElementById('lpCarousel');
  if (!track || !wrap) return;

  const LEAD = 2;
  const MAIN = 6;
  const CENTER_SLOT = 2;
  const items = [...track.children];
  if (items.length !== LEAD + MAIN + 3) return; // structure inattendue : on n'anime pas plutôt que de mal calculer

  let pos = LEAD;
  let timer = null;

  function lineHeight() { return items[0].getBoundingClientRect().height; }
  function apply(withTransition) {
    if (!withTransition) track.style.transition = 'none';
    track.style.transform = `translateY(${-(pos - CENTER_SLOT) * lineHeight()}px)`;
    if (!withTransition) {
      void track.offsetHeight; // force le reflow avant de rendre la transition a nouveau active
      track.style.transition = '';
    }
  }
  function step() {
    pos += 1;
    apply(true);
    if (pos === LEAD + MAIN) {
      setTimeout(() => { pos = LEAD; apply(false); }, 920);
    }
  }
  function start() { if (!timer) timer = setInterval(step, 2000); }
  function stop() { clearInterval(timer); timer = null; }

  apply(false);
  wrap.addEventListener('mouseenter', stop);
  wrap.addEventListener('mouseleave', start);

  const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion) start();
})();
