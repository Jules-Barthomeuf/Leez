// Simulateur financier — modèle d'investissement locatif pour un investisseur
// individuel (apport personnel, pas de structure fonds LP/Sponsor) : dette
// amortissable (avec période d'intérêts seuls optionnelle, renégociation
// ponctuelle et IRA associée), imposition IS (véhicule de détention type
// SCI/SARL à l'IS — barème français réel 15 %/25 %, seuil 42 500 €), suivi
// de TVA sur loyer assujetti, négociation du prix à l'acquisition,
// commission d'agence, et analyse de sortie avec plus-value. Seede avec les
// vraies valeurs du dossier ouvert, entièrement éditable. Chaque indicateur
// est cliquable ("Glass-Box") pour afficher sa formule exacte. Pur calcul
// côté client, zéro appel au modèle.
//
// Hypothèses documentées (jamais silencieuses) :
// - Amortissement fiscal linéaire du bâti sur 25 ans, part foncière exclue
//   à 20 % (prixHorsDroits × 0,8 ÷ 25) — convention comptable standard pour
//   un actif locatif détenu à l'IS, pas une estimation propre à un dossier.
// - Barème IS 15 % jusqu'à 42 500 € puis 25 % au-delà — barème réglementaire
//   français réel (PME), avec report du déficit d'une année sur l'autre.
// - Les frais d'acquisition (droits d'enregistrement, frais divers,
//   commission d'agence hors prix) sont financés à due concurrence par
//   l'apport et l'emprunt au jour de l'acquisition (aucune déduction
//   redondante du cash-flow d'exploitation l'année 1) ; ils restent en
//   revanche déductibles de l'assiette fiscale l'année 1, conformément au
//   traitement fiscal standard.
// - IRA (indemnité de remboursement anticipé) modélisée en mois d'intérêts
//   de l'année de renégociation — convention, pas un montant contractuel
//   vérifié.
// - TVA déductible reconstruite sur les postes de service assujettis
//   (frais d'acquisition, gestion, comptabilité, assurance, CapEx) au taux
//   renseigné — Leez ne reçoit pas le détail TTC/HT ligne à ligne, donc
//   cette reconstruction est une approximation raisonnable, pas une donnée
//   vérifiée.
// - Vacance et CapEx modélisés en taux annuel moyen + travaux ponctuels par
//   année (plutôt qu'un calendrier détaillé mois par mois) pour rester
//   lisible.
(() => {
  const { fmt, fmt2 } = window.LeezFmt;

  const defaults = {
    surface: 8000,
    loyerAnnuelInitial: 1050000,
    indexationPct: 2,
    tauxVacancePct: 5,
    loyerSoumisTVA: false,
    tauxTVA: 20,

    prixAffiche: 15000000,
    negociationPct: 0,
    commissionAgentActive: false,
    commissionAgentPct: 5,
    commissionAgentInclusFAI: true,
    tauxDroitsEnregistrement: 5.8,
    fraisDossierBancaire: 15000,
    coutCreationSociete: 3000,
    fraisCourtage: 0,

    // Refacturabilite des charges/taxe fonciere : fixee a "refacturable" (bail
    // net, convention institutionnelle courante) par defaut -- ajustable via
    // le pilotage par langage.
    chargesCoproRefacturable: true,
    taxeFonciereRefacturable: true,
    chargesCoproAnnuelles: 0,
    taxeFonciereAnnuelle: 90000,
    fraisGestionPct: 3,
    fraisComptabilite: 12000,
    assurancePNO: 9000,
    chargesDiverses: 0,
    // CapEx ponctuel par annee (cle = numero d'annee, valeur = montant EUR),
    // typiquement seede depuis une ligne de travaux sourcee (ex. audit ESG) --
    // pas de slider dedie, alimente par le pilotage par langage / les sources.
    capexPonctuels: {},
    // Vacance ponctuelle additionnelle par annee (cle = numero d'annee, valeur
    // = perte de loyer EUR, s'ajoute au taux de vacance courant) -- utilisee
    // par les stress-tests (depart locataire reel, vacance prolongee) sans
    // toucher a l'hypothese de vacance structurelle.
    vacanceExtraPonctuelle: {},

    apport: 3000000,
    dureeCreditAns: 20,
    tauxInteretPct: 3.8,
    periodeInFineAns: 0,
    tauxAssuranceCreditPct: 0.25,
    renegociationActive: false,
    anneeRenegociation: 10,
    nouveauTauxRenegociation: 2.5,
    iraRenegociationMois: 3,

    anneeSortie: 10,
    rendementSortiePct: 6.0,
    commissionRentePct: 5,
  };
  let state = { ...defaults };

  const FIELD = {
    surface: { label: 'Surface (m²)', min: 200, max: 60000, step: 100, unit: 'm2', section: 'bien' },
    loyerAnnuelInitial: { label: 'Loyer annuel initial (HT/HC)', min: 50000, max: 15000000, step: 10000, unit: 'eur', section: 'bien' },
    indexationPct: { label: 'Indexation annuelle des loyers', min: 0, max: 6, step: 0.1, unit: 'pct', section: 'bien' },
    tauxVacancePct: { label: 'Taux de vacance', min: 0, max: 30, step: 0.5, unit: 'pct', section: 'bien' },
    tauxTVA: { label: 'Taux de TVA (si loyer assujetti)', min: 0, max: 25, step: 0.5, unit: 'pct', section: 'bien' },
    loyerSoumisTVA: { label: 'Loyer soumis à TVA', min: 0, max: 1, step: 1, unit: 'bool', section: 'bien' },

    prixAffiche: { label: 'Prix affiché (FAI)', min: 1000000, max: 150000000, step: 100000, unit: 'eur', section: 'acquisition' },
    negociationPct: { label: 'Négociation sur le prix affiché', min: 0, max: 20, step: 0.5, unit: 'pct', section: 'acquisition' },
    commissionAgentPct: { label: "Commission d'agence", min: 0, max: 10, step: 0.5, unit: 'pct', section: 'acquisition' },
    commissionAgentActive: { label: "Commission d'agence active", min: 0, max: 1, step: 1, unit: 'bool', section: 'acquisition' },
    commissionAgentInclusFAI: { label: 'Commission incluse dans le prix affiché', min: 0, max: 1, step: 1, unit: 'bool', section: 'acquisition' },
    tauxDroitsEnregistrement: { label: "Droits d'enregistrement", min: 0, max: 10, step: 0.1, unit: 'pct', section: 'acquisition' },
    fraisDossierBancaire: { label: 'Frais de dossier bancaire', min: 0, max: 100000, step: 1000, unit: 'eur', section: 'acquisition' },
    coutCreationSociete: { label: 'Coût de création de la société', min: 0, max: 20000, step: 500, unit: 'eur', section: 'acquisition' },
    fraisCourtage: { label: 'Frais de courtage', min: 0, max: 100000, step: 1000, unit: 'eur', section: 'acquisition' },

    chargesCoproAnnuelles: { label: 'Charges de copropriété (non refacturables)', min: 0, max: 2000000, step: 5000, unit: 'eur', section: 'exploitation' },
    taxeFonciereAnnuelle: { label: 'Taxe foncière (non refacturable)', min: 0, max: 2000000, step: 5000, unit: 'eur', section: 'exploitation' },
    fraisGestionPct: { label: 'Honoraires de gestion locative', min: 0, max: 10, step: 0.5, unit: 'pct', section: 'exploitation' },
    fraisComptabilite: { label: 'Comptabilité (annuel)', min: 0, max: 100000, step: 1000, unit: 'eur', section: 'exploitation' },
    assurancePNO: { label: 'Assurance propriétaire non occupant', min: 0, max: 100000, step: 1000, unit: 'eur', section: 'exploitation' },
    chargesDiverses: { label: 'Charges diverses', min: 0, max: 200000, step: 2000, unit: 'eur', section: 'exploitation' },
    chargesCoproRefacturable: { label: 'Charges copropriété refacturables', min: 0, max: 1, step: 1, unit: 'bool', section: 'exploitation' },
    taxeFonciereRefacturable: { label: 'Taxe foncière refacturable', min: 0, max: 1, step: 1, unit: 'bool', section: 'exploitation' },

    apport: { label: 'Apport', min: 100000, max: 60000000, step: 50000, unit: 'eur', section: 'financement' },
    dureeCreditAns: { label: 'Durée du crédit', min: 5, max: 30, step: 1, unit: 'ans', section: 'financement' },
    tauxInteretPct: { label: "Taux d'intérêt", min: 0.5, max: 10, step: 0.1, unit: 'pct', section: 'financement' },
    periodeInFineAns: { label: "Période d'intérêts seuls", min: 0, max: 10, step: 1, unit: 'ans', section: 'financement' },
    tauxAssuranceCreditPct: { label: 'Assurance crédit', min: 0, max: 1, step: 0.05, unit: 'pct', section: 'financement' },
    renegociationActive: { label: 'Renégociation active', min: 0, max: 1, step: 1, unit: 'bool', section: 'financement' },
    anneeRenegociation: { label: 'Année de renégociation', min: 1, max: 25, step: 1, unit: 'ans', section: 'financement' },
    nouveauTauxRenegociation: { label: 'Nouveau taux après renégociation', min: 0, max: 10, step: 0.1, unit: 'pct', section: 'financement' },
    iraRenegociationMois: { label: "IRA (mois d'intérêts)", min: 0, max: 6, step: 0.5, unit: 'mois', section: 'financement' },

    anneeSortie: { label: 'Année de sortie', min: 1, max: 25, step: 1, unit: 'ans', section: 'sortie' },
    rendementSortiePct: { label: 'Rendement acheteur à la sortie', min: 3, max: 12, step: 0.1, unit: 'pct', section: 'sortie' },
    commissionRentePct: { label: 'Commission agent à la revente', min: 0, max: 8, step: 0.1, unit: 'pct', section: 'sortie' },
  };

  // Sections affichees avec un slider dans le panneau lateral -- les champs
  // ci-dessus qui n'y figurent pas (booleens, renegociation) restent
  // pilotables uniquement via le pilotage par langage, meme convention que
  // le reste de l'outil.
  const SECTIONS = {
    bien: ['surface', 'loyerAnnuelInitial', 'indexationPct', 'tauxVacancePct', 'tauxTVA'],
    acquisition: ['prixAffiche', 'negociationPct', 'commissionAgentPct', 'tauxDroitsEnregistrement', 'fraisDossierBancaire', 'coutCreationSociete', 'fraisCourtage'],
    exploitation: ['chargesCoproAnnuelles', 'taxeFonciereAnnuelle', 'fraisGestionPct', 'fraisComptabilite', 'assurancePNO', 'chargesDiverses'],
    financement: ['apport', 'dureeCreditAns', 'tauxInteretPct', 'periodeInFineAns', 'tauxAssuranceCreditPct'],
    sortie: ['anneeSortie', 'rendementSortiePct', 'commissionRentePct'],
  };
  const SECTION_TARGET = { bien: 'secBien', acquisition: 'secAcquisition', exploitation: 'secExploitation', financement: 'secFinancement', sortie: 'secSortie' };

  function fmtField(key, v) {
    const u = FIELD[key].unit;
    if (u === 'eur') return fmt(Math.round(v)) + ' €';
    if (u === 'pct') return fmt2(v) + ' %';
    if (u === 'ans') return Math.round(v) + ' ans';
    if (u === 'mois') return fmt2(v) + ' mois';
    if (u === 'm2') return fmt(Math.round(v)) + ' m²';
    if (u === 'bool') return v ? 'Oui' : 'Non';
    return String(v);
  }
  function renderSlider(key) {
    const f = FIELD[key];
    return `<div class="sim-field">
      <div class="sim-field-row"><span class="flabel">${f.label}</span><span class="fval" data-fval="${key}">${fmtField(key, state[key])}</span></div>
      <input type="range" class="sim-slider" data-field="${key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${state[key]}">
    </div>`;
  }
  function buildSections() {
    Object.keys(SECTIONS).forEach(section => {
      const el = document.getElementById(SECTION_TARGET[section]);
      if (el) el.innerHTML = SECTIONS[section].map(renderSlider).join('');
    });
  }
  function syncField(key) {
    document.querySelectorAll(`[data-fval="${key}"]`).forEach(el => el.textContent = fmtField(key, state[key]));
    document.querySelectorAll(`input.sim-slider[data-field="${key}"]`).forEach(el => el.value = state[key]);
  }

  function calculateIRR(cashflows, guess = 0.08) {
    const maxIter = 1000, precision = 1e-9;
    let rate = guess;
    for (let i = 0; i < maxIter; i++) {
      let npv = 0, dNpv = 0;
      for (let t = 0; t < cashflows.length; t++) {
        npv += cashflows[t] / Math.pow(1 + rate, t);
        dNpv -= (t * cashflows[t]) / Math.pow(1 + rate, t + 1);
      }
      if (!Number.isFinite(npv) || !Number.isFinite(dNpv) || dNpv === 0) return NaN;
      let newRate = rate - npv / dNpv;
      if (!Number.isFinite(newRate)) return NaN;
      newRate = Math.max(-0.9, Math.min(5, newRate));
      if (Math.abs(newRate - rate) < precision) return newRate;
      rate = newRate;
    }
    return NaN;
  }
  function safePct(v) { return Number.isFinite(v) ? fmt2(v * 100) : '—'; }
  function safeX(v) { return Number.isFinite(v) ? fmt2(v) + 'x' : '—'; }
  function round1(n) { return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; }
  function round2(n) { return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }

  // ---------- IS (barème réel français, PME) ----------
  const IS_SEUIL = 42500, IS_TAUX_REDUIT = 0.15, IS_TAUX_NORMAL = 0.25;
  function calculerIS(assietteApresReportDeficit) {
    if (assietteApresReportDeficit <= 0) return 0;
    return assietteApresReportDeficit <= IS_SEUIL
      ? assietteApresReportDeficit * IS_TAUX_REDUIT
      : IS_SEUIL * IS_TAUX_REDUIT + (assietteApresReportDeficit - IS_SEUIL) * IS_TAUX_NORMAL;
  }

  // ---------- dette : amortissement mensuel, IO optionnelle, renégociation ponctuelle ----------
  function buildDebtSchedule(s, montantEmprunt, horizonMois) {
    const ioMois = Math.round(s.periodeInFineAns * 12);
    const renegoMois = s.renegociationActive ? Math.round(s.anneeRenegociation * 12) : null;
    let rate = s.tauxInteretPct / 100 / 12;
    let amortMoisRestant = Math.round(s.dureeCreditAns * 12) - ioMois;
    let payment = amortMoisRestant > 0
      ? montantEmprunt * rate / (1 - Math.pow(1 + rate, -amortMoisRestant))
      : montantEmprunt / Math.max(horizonMois - ioMois, 1);
    const schedule = [];
    let balance = montantEmprunt;
    for (let m = 1; m <= horizonMois; m++) {
      if (renegoMois && m === renegoMois + 1) {
        rate = s.nouveauTauxRenegociation / 100 / 12;
        const dureeRestante = Math.max(Math.round(s.dureeCreditAns * 12) - m + 1, 12);
        payment = rate > 0 ? balance * rate / (1 - Math.pow(1 + rate, -dureeRestante)) : balance / dureeRestante;
      }
      const interest = balance * rate;
      let principal, pmt;
      if (m <= ioMois) { principal = 0; pmt = interest; }
      else { pmt = payment; principal = Math.min(Math.max(pmt - interest, 0), balance); }
      balance = Math.max(balance - principal, 0);
      schedule.push({ month: m, interest, principal, payment: pmt, balance });
    }
    return schedule;
  }

  // ---------- moteur annuel complet ----------
  function computeModel(s) {
    const anneeSortie = Math.max(1, Math.round(s.anneeSortie));
    const prixNegocie = s.prixAffiche * (1 - s.negociationPct / 100);
    const honorairesAgent = s.commissionAgentActive ? prixNegocie * s.commissionAgentPct / 100 : 0;
    const prixHorsDroits = s.commissionAgentInclusFAI ? (prixNegocie - honorairesAgent) : prixNegocie;
    const droitsEnregistrement = prixHorsDroits * s.tauxDroitsEnregistrement / 100;
    const fraisDivers = s.fraisDossierBancaire + s.coutCreationSociete + s.fraisCourtage;
    const coutAcquisitionTotal = droitsEnregistrement + fraisDivers + (s.commissionAgentInclusFAI ? 0 : honorairesAgent);
    const prixRevient = prixNegocie + coutAcquisitionTotal;

    const montantEmprunt = Math.max(prixRevient - s.apport, 0);

    const debtSchedule = buildDebtSchedule(s, montantEmprunt, anneeSortie * 12);
    const amortissementFiscalAnnuel = prixHorsDroits * 0.8 / 25; // convention comptable standard (bati/25 ans, hors foncier)

    const annees = [];
    let loyerAnnuel = s.loyerAnnuelInitial;
    let deficitReporte = 0;
    let deficitReporteProjet = 0; // report de deficit SEPARE pour le calcul non leve (assiette differente sans interets)
    let creditTVAReporte = 0;
    let cumulCashFlow = 0;

    for (let annee = 1; annee <= anneeSortie; annee++) {
      if (annee > 1) loyerAnnuel *= (1 + s.indexationPct / 100);
      const vacanceExtra = (s.vacanceExtraPonctuelle && s.vacanceExtraPonctuelle[annee]) || 0;
      const coutVacance = loyerAnnuel * s.tauxVacancePct / 100 + vacanceExtra;
      const chargesCoproNonRefact = s.chargesCoproRefacturable ? 0 : s.chargesCoproAnnuelles;
      const taxeFonciereNonRefact = s.taxeFonciereRefacturable ? 0 : s.taxeFonciereAnnuelle;
      const loyersNets = loyerAnnuel - coutVacance - chargesCoproNonRefact - taxeFonciereNonRefact;

      const moisDebut = (annee - 1) * 12, moisFin = annee * 12;
      const yearDebt = debtSchedule.slice(moisDebut, moisFin);
      const interets = yearDebt.reduce((a, r) => a + r.interest, 0);
      const capitalRembourse = yearDebt.reduce((a, r) => a + r.principal, 0);
      const echeance = yearDebt.reduce((a, r) => a + r.payment, 0);
      const capitalRestantDu = yearDebt.length ? yearDebt[yearDebt.length - 1].balance : 0;
      const assuranceCredit = montantEmprunt * s.tauxAssuranceCreditPct / 100;

      // IRA (indemnite de remboursement anticipe) : penalite ponctuelle
      // l'annee de renegociation, exprimee en mois d'interets de l'annee.
      const iraCost = (s.renegociationActive && annee === Math.round(s.anneeRenegociation))
        ? interets * (s.iraRenegociationMois / 12) : 0;

      const baseGestion = loyerAnnuel - coutVacance - (s.chargesCoproRefacturable ? s.chargesCoproAnnuelles : 0) - (s.taxeFonciereRefacturable ? s.taxeFonciereAnnuelle : 0);
      const fraisGestion = baseGestion * s.fraisGestionPct / 100;
      const capexPonctuel = (s.capexPonctuels && s.capexPonctuels[annee]) || 0;
      const chargesExploitation = fraisGestion + s.fraisComptabilite + s.assurancePNO + s.chargesDiverses + capexPonctuel;
      const chargesAcquisitionAnnee1 = annee === 1 ? coutAcquisitionTotal : 0;
      // DSCR = NOI (loyers nets APRES charges d'exploitation) / service de
      // la dette -- jamais loyersNets seul, qui ne deduit que vacance et
      // taxe fonciere/copro non refacturables, pas les charges de gestion
      // courantes : un DSCR calcule avant ces charges surestime la capacite
      // reelle de remboursement, un ecart qu'un analyste de dette detecte
      // immediatement.
      const dscr = echeance > 0 ? (loyersNets - chargesExploitation) / echeance : null;

      let assiette = loyersNets - amortissementFiscalAnnuel - interets - iraCost - chargesExploitation - chargesAcquisitionAnnee1;
      assiette += deficitReporte; // le report ne s'applique qu'une fois, dans le calcul de l'annee ou il est consomme
      deficitReporte = assiette < 0 ? assiette : 0;
      const impotIS = calculerIS(assiette);

      // Assiette NON LEVEE (TRI projet, plus bas) : memes charges reelles,
      // mais SANS interets ni IRA (pas de dette dans un scenario 100% fonds
      // propres) -- report de deficit tenu separement, l'assiette differente
      // annee par annee ne consomme pas le meme montant.
      let assietteProjet = loyersNets - amortissementFiscalAnnuel - chargesExploitation - chargesAcquisitionAnnee1;
      assietteProjet += deficitReporteProjet;
      deficitReporteProjet = assietteProjet < 0 ? assietteProjet : 0;
      const impotISProjet = calculerIS(assietteProjet);

      let tvaCollectee = 0, tvaDeductible = 0, tvaNetCashFlow = 0;
      if (s.loyerSoumisTVA) {
        tvaCollectee = loyerAnnuel * s.tauxTVA / 100;
        const baseDeductible = chargesExploitation + (annee === 1 ? coutAcquisitionTotal : 0);
        tvaDeductible = baseDeductible * s.tauxTVA / 100;
        if (tvaCollectee >= tvaDeductible) { tvaNetCashFlow = -(tvaCollectee - tvaDeductible); creditTVAReporte = 0; }
        else { const creditGenere = tvaDeductible - tvaCollectee; tvaNetCashFlow = 0; creditTVAReporte += creditGenere; }
      }

      // Les frais d'acquisition sont deja finances par l'apport + l'emprunt
      // au jour de l'acquisition (prixRevient = apport + montantEmprunt) --
      // ils ne sont donc PAS re-deduits ici du cash-flow d'exploitation,
      // seulement de l'assiette fiscale ci-dessus (deduction reelle, distincte
      // du financement).
      let cashFlow = loyersNets - echeance - assuranceCredit - iraCost - chargesExploitation - impotIS + tvaNetCashFlow;
      // Cash-flow D'EXPLOITATION pur (avant l'eventuel produit de cession
      // ajoute plus bas pour l'annee de sortie) -- utilise pour la moyenne
      // annuelle (cashFlowMoyenAn ci-dessous) : melanger un flux d'exploitation
      // recurrent avec un flux de cession ponctuel dans une meme moyenne "par
      // an" produit un chiffre incoherent avec le tableau annuel (l'annee de
      // sortie n'est pas "une annee comme les autres"). Le cash-flow total
      // AVEC produit de cession reste utilise pour le TRI/MoIC/cumul, ou
      // l'inclusion est correcte (rendement reel de l'investisseur).
      const cashFlowOperationnel = cashFlow;
      // Cash-flow PROJET (non leve) : memes loyers/charges reels, jamais de
      // service de la dette (aucun emprunt dans ce scenario) -- isole la
      // performance de l'actif de l'effet de levier, pour le TRI projet.
      let cashFlowProjet = loyersNets - chargesExploitation - impotISProjet;

      let produitNetCession = null, plusValue = null, impotPlusValue = null, prixVenteFAI = null;
      let commissionRevente = null, prixVenteNet = null;
      if (annee === anneeSortie) {
        prixVenteFAI = s.rendementSortiePct > 0 ? loyerAnnuel / (s.rendementSortiePct / 100) : 0;
        commissionRevente = prixVenteFAI * s.commissionRentePct / 100;
        prixVenteNet = prixVenteFAI - commissionRevente;
        const amortissementCumule = amortissementFiscalAnnuel * anneeSortie;
        const valeurNetteComptable = Math.max(prixHorsDroits * 0.8 - amortissementCumule, 0);
        plusValue = prixVenteNet - valeurNetteComptable;
        impotPlusValue = plusValue > 0 ? calculerIS(plusValue) : 0;
        produitNetCession = prixVenteNet - capitalRestantDu - impotPlusValue;
        cashFlow += produitNetCession;
        // Produit de cession NON LEVE : pas de CRD a rembourser (aucune
        // dette dans ce scenario), seulement le prix net et l'impot.
        cashFlowProjet += (prixVenteNet - impotPlusValue);
      }

      cumulCashFlow += cashFlow;
      // NOI = loyers nets APRES charges d'exploitation (meme numerateur que
      // le DSCR corrige ci-dessus) -- l'indicateur qu'un comite
      // d'investissement cherche en premier dans un tableau annuel.
      const noi = loyersNets - chargesExploitation;
      // LTV annuelle rapportee au PRIX DE REVIENT (cout d'acquisition
      // total), jamais a une valeur de revente hypothetique future -- la
      // seule base qui ne suppose aucune appreciation/depreciation non
      // demontree du bien.
      const ltvSurCoutPct = prixRevient > 0 ? round2(capitalRestantDu / prixRevient * 100) : null;

      annees.push({
        annee, loyerAnnuel, coutVacance, chargesCoproNonRefact, taxeFonciereNonRefact, loyersNets,
        interets, capitalRembourse, echeance, capitalRestantDu, assuranceCredit, iraCost,
        fraisGestion, chargesExploitation, assiette, impotIS, deficitReporte,
        tvaCollectee, tvaDeductible, tvaNetCashFlow, creditTVAReporte,
        cashFlow, cashFlowOperationnel, cashFlowProjet, cumulCashFlow, prixVenteFAI, commissionRevente, prixVenteNet,
        produitNetCession, plusValue, impotPlusValue,
        capexPonctuel, dscr, noi, ltvSurCoutPct,
      });
    }

    // DSCR moyen hors periode in fine (echeance = interets seuls, ratio non
    // comparable a l'exigence bancaire classique) ; si tout est in fine, on
    // retombe sur la moyenne simple.
    const dscrAnnees = annees.filter(a => a.dscr !== null && a.annee > s.periodeInFineAns);
    const dscrPourMoyenne = dscrAnnees.length ? dscrAnnees : annees.filter(a => a.dscr !== null);
    const avgDscr = dscrPourMoyenne.length ? dscrPourMoyenne.reduce((s2, a) => s2 + a.dscr, 0) / dscrPourMoyenne.length : null;
    const goingInCapRate = prixRevient > 0 ? s.loyerAnnuelInitial / prixRevient : null;

    const investorCF = [-s.apport, ...annees.map(a => a.cashFlow)];
    const tri = calculateIRR(investorCF);
    const totalDistribue = annees.reduce((s2, a) => s2 + a.cashFlow, 0);
    const moic = s.apport > 0 ? totalDistribue / s.apport : NaN;

    // TRI projet (non leve) : memes flux d'exploitation/cession reels, mais
    // AUCUN financement -- sortie initiale = prix de revient integral, pas
    // l'apport. Isole la performance de l'actif de l'effet de levier ;
    // distinct du TRI fonds propres ci-dessus, les deux sont attendus par
    // un comite d'investissement.
    const projetCF = [-prixRevient, ...annees.map(a => a.cashFlowProjet)];
    const triProjet = calculateIRR(projetCF);

    const cashFlowMoyenAn = annees.length ? annees.reduce((s2, a) => s2 + a.cashFlowOperationnel, 0) / annees.length : 0;
    const cashFlowMoyenMois = cashFlowMoyenAn / 12;
    const rendementLocatifMoyen = annees.length ? annees.reduce((s2, a) => s2 + a.loyersNets, 0) / annees.length / prixRevient : 0;

    let anneeRecuperation = null, cumul = 0;
    for (const a of annees) {
      cumul += a.cashFlow;
      if (anneeRecuperation === null && s.apport > 0 && cumul >= s.apport) { anneeRecuperation = a.annee; break; }
    }

    return {
      anneeSortie, prixRevient, coutAcquisitionTotal, prixNegocie, droitsEnregistrement, honorairesAgent, fraisDivers,
      commissionAgentInclusFAI: s.commissionAgentInclusFAI,
      montantEmprunt, apport: s.apport, annees,
      tri, triProjet, moic, cashFlowMoyenAn, cashFlowMoyenMois, rendementLocatifMoyen, anneeRecuperation,
      avgDscr, goingInCapRate,
    };
  }

  // ---------- KPI + glass-box ----------
  let lastModel = null;
  const formulaRegistry = {
    tri: {
      title: 'TRI fonds propres',
      formula: 'TRI du flux annuel : [ -Apport ; cash-flow disponible an 1…N (dont produit net de cession) ]',
      desc: "Taux de rendement interne calculé sur les seuls fonds propres apportés (flux LEVIER, après emprunt) -- distinct du TRI projet (flux non levier, avant financement), voir juste à côté.",
      vars: m => [['Apport investi', fmt(Math.round(m.apport)) + ' €'], ['TRI calculé', safePct(m.tri) + ' %']],
    },
    triProjet: {
      title: 'TRI projet',
      formula: 'TRI du flux annuel : [ -Prix de revient ; NOI − IS (non levier) an 1…N, dont produit de cession AVANT remboursement du CRD ]',
      desc: "Taux de rendement interne calculé SANS financement (comme si le bien était acquis 100 % en fonds propres) -- isole la performance intrinsèque de l'actif de l'effet de levier de la dette.",
      vars: m => [['Prix de revient', fmt(Math.round(m.prixRevient)) + ' €'], ['TRI projet calculé', safePct(m.triProjet) + ' %']],
    },
    moic: {
      title: 'Multiple (MoIC)',
      formula: 'MoIC = Total des cash-flows distribués ÷ Apport investi',
      desc: 'Multiple sur capital investi.',
      vars: m => [['Apport investi', fmt(Math.round(m.apport)) + ' €'], ['Multiple calculé', safeX(m.moic)]],
    },
    equity: {
      title: 'Apport',
      formula: "Apport = montant investi en fonds propres ; le solde du prix de revient est couvert par l'emprunt",
      desc: "Capital propre apporté par l'investisseur ; prix de revient net de cet apport = montant emprunté.",
      vars: m => [['Prix de revient', fmt(Math.round(m.prixRevient)) + ' €'], ['Montant emprunté', fmt(Math.round(m.montantEmprunt)) + ' €'], ['Apport', fmt(Math.round(m.apport)) + ' €']],
    },
    cashflow: {
      title: "Cash-flow d'exploitation moyen / an",
      formula: "Moyenne des cash-flows D'EXPLOITATION annuels (loyers nets − dette − charges − IS ± TVA), sur la durée de détention -- exclut le produit net de cession de l'année de sortie (flux ponctuel, pas un flux annuel récurrent, voir le tableau de sortie)",
      desc: "Cash-flow d'exploitation net moyen généré chaque année par l'investissement, hors flux de cession.",
      vars: m => [['Cash-flow moyen / an', fmt(Math.round(m.cashFlowMoyenAn)) + ' €']],
    },
    cashflowMensuel: {
      title: "Cash-flow d'exploitation moyen / mois",
      formula: "Cash-flow d'exploitation moyen / an ÷ 12",
      desc: "Cash-flow d'exploitation net moyen mensualisé, hors flux de cession.",
      vars: m => [['Cash-flow moyen / mois', fmt(Math.round(m.cashFlowMoyenMois)) + ' €']],
    },
    rendement: {
      title: 'Rendement locatif net moyen',
      formula: "Moyenne(loyers nets de l'année ÷ prix de revient), sur la durée de détention",
      desc: "Rendement locatif net moyen rapporté au prix de revient total.",
      vars: m => [['Rendement net moyen', safePct(m.rendementLocatifMoyen) + ' %']],
    },
  };
  function openFormulaModal(id) {
    const def = formulaRegistry[id];
    if (!def || !lastModel) return;
    document.getElementById('formulaModalTitle').textContent = def.title;
    document.getElementById('formulaModalExpr').textContent = def.formula;
    document.getElementById('formulaModalDesc').textContent = def.desc;
    document.getElementById('formulaModalVars').innerHTML = def.vars(lastModel).map(([l, v]) => `<div class="formula-var-row"><span>${l}</span><b>${v}</b></div>`).join('');
    document.getElementById('formulaModal').classList.add('open');
    document.getElementById('formulaModal').setAttribute('aria-hidden', 'false');
  }
  function closeFormulaModal() {
    document.getElementById('formulaModal').classList.remove('open');
    document.getElementById('formulaModal').setAttribute('aria-hidden', 'true');
  }
  function renderKpiHero(m) {
    const cards = [
      ['tri', 'TRI fonds propres', safePct(m.tri) + ' %'],
      ['triProjet', 'TRI projet', safePct(m.triProjet) + ' %'],
      ['moic', 'Multiple (MoIC)', safeX(m.moic)],
      ['cashflow', "Cash-flow d'exploitation moyen / an", fmt(Math.round(m.cashFlowMoyenAn)) + ' €'],
      ['cashflowMensuel', "Cash-flow d'exploitation moyen / mois", fmt(Math.round(m.cashFlowMoyenMois)) + ' €'],
      ['equity', 'Apport', fmt(Math.round(m.apport)) + ' €'],
      ['rendement', 'Rendement locatif net moyen', safePct(m.rendementLocatifMoyen) + ' %'],
    ];
    document.getElementById('kpiHeroGrid').innerHTML = cards.map(([id, label, val]) => `
      <div class="kpi-glass" data-formula="${id}">
        <div class="label">${label}</div>
        <div class="stat-num">${val}</div>
        <div class="kpi-glass-hint">Voir la formule →</div>
      </div>`).join('');
    document.querySelectorAll('#kpiHeroGrid .kpi-glass').forEach(card => card.addEventListener('click', () => openFormulaModal(card.dataset.formula)));
  }

  function renderSourcesUses(m) {
    const uses = [
      ['Prix négocié', m.prixNegocie],
      ["Droits d'enregistrement", m.droitsEnregistrement],
      ...(m.commissionAgentInclusFAI || m.honorairesAgent === 0 ? [] : [["Honoraires d'agence", m.honorairesAgent]]),
      ['Frais divers', m.fraisDivers],
    ];
    const sources = [['Emprunt', m.montantEmprunt], ['Apport', m.apport]];
    const totalUses = uses.reduce((a, [, v]) => a + v, 0), totalSources = sources.reduce((a, [, v]) => a + v, 0);
    const col = (rows, total) => rows.map(([l, v]) => `<tr><td>${l}</td><td class="num">${fmt(Math.round(v))} €</td></tr>`).join('') + `<tr style="font-weight:700;"><td>Total</td><td class="num">${fmt(Math.round(total))} €</td></tr>`;
    document.getElementById('msUsesTable').innerHTML = `<thead><tr><th>Emplois</th><th class="num">Montant</th></tr></thead><tbody>${col(uses, totalUses)}</tbody>`;
    document.getElementById('msSourcesTable').innerHTML = `<thead><tr><th>Ressources</th><th class="num">Montant</th></tr></thead><tbody>${col(sources, totalSources)}</tbody>`;
  }

  function renderAnnualTable(m) {
    const rows = m.annees;
    const thead = '<thead><tr><th>Poste</th>' + rows.map(r => `<th>An ${r.annee}</th>`).join('') + '</tr></thead>';
    const lines = [
      ['Loyers faciaux', r => fmt(Math.round(r.loyerAnnuel)) + ' €'],
      ['Loyers encaissés', r => fmt(Math.round(r.loyersNets)) + ' €'],
      ["Charges non récupérables", r => '-' + fmt(Math.round(r.chargesExploitation)) + ' €'],
      ["Résultat net d'exploitation (NOI)", r => fmt(Math.round(r.noi)) + ' €'],
      ['CAPEX / travaux', r => r.capexPonctuel ? '-' + fmt(Math.round(r.capexPonctuel)) + ' €' : '—'],
      ['Intérêts', r => '-' + fmt(Math.round(r.interets)) + ' €'],
      ['Amortissement du capital', r => '-' + fmt(Math.round(r.capitalRembourse)) + ' €'],
      ['Service de la dette (total)', r => '-' + fmt(Math.round(r.echeance)) + ' €'],
      ['Capital restant dû (CRD)', r => fmt(Math.round(r.capitalRestantDu)) + ' €'],
      ['LTV (sur coût d\'acquisition)', r => r.ltvSurCoutPct != null ? fmt2(r.ltvSurCoutPct) + ' %' : '—'],
      ['DSCR', r => r.dscr != null ? safeX(r.dscr) : '—'],
      ["Indemnité de remboursement anticipé (IRA)", r => r.iraCost ? '-' + fmt(Math.round(r.iraCost)) + ' €' : '—'],
      ['Impôt sur les sociétés (IS)', r => r.impotIS ? '-' + fmt(Math.round(r.impotIS)) + ' €' : '—'],
      ['Cash-flow disponible (après IS)', r => fmt(Math.round(r.cashFlow)) + ' €'],
      ['Cash-flow cumulé', r => fmt(Math.round(r.cumulCashFlow)) + ' €'],
      ['Produit net de cession', r => r.produitNetCession != null ? fmt(Math.round(r.produitNetCession)) + ' €' : '—'],
    ];
    document.getElementById('simTableDetail').innerHTML = thead + '<tbody>' + lines.map(([label, fn]) => `<tr><td>${label}</td>${rows.map(r => `<td>${fn(r)}</td>`).join('')}</tr>`).join('') + '</tbody>';
    document.getElementById('simHoldLabel').textContent = `SUR ${m.anneeSortie} AN${m.anneeSortie > 1 ? 'S' : ''}`;
  }

  function renderExitSummary(m) {
    const last = m.annees[m.annees.length - 1];
    document.getElementById('msExitPanel').innerHTML = [
      ['Valeur de sortie (prix de vente FAI)', fmt(Math.round(last.prixVenteFAI)) + ' €'],
      ['Frais de cession', '-' + fmt(Math.round(last.commissionRevente)) + ' €'],
      ['Prix de vente net', fmt(Math.round(last.prixVenteNet)) + ' €'],
      ['Remboursement du capital restant dû (CRD)', '-' + fmt(Math.round(last.capitalRestantDu)) + ' €'],
      ['Plus-value imposable', fmt(Math.round(last.plusValue)) + ' €'],
      ['Impôt sur la plus-value', '-' + fmt(Math.round(last.impotPlusValue)) + ' €'],
      ['Produit net de cession', fmt(Math.round(last.produitNetCession)) + ' €'],
      ["Année de récupération de l'apport", m.anneeRecuperation ? `Année ${m.anneeRecuperation}` : 'Non atteinte sur la période'],
    ].map(([l, v]) => `<div class="stat-card"><div class="label">${l}</div><div class="stat-num">${v}</div></div>`).join('');
  }

  // ---------- visuels : donuts (CSS conic-gradient) + graphiques barres ----------
  const DONUT_COLORS = ['var(--trace)', 'var(--green)', 'var(--amber)', 'var(--pink)', 'var(--text-faint)'];
  function renderDonut(chartId, legendId, totalId, segments) {
    const total = segments.reduce((s, [, v]) => s + Math.max(v, 0), 0);
    let acc = 0;
    const stops = segments.map(([, v], i) => {
      const from = acc, to = acc + (total > 0 ? Math.max(v, 0) / total * 100 : 0);
      acc = to;
      return `${DONUT_COLORS[i % DONUT_COLORS.length]} ${from}% ${to}%`;
    }).join(', ');
    document.getElementById(chartId).style.setProperty('--donut-gradient', `conic-gradient(${stops})`);
    document.getElementById(totalId).textContent = fmt(Math.round(total)) + ' €';
    document.getElementById(legendId).innerHTML = segments.map(([label, v], i) => `
      <div class="donut-legend-row"><span class="swatch" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]};"></span>${label}<span class="amt">${fmt(Math.round(v))} € · ${total > 0 ? fmt2(v / total * 100) : '0,00'} %</span></div>`).join('');
  }
  // ---------- graphique SVG (aire + ligne lissee) -- primitive premium ----------
  // Conversion Catmull-Rom -> Bezier cubique (tension 1/6), technique
  // standard pour obtenir une courbe lissee passant exactement par chaque
  // point reel -- pas une esthetique gratuite, une facon lisible de montrer
  // une trajectoire annuelle sans la denaturer (chaque point reste exact,
  // visible et survolable ; seule l'interpolation ENTRE les points est
  // lissee). Reutilisee par tous les graphiques du simulateur, y compris
  // ceux crees par le pilotage par langage (mêmes chiffres, meme moteur).
  function smoothPath(points) {
    if (points.length < 2) return '';
    if (points.length === 2) return `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? i : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
  }
  function renderAreaChart(svgId, rows, series, opts = {}) {
    const svg = document.getElementById(svgId);
    if (!svg || !rows.length) return;
    const W = 640, H = opts.h || 220;
    const padL = 8, padR = 8, padT = 14, padB = 24;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const xLabel = opts.xLabel || (r => r.annee);
    const pointLabel = opts.pointLabel || ((s, r) => `${s.label} — an ${r.annee} : ${fmt(Math.round(s.get(r)))} €`);
    const allVals = rows.flatMap(r => series.map(s => s.get(r)));
    let maxV = Math.max(...allVals, 0), minV = Math.min(...allVals, 0);
    if (maxV === minV) { maxV += Math.abs(maxV) * 0.1 || 1; minV -= Math.abs(minV) * 0.1; }
    const spanV = (maxV - minV) || 1;
    const x = i => padL + (rows.length === 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
    const y = v => padT + innerH - ((v - minV) / spanV) * innerH;
    const zeroY = Math.max(padT, Math.min(padT + innerH, y(0)));

    const gridN = 4;
    let gridHtml = '', yLabelsHtml = '';
    for (let g = 0; g <= gridN; g++) {
      const gy = padT + (innerH / gridN) * g;
      const gv = maxV - (spanV / gridN) * g;
      gridHtml += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="chart-grid-line"/>`;
      yLabelsHtml += `<text x="${W - padR}" y="${(gy - 3).toFixed(1)}" text-anchor="end" class="chart-y-label">${opts.yFmt ? opts.yFmt(gv) : fmt(Math.round(gv))}</text>`;
    }

    let defsHtml = '', pathsHtml = '';
    series.forEach((s, si) => {
      const pts = rows.map((r, i) => [x(i), y(s.get(r))]);
      const linePath = smoothPath(pts);
      const areaPath = `${linePath} L${x(rows.length - 1).toFixed(2)},${zeroY.toFixed(2)} L${x(0).toFixed(2)},${zeroY.toFixed(2)} Z`;
      const gradId = `${svgId}-grad-${si}`;
      defsHtml += `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${s.color}" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="${s.color}" stop-opacity="0"/>
      </linearGradient>`;
      pathsHtml += `<path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>`;
      pathsHtml += `<path d="${linePath}" fill="none" stroke="${s.color}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>`;
      pts.forEach(([px, py], i) => {
        pathsHtml += `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="3.25" fill="${s.color}" class="chart-point"><title>${pointLabel(s, rows[i])}</title></circle>`;
      });
    });

    if (opts.refLine) {
      const ry = y(opts.refLine.value);
      pathsHtml += `<line x1="${padL}" y1="${ry.toFixed(1)}" x2="${W - padR}" y2="${ry.toFixed(1)}" class="chart-ref-line"/>
        <text x="${padL}" y="${(ry - 5).toFixed(1)}" class="chart-ref-label">${opts.refLine.label}</text>`;
    }

    const labelStep = Math.max(1, Math.ceil(rows.length / 8));
    const labelsHtml = rows.map((r, i) => (i % labelStep === 0 || i === rows.length - 1)
      ? `<text x="${x(i).toFixed(2)}" y="${H - 6}" text-anchor="middle" class="chart-axis-label">${xLabel(r)}</text>` : '').join('');

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<defs>${defsHtml}</defs>${gridHtml}${yLabelsHtml}${pathsHtml}${labelsHtml}`;
  }
  function renderVisuels(m) {
    const usesSegments = [
      ['Prix négocié', m.prixNegocie],
      ["Droits d'enregistrement", m.droitsEnregistrement],
    ];
    if (!m.commissionAgentInclusFAI && m.honorairesAgent > 0) usesSegments.push(["Honoraires d'agence", m.honorairesAgent]);
    usesSegments.push(['Frais divers', m.fraisDivers]);
    renderDonut('msUsesDonut', 'msUsesDonutLegend', 'msUsesDonutTotal', usesSegments);
    renderDonut('msSourcesDonut', 'msSourcesDonutLegend', 'msSourcesDonutTotal', [
      ['Emprunt', m.montantEmprunt],
      ['Apport', m.apport],
    ]);
    renderAreaChart('msCashflowChart', m.annees, [
      { label: 'Loyers encaissés', color: 'var(--trace)', get: r => r.loyersNets },
      { label: "Cash-flow disponible (après IS)", color: 'var(--green)', get: r => r.cashFlow },
    ]);
    renderAreaChart('msDebtChart', m.annees, [
      { label: 'Capital restant dû', color: 'var(--pink)', get: r => r.capitalRestantDu },
    ]);
    renderAreaChart('msDistributionChart', m.annees, [
      { label: 'Cash-flow cumulé', color: 'var(--trace)', get: r => r.cumulCashFlow },
    ], { h: 260, refLine: { value: m.apport, label: `Apport — ${fmt(Math.round(m.apport))} €` } });
  }

  // ---------- graphiques crees par l'IA ----------
  // Le pilotage par langage choisit UNIQUEMENT quoi tracer (quelle metrique
  // annuelle, ou quel parametre balayer face a quel indicateur de sortie) --
  // les valeurs affichees sont systematiquement recalculees ici par le meme
  // moteur deterministe (computeModel) que le reste du simulateur, jamais
  // fournies par le modele. Persistants : recalcules a chaque recompute()
  // comme tout le reste, donc toujours a jour si l'utilisateur ajuste un
  // curseur ensuite.
  const ANNUAL_METRICS = {
    loyerAnnuel: { label: 'Loyers faciaux', color: 'var(--trace)' },
    loyersNets: { label: 'Loyers encaissés', color: 'var(--trace)' },
    cashFlow: { label: "Cash-flow disponible (après IS)", color: 'var(--green)' },
    cumulCashFlow: { label: 'Cash-flow cumulé', color: 'var(--trace)' },
    capitalRestantDu: { label: 'Capital restant dû', color: 'var(--pink)' },
    dscr: { label: 'DSCR', color: 'var(--amber)' },
    impotIS: { label: 'Impôt sur les sociétés', color: 'var(--pink)' },
    chargesExploitation: { label: "Charges d'exploitation", color: 'var(--amber)' },
  };
  const SWEEP_METRICS = {
    tri: { label: 'TRI fonds propres', fmtY: v => fmt2(v * 100) },
    moic: { label: 'Multiple (MoIC)', fmtY: v => fmt2(v) },
    cashFlowMoyenAn: { label: "Cash-flow d'exploitation moyen / an", fmtY: v => fmt(Math.round(v)) },
    avgDscr: { label: 'DSCR moyen', fmtY: v => v != null ? fmt2(v) : '—' },
    rendementLocatifMoyen: { label: 'Rendement locatif net moyen', fmtY: v => fmt2(v * 100) },
  };
  const SWEEP_FIELDS = ['tauxInteretPct', 'tauxVacancePct', 'indexationPct', 'rendementSortiePct', 'apport', 'negociationPct', 'dureeCreditAns', 'anneeSortie', 'fraisGestionPct'];
  let customCharts = [];
  function computeSweepPoints(xField, yMetricKey) {
    const f = FIELD[xField];
    const yDef = SWEEP_METRICS[yMetricKey];
    if (!f || !yDef) return null;
    const steps = 10;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const v = f.min + (f.max - f.min) * (i / steps);
      const m = computeModel({ ...state, [xField]: v });
      points.push({ annee: fmtField(xField, v), y: m[yMetricKey] });
    }
    return points;
  }
  function renderCustomCharts() {
    const grid = document.getElementById('simCustomChartsGrid');
    const section = document.getElementById('simCustomChartsSection');
    if (!grid || !section) return;
    section.style.display = customCharts.length ? 'block' : 'none';
    if (!customCharts.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = customCharts.map(c => `
      <div class="chart-card full">
        <div class="chart-card-head">
          <span class="label">${c.title.toUpperCase()}</span>
          <button class="chart-remove-btn" type="button" data-remove-chart="${c.id}" aria-label="Supprimer">✕</button>
        </div>
        <svg class="chart-svg" id="customChart-${c.id}" preserveAspectRatio="none"></svg>
      </div>`).join('');
    customCharts.forEach(c => {
      if (c.kind === 'annual') {
        const series = c.metrics.map(k => ({ label: ANNUAL_METRICS[k].label, color: ANNUAL_METRICS[k].color, get: r => r[k] == null ? 0 : r[k] }));
        renderAreaChart(`customChart-${c.id}`, lastModel.annees, series, { h: 260 });
      } else if (c.kind === 'sweep') {
        const points = computeSweepPoints(c.xField, c.yMetric);
        if (!points) return;
        const yDef = SWEEP_METRICS[c.yMetric];
        renderAreaChart(`customChart-${c.id}`, points, [{ label: yDef.label, color: 'var(--trace)', get: r => r.y }], {
          h: 260,
          yFmt: v => yDef.fmtY(v),
          pointLabel: (s, r) => `${FIELD[c.xField].label} ${r.annee} → ${yDef.label} : ${yDef.fmtY(r.y)}`,
        });
      }
    });
    grid.querySelectorAll('[data-remove-chart]').forEach(btn => btn.addEventListener('click', () => {
      customCharts = customCharts.filter(c => c.id !== btn.dataset.removeChart);
      renderCustomCharts();
    }));
  }

  // ---------- hypotheses sourcees ----------
  // Cite le document reel pour chaque hypothese qui peut l'etre (jamais une
  // estimation deguisee en source) -- alimente le panneau "Hypotheses &
  // sources" et les alertes deterministes ci-dessous. Une hypothese non
  // sourcable (ex: rendement de sortie sans comparable) le dit explicitement
  // plutot que d'inventer une origine.
  let lastAssumptionSources = [];
  function computeAssumptionSources(doc) {
    if (!doc) return [];
    const out = [];
    const fi = doc.ficheIdentite || {};
    const ind = doc.indicateurs || {};

    const idxRows = (doc.etatLocatif || []).filter(r => r.typeIndexation && r.typeIndexation.value);
    if (idxRows.length) {
      const counts = {};
      idxRows.forEach(r => { const t = r.typeIndexation.value; counts[t] = (counts[t] || 0) + 1; });
      const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const example = idxRows.find(r => r.typeIndexation.value === dominant);
      out.push({
        key: 'indexationPct', label: 'Indexation des loyers',
        valeurAffichee: `Bail indexé sur ${dominant} (${idxRows.length} lot${idxRows.length > 1 ? 's' : ''} concerné${idxRows.length > 1 ? 's' : ''})`,
        note: "Le modèle applique un taux fixe annuel (simplification) — le bail référence un indice réel, pas un pourcentage contractuel fixe.",
        page: example.typeIndexation.page, quote: example.typeIndexation.quote,
      });
    }

    if (ind.tauxVacance != null) {
      out.push({
        key: 'tauxVacancePct', label: 'Taux de vacance',
        valeurAffichee: fmt2(ind.tauxVacance) + ' %',
        note: 'Calculé par Leez à partir des surfaces réellement occupées vs. GLA totale du dossier — donnée vérifiée, pas une estimation de marché.',
        page: null, quote: null,
      });
    }

    if (fi.rendementAffiche && fi.rendementAffiche.value) {
      out.push({
        key: 'rendementSortiePct', label: 'Taux de sortie',
        valeurAffichee: `Repris du rendement affiché à l'acquisition : ${fi.rendementAffiche.value}`,
        note: "Leez ne dispose d'aucun comparable de marché indépendant pour la sortie — hypothèse de continuité par défaut, à ajuster selon votre propre vue de marché.",
        page: fi.rendementAffiche.page, quote: fi.rendementAffiche.quote,
      });
    } else {
      out.push({
        key: 'rendementSortiePct', label: 'Taux de sortie',
        valeurAffichee: 'Non sourcé',
        note: "Aucun rendement ni comparable de sortie n'est présent dans le document — valeur par défaut à ajuster manuellement.",
        page: null, quote: null,
      });
    }

    const capexList = (doc.redFlags && Array.isArray(doc.redFlags.capexTechniques)) ? doc.redFlags.capexTechniques : [];
    capexList.forEach(c => {
      if (c.montantEstime && c.montantEstime.value) {
        out.push({
          key: 'capexPonctuels', label: `CapEx — ${c.sujet || 'travaux identifiés'}`,
          valeurAffichee: fmt(Math.round(c.montantEstime.value)) + ' €',
          note: (c.mention && c.mention.value) || 'Mentionné dans le document (signaux techniques).',
          page: c.mention ? c.mention.page : null, quote: c.mention ? c.mention.quote : null,
          montant: c.montantEstime.value,
        });
      }
    });

    return out;
  }
  function renderAssumptions(sources) {
    const panel = document.getElementById('simAssumptionsPanel');
    if (!panel) return;
    if (!sources.length) { panel.innerHTML = '<div class="interp-flag-empty">Aucune hypothèse sourcée disponible pour ce dossier.</div>'; return; }
    panel.innerHTML = sources.map(s => `
      <div class="audit-card green" style="cursor:default;">
        <span class="dot green"></span>
        <div style="flex:1;">
          <div class="flag-header"><span class="flag-title">${s.label}</span></div>
          <div class="flag-body">${s.valeurAffichee}</div>
          <div class="audit-card-impact">${s.note}</div>
          <div class="audit-card-actions">
            ${s.page != null ? `<button class="cite-link" data-src-page="${s.page}" data-src-quote="${(s.quote || '').replace(/"/g, '&quot;')}">Voir la source →</button>` : ''}
            ${s.key === 'capexPonctuels' && s.montant ? `<button class="cite-link" data-apply-capex="${s.montant}">Intégrer au modèle (année 1) →</button>` : ''}
          </div>
        </div>
      </div>`).join('');
    panel.querySelectorAll('[data-src-page]').forEach(btn => btn.addEventListener('click', () => {
      if (window.LeezApp && window.LeezApp.openSourceModal) window.LeezApp.openSourceModal(btn.dataset.srcPage, btn.dataset.srcQuote);
    }));
    panel.querySelectorAll('[data-apply-capex]').forEach(btn => btn.addEventListener('click', () => {
      const montant = parseFloat(btn.dataset.applyCapex);
      if (Number.isFinite(montant)) {
        state.capexPonctuels = { ...state.capexPonctuels, 1: (state.capexPonctuels[1] || 0) + montant };
        recompute();
        window.LeezFmt.flashValue(document.getElementById('kpiHeroGrid'), 'grid-flash');
      }
    }));
  }

  // ---------- alertes deterministes ----------
  // Seuils "convention Leez", documentes explicitement (meme logique que le
  // calendrier reglementaire DPE cote serveur, interpretation.js) -- pas des
  // donnees de marche extraites, des seuils de vigilance internes appliques
  // a des chiffres reellement calcules par le moteur.
  const DSCR_SEUIL_CRITIQUE = 1.05; // exigence bancaire usuelle (covenant standard)
  const DSCR_SEUIL_VIGILANCE = 1.20;
  const CAP_RATE_MARGE_PRUDENCE_PTS = 0.5; // convention : +25 a +50 bps de marge sortie vs entree
  const INDEXATION_VIGILANCE_PCT = 3; // au-dela, hypothese consideree agressive (convention interne)
  function niveauClass(n) { return n === 'rouge' ? 'pink' : n === 'orange' ? 'amber' : 'green'; }
  function computeAlerts(m, s, sources) {
    const alerts = [];

    if (m.avgDscr != null) {
      if (m.avgDscr < DSCR_SEUIL_CRITIQUE) {
        alerts.push({ niveau: 'rouge', titre: 'DSCR sous le seuil bancaire usuel',
          constat: `DSCR moyen projeté à ${safeX(m.avgDscr)} — sous l'exigence bancaire usuelle de ${safeX(DSCR_SEUIL_CRITIQUE)}.`,
          impact: "Un financement à ce niveau de couverture est généralement refusé, ou nécessite un apport plus élevé / un taux plus bas." });
      } else if (m.avgDscr < DSCR_SEUIL_VIGILANCE) {
        alerts.push({ niveau: 'orange', titre: 'DSCR avec faible marge de sécurité',
          constat: `DSCR moyen projeté à ${safeX(m.avgDscr)} — au-dessus du minimum bancaire (${safeX(DSCR_SEUIL_CRITIQUE)}) mais avec peu de marge.`,
          impact: "Une hausse de taux ou une vacance supplémentaire pourrait faire passer le DSCR sous le seuil bancaire." });
      }
    }

    if (m.goingInCapRate != null) {
      const exitPct = s.rendementSortiePct, entryPct = m.goingInCapRate * 100;
      if (exitPct < entryPct) {
        alerts.push({ niveau: 'rouge', titre: 'Compression du cap rate à la sortie',
          constat: `Taux de sortie modélisé à ${fmt2(exitPct)} %, sous le taux d'entrée de ${fmt2(entryPct)} % — le modèle suppose une compression du cap rate.`,
          impact: "Plus agressif que la convention usuelle (sortie ≥ entrée + 25 à 50 bps de prudence) — à justifier explicitement si conservé." });
      } else if (exitPct < entryPct + CAP_RATE_MARGE_PRUDENCE_PTS) {
        alerts.push({ niveau: 'orange', titre: 'Taux de sortie sans marge de prudence',
          constat: `Taux de sortie (${fmt2(exitPct)} %) proche du taux d'entrée (${fmt2(entryPct)} %).`,
          impact: "La convention usuelle applique +25 à +50 bps de marge de prudence à la sortie vs. l'entrée pour absorber le vieillissement de l'actif." });
      }
    }

    if (s.indexationPct > INDEXATION_VIGILANCE_PCT) {
      alerts.push({ niveau: 'orange', titre: "Hypothèse d'indexation agressive",
        constat: `Indexation modélisée à ${fmt2(s.indexationPct)} %/an, au-dessus du seuil de vigilance interne Leez (${INDEXATION_VIGILANCE_PCT} %/an).`,
        impact: "Une indexation constante en % est une simplification du modèle — le bail référence un indice réel (voir hypothèses sourcées), pas un taux contractuel fixe." });
    }

    const vacSource = sources.find(x => x.key === 'tauxVacancePct');
    if (vacSource) {
      const observed = parseFloat(vacSource.valeurAffichee);
      if (Number.isFinite(observed) && Math.abs(s.tauxVacancePct - observed) > 3) {
        alerts.push({ niveau: 'orange', titre: 'Vacance modélisée éloignée de la donnée observée',
          constat: `Vacance modélisée à ${fmt2(s.tauxVacancePct)} %, contre ${fmt2(observed)} % d'occupation réelle mesurée dans le dossier.`,
          impact: "Écart à justifier (rotation locative anticipée, renouvellement à risque…) sinon revenir à la donnée observée." });
      }
    }

    return alerts;
  }
  function renderAlerts(alerts) {
    const panel = document.getElementById('simAlertsPanel');
    if (!panel) return;
    panel.innerHTML = alerts.length === 0
      ? '<div class="interp-flag-empty">Aucune alerte sur les hypothèses actuelles.</div>'
      : alerts.map(a => `
        <div class="audit-card ${niveauClass(a.niveau)}" style="cursor:default;">
          <span class="dot ${niveauClass(a.niveau)}"></span>
          <div style="flex:1;">
            <div class="flag-header"><span class="flag-title">${a.titre}</span></div>
            <div class="flag-body">${a.constat}</div>
            <div class="audit-card-impact">${a.impact}</div>
          </div>
        </div>`).join('');
  }

  // ---------- scenarios Optimiste / Base / Pessimiste ----------
  // Deltas appliques sur les hypotheses ACTUELLES (pas sur les valeurs par
  // defaut) -- convention Leez documentee, pas une prevision de marche.
  const SCENARIO_DELTAS = {
    optimiste: { indexationPct: 1, tauxVacancePct: -2, rendementSortiePct: -0.5, tauxInteretPct: -0.3 },
    pessimiste: { indexationPct: -1, tauxVacancePct: 3, rendementSortiePct: 0.75, tauxInteretPct: 1 },
  };
  function applyDeltas(base, deltas) {
    const s = { ...base };
    Object.keys(deltas).forEach(k => {
      const f = FIELD[k];
      let v = (base[k] || 0) + deltas[k];
      if (f) v = Math.max(f.min, Math.min(f.max, v));
      s[k] = v;
    });
    return s;
  }
  function computeScenarios() {
    return {
      pessimiste: computeModel(applyDeltas(state, SCENARIO_DELTAS.pessimiste)),
      base: computeModel(state),
      optimiste: computeModel(applyDeltas(state, SCENARIO_DELTAS.optimiste)),
    };
  }
  function renderScenarios() {
    const panel = document.getElementById('simScenariosPanel');
    if (!panel) return;
    const sc = computeScenarios();
    const rows = [
      ['TRI fonds propres', m => safePct(m.tri) + ' %'],
      ['TRI projet', m => safePct(m.triProjet) + ' %'],
      ['Multiple (MoIC)', m => safeX(m.moic)],
      ['DSCR moyen', m => m.avgDscr != null ? safeX(m.avgDscr) : '—'],
      ["Cash-flow d'exploitation moyen / an", m => fmt(Math.round(m.cashFlowMoyenAn)) + ' €'],
    ];
    panel.innerHTML = `<div style="overflow-x:auto;"><table class="sim-scenario-table"><thead><tr><th></th><th>Pessimiste</th><th>Base (actuel)</th><th>Optimiste</th></tr></thead><tbody>${
      rows.map(([label, fn]) => `<tr><td>${label}</td><td>${fn(sc.pessimiste)}</td><td><b>${fn(sc.base)}</b></td><td>${fn(sc.optimiste)}</td></tr>`).join('')
    }</tbody></table></div>
    <p class="label" style="padding:10px 4px 0;">Pessimiste : vacance +3 pts, indexation −1 pt, taux +1 pt, sortie +75 bps. Optimiste : vacance −2 pts, indexation +1 pt, taux −30 bps, sortie −50 bps — conventions Leez appliquées en delta sur vos hypothèses actuelles.</p>`;
  }

  // ---------- matrice de sensibilite : TRI fonds propres vs sortie x indexation ----------
  // computeSensitivityGrid() isole le calcul (reutilise tel quel par le
  // rendu ci-dessous ET par l'instantane de presentation, cf.
  // buildPresentationSnapshot) -- chaque cellule porte TRI et MoIC, jamais
  // recalcules differemment selon l'appelant.
  const SENSITIVITY_EXIT_STEPS = [-1, -0.5, 0, 0.5, 1];
  const SENSITIVITY_IDX_STEPS = [-1, -0.5, 0, 0.5, 1];
  function computeSensitivityGrid() {
    const grid = SENSITIVITY_EXIT_STEPS.map(dExit => SENSITIVITY_IDX_STEPS.map(dIdx => {
      const s = { ...state, rendementSortiePct: Math.max(0.1, state.rendementSortiePct + dExit), indexationPct: Math.max(0, state.indexationPct + dIdx) };
      const m = computeModel(s);
      return { tri: m.tri, moic: m.moic };
    }));
    return { exitSteps: SENSITIVITY_EXIT_STEPS, idxSteps: SENSITIVITY_IDX_STEPS, baseExitPct: state.rendementSortiePct, baseIndexationPct: state.indexationPct, grid };
  }
  function renderSensitivity() {
    const el = document.getElementById('simSensitivityGrid');
    if (!el) return;
    const { exitSteps, idxSteps, grid } = computeSensitivityGrid();
    const flat = grid.flat().map(c => c.tri).filter(Number.isFinite);
    const min = Math.min(...flat), max = Math.max(...flat);
    const colorFor = v => {
      if (!Number.isFinite(v) || max === min) return 'transparent';
      const t = (v - min) / (max - min);
      const r = t < 0.5 ? 255 : Math.round(255 * (1 - (t - 0.5) * 2));
      const g = t < 0.5 ? Math.round(255 * (t * 2)) : 255;
      return `rgba(${r},${g},90,.35)`;
    };
    el.innerHTML = `<div style="overflow-x:auto;"><table class="sim-sensitivity-table">
      <thead><tr><th>Sortie ↓ \\ Indexation →</th>${idxSteps.map(d => `<th>${fmt2(state.indexationPct + d)} %</th>`).join('')}</tr></thead>
      <tbody>${exitSteps.map((dExit, i) => `<tr><th>${fmt2(state.rendementSortiePct + dExit)} %</th>${grid[i].map(c => `<td style="background:${colorFor(c.tri)};">${safePct(c.tri)} %</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="label" style="padding:10px 4px 0;">TRI fonds propres selon le taux de sortie (lignes) et l'indexation annuelle (colonnes), autour de vos hypothèses actuelles.</p>`;
  }

  // ---------- tornado : qu'est-ce qui casse ce deal ----------
  const TORNADO_FIELDS = [
    { key: 'tauxVacancePct', step: 3, label: 'Vacance' },
    { key: 'indexationPct', step: 1, label: 'Indexation' },
    { key: 'rendementSortiePct', step: 0.75, label: 'Taux de sortie' },
    { key: 'tauxInteretPct', step: 1, label: "Taux d'intérêt" },
    { key: 'apport', stepPct: 20, label: 'Fonds propres' },
    { key: 'fraisGestionPct', step: 2, label: 'Honoraires de gestion' },
  ];
  function renderTornado() {
    const el = document.getElementById('simTornadoChart');
    if (!el) return;
    const baseIRR = computeModel(state).tri;
    const rows = TORNADO_FIELDS.map(f => {
      const fMeta = FIELD[f.key];
      const step = f.step != null ? f.step : Math.abs(state[f.key]) * (f.stepPct / 100);
      const down = { ...state, [f.key]: Math.max(fMeta.min, state[f.key] - step) };
      const up = { ...state, [f.key]: Math.min(fMeta.max, state[f.key] + step) };
      const irrDown = computeModel(down).tri, irrUp = computeModel(up).tri;
      const spread = Math.max(Math.abs(irrDown - baseIRR) || 0, Math.abs(irrUp - baseIRR) || 0);
      return { label: f.label, spread };
    }).filter(r => Number.isFinite(r.spread)).sort((a, b) => b.spread - a.spread);
    const maxSpread = Math.max(...rows.map(r => r.spread), 0.0001);
    el.innerHTML = rows.map(r => `
      <div class="tornado-row">
        <div class="tornado-label">${r.label}</div>
        <div class="tornado-bar-wrap"><div class="tornado-bar" style="width:${(r.spread / maxSpread * 100).toFixed(1)}%"></div></div>
        <div class="tornado-val">± ${safePct(r.spread)} pts de TRI</div>
      </div>`).join('');
  }

  // ---------- stress-tests ----------
  // Le depart du "locataire principal" utilise le VRAI loyer annuel de ce
  // lot, tel qu'extrait de l'etat locatif du dossier -- pas une estimation.
  function findTopTenant(doc) {
    const rows = (doc && doc.etatLocatif) || [];
    const withRent = rows.filter(r => r.loyerAnnuel && Number.isFinite(r.loyerAnnuel.value) && r.loyerAnnuel.value > 0);
    if (!withRent.length) return null;
    return withRent.reduce((max, r) => (r.loyerAnnuel.value > max.loyerAnnuel.value ? r : max), withRent[0]);
  }
  // computeStressTests() isole le calcul des 3 scenarios de stress (calcul
  // pur, reutilise par le rendu Simulateur ET par l'instantane de
  // presentation) -- renderStressTests() ne fait plus que le mettre en forme.
  function computeStressTests(doc) {
    const base = computeModel(state);
    const cards = [];

    const choc = { ...state, tauxInteretPct: state.tauxInteretPct + 1.5 };
    const mChoc = computeModel(choc);
    cards.push({
      id: 'taux_choc', titre: 'Choc de taux (+150 bps, convention de stress-test standard)',
      triBasePct: round2(base.tri * 100), triStressPct: round2(mChoc.tri * 100),
      dscrBase: base.avgDscr, dscrStress: mChoc.avgDscr,
    });

    const top = findTopTenant(doc);
    if (top) {
      const montant = top.loyerAnnuel.value;
      const s2 = { ...state, vacanceExtraPonctuelle: { ...state.vacanceExtraPonctuelle, 1: (state.vacanceExtraPonctuelle[1] || 0) + montant } };
      const mTop = computeModel(s2);
      cards.push({
        id: 'depart_locataire_principal', titre: `Départ du locataire principal${top.locataire ? ' (' + top.locataire + ')' : ''}`,
        locataire: top.locataire || null, loyerConcerne: Math.round(montant),
        pctLoyerTotal: state.loyerAnnuelInitial > 0 ? round2(montant / state.loyerAnnuelInitial * 100) : null,
        triBasePct: round2(base.tri * 100), triStressPct: round2(mTop.tri * 100),
      });
    }

    const dureeAns = 2, chocPts = 15;
    const extra = { ...state.vacanceExtraPonctuelle };
    for (let a = 1; a <= dureeAns; a++) extra[a] = (extra[a] || 0) + state.loyerAnnuelInitial * chocPts / 100;
    const mVac = computeModel({ ...state, vacanceExtraPonctuelle: extra });
    cards.push({
      id: 'vacance_prolongee', titre: `Vacance prolongée (+${chocPts} pts pendant ${dureeAns} ans, convention de stress-test)`,
      dureeAns, chocPts, triBasePct: round2(base.tri * 100), triStressPct: round2(mVac.tri * 100),
    });

    return cards;
  }
  function renderStressTests(doc) {
    const el = document.getElementById('simStressPanel');
    if (!el) return;
    const cards = computeStressTests(doc);
    el.innerHTML = cards.map(c => {
      let detail;
      if (c.id === 'taux_choc') {
        detail = `TRI fonds propres : ${fmt2(c.triBasePct)} % → ${fmt2(c.triStressPct)} % · DSCR moyen : ${c.dscrBase != null ? safeX(c.dscrBase) : '—'} → ${c.dscrStress != null ? safeX(c.dscrStress) : '—'}`;
      } else if (c.id === 'depart_locataire_principal') {
        detail = `Loyer réel du lot : ${fmt(c.loyerConcerne)} €${c.pctLoyerTotal != null ? ` (${fmt2(c.pctLoyerTotal)} % du loyer total)` : ''} — vacance totale en année 1 : TRI fonds propres ${fmt2(c.triBasePct)} % → ${fmt2(c.triStressPct)} %.`;
      } else {
        detail = `TRI fonds propres : ${fmt2(c.triBasePct)} % → ${fmt2(c.triStressPct)} %`;
      }
      return `<div class="stat-card"><div class="label">${c.titre}</div><div class="stat-num" style="font-size:.95rem;">${detail}</div></div>`;
    }).join('');
  }

  // ---------- point mort : taux d'occupation minimum pour couvrir la dette ----------
  // Bissection deterministe sur le taux de vacance jusqu'a DSCR annee 1 = 1,0x
  // (les loyers nets couvrent tout juste le service de la dette) -- jamais une
  // estimation directe, la seule source de verite reste computeModel.
  function computeBreakevenOccupancy() {
    const base = computeModel(state);
    const anneeUn = base.annees[0];
    if (!anneeUn || !anneeUn.echeance) return null; // pas de dette -> pas de point mort bancaire a calculer
    const dscrAtVacance = vacPct => {
      const m = computeModel({ ...state, tauxVacancePct: vacPct });
      const a1 = m.annees[0];
      return a1 && a1.echeance ? a1.loyersNets / a1.echeance : null;
    };
    const dscrAt0 = dscrAtVacance(0);
    if (dscrAt0 == null || dscrAt0 < 1) {
      return { vacanceRupturePct: null, occupationRupturePct: null, dscrActuel: anneeUn.dscr, tauxVacanceActuelPct: state.tauxVacancePct, jamaisAtteignable: true };
    }
    let lo = 0, hi = 100;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const d = dscrAtVacance(mid);
      if (d == null) break;
      if (d >= 1) lo = mid; else hi = mid;
    }
    return {
      vacanceRupturePct: round1(lo), occupationRupturePct: round1(100 - lo),
      dscrActuel: anneeUn.dscr, tauxVacanceActuelPct: state.tauxVacancePct, jamaisAtteignable: false,
    };
  }

  // ---------- instantane pour la Presentation comite (verrouillage manuel) ----------
  // Assemble uniquement des chiffres deja calcules ailleurs dans ce fichier
  // (computeModel/computeScenarios/computeSensitivityGrid/computeStressTests/
  // computeBreakevenOccupancy) -- aucun nouveau calcul ici, jamais un chiffre
  // invente pour combler un slide. Le "TRI brut" (avant financement/
  // fiscalite) n'est pas modelise par ce simulateur : deliberement absent
  // plutot que fabrique, cf. deck (app.js) qui l'affiche comme tel.
  function buildPresentationSnapshot(doc) {
    const m = computeModel(state);
    const sensitivity = computeSensitivityGrid();
    const stressTests = computeStressTests(doc);
    const breakeven = computeBreakevenOccupancy();
    const scenarios = computeScenarios();
    const ltvPct = m.prixRevient > 0 ? round1(m.montantEmprunt / m.prixRevient * 100) : null;
    return {
      dossierId: doc ? doc.id : null,
      keyMetrics: {
        prixAcquisition: Math.round(m.prixNegocie),
        prixRevient: Math.round(m.prixRevient),
        equityRequis: Math.round(m.apport),
        montantEmprunt: Math.round(m.montantEmprunt),
        triNetInvestisseurPct: round2(m.tri * 100),
        moic: round2(m.moic),
        cashOnCashMoyenPct: m.apport > 0 ? round2(m.cashFlowMoyenAn / m.apport * 100) : null,
        yieldOnCostPct: m.goingInCapRate != null ? round2(m.goingInCapRate * 100) : null,
        anneeSortie: m.anneeSortie,
        rendementSortiePct: state.rendementSortiePct,
      },
      businessPlan: {
        annees: m.annees.map(a => ({
          annee: a.annee, loyerAnnuel: Math.round(a.loyerAnnuel), coutVacance: Math.round(a.coutVacance),
          chargesExploitation: Math.round(a.chargesExploitation), loyersNets: Math.round(a.loyersNets),
          echeance: Math.round(a.echeance), cashFlow: Math.round(a.cashFlow), dscr: a.dscr != null ? round2(a.dscr) : null,
        })),
        hypotheses: {
          indexationPct: state.indexationPct, tauxVacancePct: state.tauxVacancePct,
          fraisGestionPct: state.fraisGestionPct, loyerSoumisTVA: state.loyerSoumisTVA, tauxTVA: state.loyerSoumisTVA ? state.tauxTVA : null,
        },
      },
      capitalStack: {
        prixRevient: Math.round(m.prixRevient), coutAcquisitionTotal: Math.round(m.coutAcquisitionTotal),
        equity: Math.round(m.apport), dette: Math.round(m.montantEmprunt),
        ltvPct, ltcPct: ltvPct,
        detteDetail: {
          tauxInteretPct: state.tauxInteretPct, dureeCreditAns: state.dureeCreditAns,
          periodeInFineAns: state.periodeInFineAns, tauxAssuranceCreditPct: state.tauxAssuranceCreditPct,
          renegociationActive: state.renegociationActive, anneeRenegociation: state.renegociationActive ? state.anneeRenegociation : null,
        },
        seuilsVigilanceInternesLeez: { dscrCritique: DSCR_SEUIL_CRITIQUE, dscrVigilance: DSCR_SEUIL_VIGILANCE },
        avgDscr: m.avgDscr != null ? round2(m.avgDscr) : null,
      },
      exit: {
        anneeSortie: m.anneeSortie, rendementSortiePct: state.rendementSortiePct,
        triNetInvestisseurPct: round2(m.tri * 100), moic: round2(m.moic),
        triBrutNonModelise: true,
        sensitivity,
        scenarios: {
          pessimiste: { triPct: round2(scenarios.pessimiste.tri * 100), moic: round2(scenarios.pessimiste.moic) },
          base: { triPct: round2(scenarios.base.tri * 100), moic: round2(scenarios.base.moic) },
          optimiste: { triPct: round2(scenarios.optimiste.tri * 100), moic: round2(scenarios.optimiste.moic) },
        },
      },
      risque: { stressTests, breakeven },
    };
  }

  async function lockSimulationForPresentation() {
    const btn = document.getElementById('simLockBtn');
    if (!btn) return;
    if (!lastSeededDoc) {
      const original = btn.textContent;
      btn.textContent = 'Sélectionnez un dossier ci-dessus';
      setTimeout(() => { btn.textContent = original; }, 2400);
      return;
    }
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Verrouillage…';
    try {
      const snapshot = buildPresentationSnapshot(lastSeededDoc);
      const res = await fetch(`/api/documents/${lastSeededDoc.id}/simulation-snapshot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.simulation) {
        if (window.LeezApp && window.LeezApp.setSimulationSnapshot) window.LeezApp.setSimulationSnapshot(data.simulation);
        btn.textContent = '✓ Verrouillé pour la présentation';
      } else {
        btn.textContent = 'Échec — réessayer';
      }
    } catch {
      btn.textContent = 'Échec — réessayer';
    } finally {
      btn.disabled = false;
      setTimeout(() => { btn.textContent = original; }, 2600);
    }
  }

  function recompute() {
    lastModel = computeModel(state);
    renderKpiHero(lastModel);
    renderSourcesUses(lastModel);
    renderVisuels(lastModel);
    renderCustomCharts();
    renderAnnualTable(lastModel);
    renderExitSummary(lastModel);
    renderAlerts(computeAlerts(lastModel, state, lastAssumptionSources));
    renderScenarios();
    renderSensitivity();
    renderTornado();
    renderStressTests(lastSeededDoc);
    return lastModel;
  }

  // ---------- seed depuis un vrai dossier ----------
  function parseFrenchNumberClient(v) {
    if (typeof v === 'number') return v;
    if (!v) return null;
    const n = parseFloat(String(v).replace(/[€%\s ]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function computeSeedFromDoc(doc) {
    const fi = doc.ficheIdentite || {}, ind = doc.indicateurs || {};
    const surface = parseFrenchNumberClient(fi.surfaceLocativeGLA?.value);
    const prixAffiche = parseFrenchNumberClient(fi.prixDemande?.value);
    // Loyer d'entree (annee 1) = somme REELLE des loyers annuels de l'etat
    // locatif -- jamais reconstruite via (loyer moyen/m2 x surface totale
    // du batiment) : ce taux moyen est calcule sur le SEUL sous-ensemble des
    // lignes de l'etat locatif dont la surface est renseignee, alors que
    // surfaceLocativeGLA est la surface complete du batiment -- un ecart
    // entre les deux (lots sans surface extraite) gonflait artificiellement
    // le loyer d'entree simule au-dessus du total reel de l'etat locatif.
    const rentRoll = doc.etatLocatif || [];
    const loyerAnnuelRentRoll = rentRoll.reduce((s, r) => s + (r.loyerAnnuel?.value || 0), 0);
    // Apport par defaut : si un LTV reel a ete extrait/calcule pour ce
    // dossier, on en deduit un apport coherent avec cette donnee verifiee ;
    // sinon convention 20% du prix affiche (pratique de marche courante),
    // explicitement documentee -- pas une donnee du dossier.
    let apportDefaut = null;
    if (prixAffiche != null) {
      apportDefaut = ind.ltvEstime != null ? prixAffiche * (1 - ind.ltvEstime / 100) : prixAffiche * 0.20;
    }
    return {
      prixAffiche,
      surface,
      loyerAnnuelInitial: loyerAnnuelRentRoll > 0 ? loyerAnnuelRentRoll : null,
      tauxVacancePct: ind.tauxVacance ?? null,
      apport: apportDefaut,
      rendementSortiePct: ind.capRateRecalcule ?? parseFrenchNumberClient(fi.rendementAffiche?.value),
      taxeFonciereAnnuelle: parseFrenchNumberClient(fi.taxeFonciere?.value),
      chargesCoproAnnuelles: parseFrenchNumberClient(fi.chargesCoproPropriete?.value),
    };
  }
  function seedFromDoc(doc) {
    state = { ...defaults };
    if (doc && doc.ficheIdentite) {
      const seed = computeSeedFromDoc(doc);
      Object.keys(seed).forEach(key => { if (seed[key] != null && FIELD[key]) state[key] = seed[key]; });
    }
    buildSections();
    recompute();
    window.LeezFmt.flashValue(document.getElementById('kpiHeroGrid'), 'grid-flash');
  }
  let lastSeededDoc = null;
  function setDossierDoc(doc) {
    lastSeededDoc = doc;
    document.getElementById('simScenarioName').textContent = (doc.ficheIdentite?.adresse?.value) || doc.filename;
    lastAssumptionSources = computeAssumptionSources(doc);
    renderAssumptions(lastAssumptionSources);
    seedFromDoc(doc);
  }
  async function populateDossierSelect() {
    const select = document.getElementById('simDossierSelect');
    if (!select) return;
    try {
      const docs = await fetch('/api/documents').then(r => r.json());
      const complete = docs.filter(d => d.status === 'complete');
      select.innerHTML = '<option value="">Mode par défaut</option>' + complete.map(d => `<option value="${d.id}">${(d.ficheIdentite?.adresse?.value) || d.filename}</option>`).join('');
      select.onchange = async () => {
        if (!select.value) { document.getElementById('simScenarioName').textContent = 'Mode par défaut'; lastSeededDoc = null; lastAssumptionSources = []; renderAssumptions([]); seedFromDoc(null); return; }
        const doc = await fetch(`/api/documents/${select.value}`).then(r => r.json());
        lastSeededDoc = doc;
        document.getElementById('simScenarioName').textContent = (doc.ficheIdentite?.adresse?.value) || doc.filename;
        lastAssumptionSources = computeAssumptionSources(doc);
        renderAssumptions(lastAssumptionSources);
        seedFromDoc(doc);
      };
    } catch { /* liste indisponible : le mode par défaut reste utilisable */ }
  }
  populateDossierSelect();

  // ---------- init + interactions ----------
  buildSections();
  recompute();

  function switchSimTab(name) {
    const tab = document.querySelector(`.sim-tabs .stab[data-stab="${name}"]`);
    if (tab) tab.click();
  }
  document.querySelectorAll('.sim-tabs .stab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.sim-tabs .stab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('[data-simpane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-simpane="${tab.dataset.stab}"]`).style.display = 'block';
    if (tab.dataset.stab === 'copilote') {
      const badge = document.getElementById('simCopiloteBadge');
      if (badge) badge.style.display = 'none';
    }
  }));

  const simRoot = document.getElementById('view-analyze');
  if (simRoot) {
    simRoot.addEventListener('input', e => {
      const t = e.target;
      if (t.matches('.sim-slider[data-field]')) {
        const key = t.dataset.field;
        state[key] = parseFloat(t.value);
        syncField(key);
        recompute();
      }
    });
    simRoot.addEventListener('change', e => {
      if (e.target.matches('.sim-slider[data-field]')) window.LeezFmt.flashValue(document.getElementById('kpiHeroGrid'), 'grid-flash');
    });
    document.querySelectorAll('#view-analyze .sim-section-head').forEach(btn => btn.addEventListener('click', () => btn.closest('.sim-section').classList.toggle('collapsed')));
  }
  const resetBtn = document.getElementById('simReset');
  if (resetBtn) resetBtn.addEventListener('click', () => seedFromDoc(lastSeededDoc));
  const lockBtn = document.getElementById('simLockBtn');
  if (lockBtn) lockBtn.addEventListener('click', lockSimulationForPresentation);
  const formulaCloseBtn = document.getElementById('formulaModalClose');
  if (formulaCloseBtn) formulaCloseBtn.addEventListener('click', closeFormulaModal);
  const formulaBackdrop = document.getElementById('formulaModalBackdrop');
  if (formulaBackdrop) formulaBackdrop.addEventListener('click', closeFormulaModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFormulaModal(); });

  function noteCapexHint(montant) {
    const hint = document.getElementById('simCapexHint');
    if (!hint) return;
    document.getElementById('simCapexHintText').textContent = `CapEx identifié dans l'Audit : ${fmt(Math.round(montant))} € — à intégrer à vos hypothèses (ex. négociation du prix, provision séparée).`;
    const applyBtn = document.getElementById('simCapexHintApply');
    if (applyBtn) applyBtn.onclick = () => {
      state.capexPonctuels = { ...state.capexPonctuels, 1: (state.capexPonctuels[1] || 0) + montant };
      recompute();
      window.LeezFmt.flashValue(document.getElementById('kpiHeroGrid'), 'grid-flash');
      hint.style.display = 'none';
    };
    hint.style.display = 'flex';
  }
  const capexHintClose = document.getElementById('simCapexHintClose');
  if (capexHintClose) capexHintClose.addEventListener('click', () => { document.getElementById('simCapexHint').style.display = 'none'; });

  // ---------- commentaire narratif IA (bouton manuel, jamais automatique) ----------
  // Le serveur ne recoit que des chiffres deja calcules ici -- voir
  // simNarrative.js : Claude met en recit, il ne recalcule jamais rien.
  async function generateNarrative() {
    const btn = document.getElementById('simNarrativeBtn');
    const out = document.getElementById('simNarrativeOutput');
    if (!btn || !out || !lastModel) return;
    btn.disabled = true;
    btn.textContent = 'Génération…';
    out.style.display = 'none';
    try {
      const metrics = {
        'TRI fonds propres': safePct(lastModel.tri) + ' %',
        'Multiple (MoIC)': safeX(lastModel.moic),
        'DSCR moyen': lastModel.avgDscr != null ? safeX(lastModel.avgDscr) : 'non disponible',
        "Rendement d'entrée (cap rate)": lastModel.goingInCapRate != null ? fmt2(lastModel.goingInCapRate * 100) + ' %' : 'non disponible',
        'Taux de sortie modélisé': fmt2(state.rendementSortiePct) + ' %',
        'Apport': fmt(Math.round(lastModel.apport)) + ' €',
        'Durée de détention': `${state.anneeSortie} ans`,
      };
      const assumptions = lastAssumptionSources.map(s => `${s.label} : ${s.valeurAffichee}`);
      const alerts = computeAlerts(lastModel, state, lastAssumptionSources);
      const res = await fetch('/api/simulate/narrative', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics, assumptions, alerts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
      out.textContent = data.narrative;
      out.style.display = 'block';
    } catch (err) {
      out.textContent = `Impossible de générer le commentaire : ${err.message}`;
      out.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Générer un commentaire IA →';
    }
  }
  const narrativeBtn = document.getElementById('simNarrativeBtn');
  if (narrativeBtn) narrativeBtn.addEventListener('click', generateNarrative);

  // ---------- suggestions proactives (bouton manuel, jamais automatique) ----------
  // Le serveur (interpretSimSuggestions) ne peut renvoyer que des operations
  // "create_chart" (filtre cote serveur ET cote client, ceinture et
  // bretelles) : il decide QUOI regarder a partir des alertes et indicateurs
  // deja calcules, jamais un chiffre invente ni une modification silencieuse
  // d'hypothese -- meme principe de gating manuel que le commentaire IA.
  async function requestSuggestions() {
    const btn = document.getElementById('simSuggestBtn');
    if (!btn || !lastModel) return;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Analyse en cours…';
    chatLogTyping();
    showFloatLoading();
    try {
      const metrics = {
        'TRI fonds propres': safePct(lastModel.tri) + ' %',
        'Multiple (MoIC)': safeX(lastModel.moic),
        'DSCR moyen': lastModel.avgDscr != null ? safeX(lastModel.avgDscr) : 'non disponible',
        "Rendement d'entrée (cap rate)": lastModel.goingInCapRate != null ? fmt2(lastModel.goingInCapRate * 100) + ' %' : 'non disponible',
        'Taux de sortie modélisé': fmt2(state.rendementSortiePct) + ' %',
        'Apport': fmt(Math.round(lastModel.apport)) + ' €',
        'Durée de détention': `${state.anneeSortie} ans`,
      };
      const assumptions = lastAssumptionSources.map(s => `${s.label} : ${s.valeurAffichee}`);
      const alerts = computeAlerts(lastModel, state, lastAssumptionSources);
      const res = await fetch('/api/simulate/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simState: state, metrics, assumptions, alerts }),
      });
      const spec = await res.json();
      if (!res.ok) throw new Error(spec.error || 'Erreur serveur');
      chatLogClearTyping();
      const ops = (spec.operations || []).filter(op => op.type === 'create_chart');
      ops.forEach(op => applyOp(op));
      if (ops.length) { recompute(); window.LeezFmt.flashValue(document.getElementById('kpiHeroGrid'), 'grid-flash'); }
      const msg = spec.reason || 'Voici ce qui mérite votre attention.';
      chatLog('assistant', msg);
      showFloatReply(msg, ops.length ? 'visuels' : null);
    } catch (err) {
      chatLogClearTyping();
      const msg = `Erreur : ${err.message}`;
      chatLog('assistant', msg);
      showFloatReply(msg, null);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }
  const suggestBtn = document.getElementById('simSuggestBtn');
  if (suggestBtn) suggestBtn.addEventListener('click', requestSuggestions);

  // ---------- pilotage par le langage ----------
  // Le serveur (interpretSimCopilot) choisit UNIQUEMENT quel champ modifier
  // et de quelle valeur -- toutes les operations sont appliquees ici, au
  // meme moteur deterministe que le reste du simulateur, et le message de
  // confirmation est assemble a partir des chiffres reellement recalcules,
  // jamais a partir du texte renvoye par le modele. Point d'entree unique :
  // la barre flottante (#simFloatChat), presente sur tous les sous-onglets
  // du simulateur -- l'onglet Copilote n'affiche plus que l'historique.
  function chatLog(role, text) {
    const log = document.getElementById('simChatLog');
    if (!log) return;
    const row = document.createElement('div');
    row.className = `sim-chat-msg ${role}`;
    row.textContent = text;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }
  function chatLogTyping() {
    const log = document.getElementById('simChatLog');
    if (!log) return;
    const row = document.createElement('div');
    row.className = 'sim-chat-msg assistant typing';
    row.id = 'simChatTypingRow';
    row.innerHTML = '<span class="sim-typing-dots"><span></span><span></span><span></span></span>';
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }
  function chatLogClearTyping() {
    const row = document.getElementById('simChatTypingRow');
    if (row) row.remove();
  }
  function describeOp(op) {
    if (op.type === 'set_field' && FIELD[op.field]) {
      return `${FIELD[op.field].label} → ${fmtField(op.field, op.value)}`;
    }
    if (op.type === 'add_capex') {
      return `CapEx ajouté en année ${op.year} : ${fmt(Math.round(op.value))} €${op.label ? ' (' + op.label + ')' : ''}`;
    }
    if (op.type === 'apply_scenario') {
      return `Scénario affiché : ${op.scenario}`;
    }
    if (op.type === 'reset') {
      return 'Hypothèses réinitialisées aux valeurs sourcées du dossier';
    }
    if (op.type === 'create_chart') {
      return `Graphique créé : ${op.chartTitle || (op.chartXField !== 'none' ? 'sensibilité' : 'évolution annuelle')}`;
    }
    return null;
  }
  function applyOp(op) {
    // Les champs booleens sont bornes [0,1] dans FIELD (voir plus haut) --
    // stockes en 0/1, ils fonctionnent nativement dans tous les tests
    // truthy/ternaires du moteur, aucun traitement special necessaire ici.
    if (op.type === 'set_field' && op.field !== 'none' && FIELD[op.field]) {
      const f = FIELD[op.field];
      state[op.field] = Math.max(f.min, Math.min(f.max, op.value));
      syncField(op.field);
    } else if (op.type === 'add_capex') {
      const annee = Math.max(1, Math.round(op.year));
      state.capexPonctuels = { ...state.capexPonctuels, [annee]: (state.capexPonctuels[annee] || 0) + op.value };
    } else if (op.type === 'reset') {
      // Remet le state a l'etat sourcé du dossier (memes valeurs que le
      // bouton "Réinitialiser") -- reconstruit aussi les sliders lateraux.
      seedFromDoc(lastSeededDoc);
    } else if (op.type === 'create_chart') {
      const id = `c${Date.now()}${Math.round(Math.random() * 1000)}`;
      if (op.chartXField !== 'none' && op.chartYMetric !== 'none' && FIELD[op.chartXField] && SWEEP_METRICS[op.chartYMetric]) {
        customCharts.push({ id, kind: 'sweep', xField: op.chartXField, yMetric: op.chartYMetric, title: op.chartTitle || `${SWEEP_METRICS[op.chartYMetric].label} selon ${FIELD[op.chartXField].label}` });
      } else if (op.chartMetric !== 'none' && ANNUAL_METRICS[op.chartMetric]) {
        const metrics = [op.chartMetric];
        if (op.chartMetric2 !== 'none' && ANNUAL_METRICS[op.chartMetric2] && op.chartMetric2 !== op.chartMetric) metrics.push(op.chartMetric2);
        customCharts.push({ id, kind: 'annual', metrics, title: op.chartTitle || metrics.map(k => ANNUAL_METRICS[k].label).join(' & ') });
      }
    }
    // 'apply_scenario' ne modifie pas l'etat : le panneau Scenarios (deja
    // recalcule a chaque recompute) affiche deja les 3 colonnes cote a cote.
  }
  // Heuristique de redirection ("voir les changements") : les champs qui
  // pesent le plus sur les graphiques (Visuels) redirigent vers Visuels, un
  // scenario redirige vers Copilote (ou il est deja affiche), le reste
  // (loyer, vacance, indexation...) redirige vers la Vue d'ensemble (KPI +
  // hypotheses + alertes).
  const VISUEL_FIELDS = new Set(['prixAffiche', 'negociationPct', 'apport', 'tauxInteretPct', 'dureeCreditAns', 'periodeInFineAns', 'anneeSortie', 'rendementSortiePct', 'commissionRentePct', 'tauxDroitsEnregistrement', 'fraisDossierBancaire', 'coutCreationSociete', 'fraisCourtage', 'commissionAgentPct']);
  const TARGET_LABELS = { visuels: 'Visuels', overview: "Vue d'ensemble", copilote: 'Copilote' };
  function pickChangeTarget(ops) {
    if (ops.some(op => op.type === 'create_chart')) return 'visuels';
    if (ops.some(op => op.type === 'apply_scenario')) return 'copilote';
    if (ops.some(op => op.type === 'add_capex' || (op.type === 'set_field' && VISUEL_FIELDS.has(op.field)))) return 'visuels';
    return 'overview';
  }
  function showFloatReply(text, target) {
    const reply = document.getElementById('simFloatReply');
    const textEl = document.getElementById('simFloatReplyText');
    const link = document.getElementById('simFloatReplyLink');
    if (!reply || !textEl || !link) return;
    textEl.textContent = text;
    if (target) {
      link.textContent = `Voir les changements → ${TARGET_LABELS[target]}`;
      link.dataset.target = target;
      link.style.display = 'inline-block';
    } else {
      link.style.display = 'none';
    }
    reply.style.display = 'block';
  }
  function showFloatLoading() {
    const reply = document.getElementById('simFloatReply');
    const textEl = document.getElementById('simFloatReplyText');
    const link = document.getElementById('simFloatReplyLink');
    if (!reply || !textEl) return;
    textEl.innerHTML = '<span class="sim-typing-dots"><span></span><span></span><span></span></span>';
    if (link) link.style.display = 'none';
    reply.style.display = 'block';
  }
  function isCopiloteTabActive() {
    const tab = document.querySelector('.sim-tabs .stab[data-stab="copilote"]');
    return !!(tab && tab.classList.contains('active'));
  }
  async function sendCopilotPrompt(prompt) {
    const input = document.getElementById('simFloatInput');
    const sendBtn = document.getElementById('simFloatSend');
    chatLog('user', prompt);
    if (!isCopiloteTabActive()) {
      const badge = document.getElementById('simCopiloteBadge');
      if (badge) badge.style.display = 'block';
    }
    if (input) { input.value = ''; input.disabled = true; }
    if (sendBtn) { sendBtn.disabled = true; sendBtn.classList.add('loading'); }
    chatLogTyping();
    showFloatLoading();
    try {
      const res = await fetch('/api/simulate/prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, simState: state }),
      });
      const spec = await res.json();
      if (!res.ok) throw new Error(spec.error || 'Erreur serveur');
      chatLogClearTyping();
      if (!spec.supported) {
        const msg = spec.reason || "Cette demande n'est pas prise en charge par le simulateur.";
        chatLog('assistant', msg);
        showFloatReply(msg, null);
        return;
      }
      const ops = (spec.operations || []).filter(op => op.type !== 'none');
      if (!ops.length) {
        const msg = "Je n'ai pas identifié d'action claire dans cette instruction.";
        chatLog('assistant', msg);
        showFloatReply(msg, null);
        return;
      }
      const descriptions = [];
      ops.forEach(op => { applyOp(op); const d = describeOp(op); if (d) descriptions.push(d); });
      recompute();
      window.LeezFmt.flashValue(document.getElementById('kpiHeroGrid'), 'grid-flash');
      const confirmMsg = descriptions.length
        ? `Voici les changements faits : ${descriptions.join(' · ')}. Nouveau TRI fonds propres : ${safePct(lastModel.tri)} % (MoIC ${safeX(lastModel.moic)}).`
        : `Fait. Nouveau TRI fonds propres : ${safePct(lastModel.tri)} % (MoIC ${safeX(lastModel.moic)}).`;
      chatLog('assistant', confirmMsg);
      showFloatReply(confirmMsg, pickChangeTarget(ops));
    } catch (err) {
      chatLogClearTyping();
      const msg = `Erreur : ${err.message}`;
      chatLog('assistant', msg);
      showFloatReply(msg, null);
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove('loading'); }
      if (input) { input.disabled = false; input.focus(); }
    }
  }
  const floatSend = document.getElementById('simFloatSend');
  const floatInput = document.getElementById('simFloatInput');
  if (floatSend && floatInput) {
    floatSend.addEventListener('click', () => { const v = floatInput.value.trim(); if (v) sendCopilotPrompt(v); });
    floatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = floatInput.value.trim(); if (v) sendCopilotPrompt(v); } });
  }
  const floatReplyClose = document.getElementById('simFloatReplyClose');
  if (floatReplyClose) floatReplyClose.addEventListener('click', () => { document.getElementById('simFloatReply').style.display = 'none'; });
  const floatReplyLink = document.getElementById('simFloatReplyLink');
  if (floatReplyLink) floatReplyLink.addEventListener('click', e => {
    e.preventDefault();
    switchSimTab(floatReplyLink.dataset.target);
    document.getElementById('simFloatReply').style.display = 'none';
  });

  // ---------- barre flottante deplacable (drag) ----------
  // Position par defaut : centree en bas ; le glisser-deposer bascule sur
  // des coordonnees left/top fixes explicites, deplacables n'importe ou
  // dans la fenetre.
  (function initFloatDrag() {
    const widget = document.getElementById('simFloatChat');
    const handle = document.getElementById('simFloatHandle');
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

  // Expose pour l'Assistant (app.js) : "verrouille le simulateur" depuis le
  // chat appelle exactement la meme fonction que le bouton "Verrouiller pour
  // la presentation" du Simulateur -- aucune nouvelle logique.
  window.LeezSimulator = { setDossierDoc, noteCapexHint, lockCurrentSimulation: lockSimulationForPresentation };
})();
