const test = require('node:test');
const assert = require('node:assert');
const P = require('./pipeline');
const { departementDuFichier, inseeDe, decouperCsv } = require('./sources');
const geo = require('./geo');
const Sc = require('../../public/js/prospection-scores');
const Md = require('../../public/js/prospection-mandat');

test('departement du fichier DGFiP', () => {
  assert.equal(departementDuFichier('fichier/PM_25_B_060.csv'), '06');
  assert.equal(departementDuFichier('fichier/PM_25_B-140.csv'), '14');
  assert.equal(departementDuFichier('fichier/PM_25_B_2A0.csv'), '2A');
  assert.equal(departementDuFichier('fichier/PB_25_B_750 (1 ?12).csv'), '75');
  assert.equal(departementDuFichier('fichier/PM_25_B_971.csv'), '971');
  assert.equal(inseeDe('06', '88'), '06088');
  assert.equal(inseeDe('971', '101'), '97101');
});

test('CSV DVF avec guillemets', () => {
  assert.deepEqual(decouperCsv('a,"b,c",d'), ['a', 'b,c', 'd']);
});

test('lien entre proprietaire et occupant', () => {
  const sci = { siren: '111111111', dirigeants: [{ type_dirigeant: 'personne physique', nom: 'DURAND', prenoms: 'Jean Paul', annee_de_naissance: '1955' }] };
  const opco = { siren: '222222222', nom_complet: 'DURAND INDUSTRIE', dirigeants: [{ type_dirigeant: 'personne physique', nom: 'Durand', prenoms: 'JEAN', annee_de_naissance: '1955' }] };
  const l = P.lienOccupation(sci, opco);
  assert.equal(l.type, 'dirigeant_commun');
  assert.ok(l.annee_verifiee);
  assert.equal(P.lienOccupation({ siren: '222222222' }, opco).type, 'meme_siren');
  assert.equal(P.lienOccupation({ siren: '111111111', dirigeants: [{ type_dirigeant: 'personne morale', siren: '222222222', qualite: 'Gérant' }] }, opco).type, 'gerant_sci');
  assert.equal(P.lienOccupation({ siren: '111111111', dirigeants: [{ type_dirigeant: 'personne physique', nom: 'MARTIN', prenoms: 'Luc' }] }, opco), null);
});

test('homonymes : deux annees de naissance differentes ne font pas un lien', () => {
  const sci = { siren: '111111111', dirigeants: [{ type_dirigeant: 'personne physique', nom: 'MARTIN', prenoms: 'Pierre', annee_de_naissance: '1950' }] };
  const opco = { siren: '222222222', nom_complet: 'X', dirigeants: [{ type_dirigeant: 'personne physique', nom: 'MARTIN', prenoms: 'Pierre', annee_de_naissance: '1982' }] };
  assert.equal(P.lienOccupation(sci, opco), null);
  // Sans annee publiee d'un cote : lien faible, signale comme tel.
  const sansAnnee = P.lienOccupation(sci, { ...opco, dirigeants: [{ type_dirigeant: 'personne physique', nom: 'MARTIN', prenoms: 'Pierre' }] });
  assert.equal(sansAnnee.annee_verifiee, false);
});

test('confiance du lien', () => {
  assert.equal(P.confianceDe({ structurel: true }, true), 'fort');
  assert.equal(P.confianceDe({ structurel: true }, false), 'moyen');
  assert.equal(P.confianceDe({ structurel: false, type: 'dirigeant_commun', annee_verifiee: true }, true), 'moyen');
  assert.equal(P.confianceDe({ structurel: false, type: 'dirigeant_commun', annee_verifiee: false }, true), 'faible');
  assert.equal(P.confianceDe({ structurel: false, type: 'holding_commune' }, false), 'faible');
});

test('commissaires aux comptes : seuls les vrais controleurs sont ecartes', () => {
  const kpmg = { type_dirigeant: 'personne morale', siren: '775726417', denomination: 'KPMG S.A', qualite: 'Commissaire aux comptes titulaire' };
  const opco = { siren: '222222222', nom_complet: 'X', dirigeants: [kpmg] };
  assert.equal(P.lienOccupation({ siren: '111111111', dirigeants: [kpmg] }, opco), null);
  assert.equal(P.lienOccupation({ siren: '111111111', dirigeants: [{ ...kpmg, qualite: 'Autre' }] }, { ...opco, dirigeants: [{ ...kpmg, qualite: 'Autre' }] }), null);
  // Une personne qui s'appelle Ernst, la holding d'un groupe comptable qui preside : des dirigeants.
  assert.ok(!P.estControleur({ type_dirigeant: 'personne physique', nom: 'ERNST', prenoms: 'Sophie', qualite: null }));
  assert.ok(!P.estControleur({ type_dirigeant: 'personne morale', denomination: 'GROUPE QWANTA SOCIETE DE PARTICIPATION D EXPERTISE COMPTABLE', qualite: 'Président de SAS' }));
  assert.ok(P.estControleur({ type_dirigeant: 'personne morale', denomination: 'GRANT THORNTON', qualite: 'Autre' }));
});

test('fonds probables au capital, hors holding du groupe', () => {
  const d = [{ type_dirigeant: 'personne morale', denomination: 'SIPAREX PROXIMITE INNOVATION', siren: '1', qualite: 'Administrateur' }, { type_dirigeant: 'personne morale', denomination: 'DURAND CAPITAL', siren: '2', qualite: 'Président' }];
  const f = P.fondsProbables(d, ['DURAND INDUSTRIE']);
  assert.deepEqual(f.map((x) => x.denomination), ['SIPAREX PROXIMITE INNOVATION']);
});

test('meme adresse DGFiP / SIRENE (nom de voie seul)', () => {
  assert.ok(P.memeAdresse('383 CHEMIN DE L\'ESCAS DE NOUGUIE 06510 CARROS', '0383', 'L ESCAS DE NOUGUIE'));
  assert.ok(!P.memeAdresse('38 CHEMIN DE L\'ESCAS DE NOUGUIE 06510 CARROS', '0383', 'L ESCAS DE NOUGUIE'));
});

test('BODACC : nature des annonces', () => {
  assert.equal(P.evenementBodacc({ familleavis_lib: 'Procédures collectives', jugement: '{"nature":"Jugement d\'ouverture"}' }, 'occupant').nature, 'procedure');
  assert.equal(P.evenementBodacc({ familleavis_lib: 'Modifications diverses', modificationsgenerales: '{"descriptif":"Président partant"}' }, 'occupant').nature, 'dirigeant');
  assert.equal(P.evenementBodacc({ familleavis_lib: 'Modifications diverses', modificationsgenerales: '{"descriptif":"Modification du capital"}' }, 'occupant').nature, 'capital');
  assert.equal(P.evenementBodacc({ familleavis_lib: 'Ventes et cessions' }, 'occupant').nature, 'cession');
});

test('valeur : rayon croissant, fourchette, et rien sous 5 comparables', () => {
  const centre = [7, 43];
  const pres = (dKm, pm2) => ({ pm2, valeur: pm2 * 1000, surface: 1000, date: '2024-01-01', adresse: 'x', pt: [7 + dKm / 81.3, 43] });
  const comps = [pres(1, 1000), pres(1.5, 1200), pres(1.8, 1400), pres(4, 1600), pres(4.5, 1800)];
  const v = P.evaluerMur(10000, centre, comps);
  assert.equal(v.rayon_km, 5);
  assert.equal(v.n_comparables, 5);
  assert.equal(v.centrale, 14000000);
  assert.ok(v.basse <= v.centrale && v.centrale <= v.haute);
  assert.equal(P.evaluerMur(10000, centre, comps.slice(0, 4)), null);
});

test('geometrie : surface et point dans un carre de ~100 m', () => {
  const carre = { type: 'Polygon', coordinates: [[[7, 43], [7.00124, 43], [7.00124, 43.0009], [7, 43.0009], [7, 43]]] };
  const a = geo.aire(carre);
  assert.ok(a > 9000 && a < 11000, `aire ${a}`);
  assert.ok(geo.contient(carre, [7.0006, 43.0004]));
  assert.ok(!geo.contient(carre, [7.002, 43.0004]));
});

// --- Scores V2 -----------------------------------------------------------------
const mur = (o = {}) => ({ id: 'p-1', departement: '06', parcelle: { part_detenue: 1 }, proprietaire: { creation: '1990-01-01', dirigeants: [] }, valeur: { centrale: 12e6, basse: 10e6, haute: 14e6 }, achat: null, ...o });
const cible = (o = {}) => ({
  id: '222222222', departements: ['06'], type_actif: 'logistique', confiance: 'fort', fonds: [], bodacc: [],
  murs: [mur()], totaux: { centrale: 12e6, basse: 10e6, haute: 14e6 },
  occupant: { ape: '52.10B', finances: [{ annee: '2024', ca: 60e6, resultat_net: 2e6 }, { annee: '2023', ca: 50e6, resultat_net: 1e6 }, { annee: '2022', ca: 45e6, resultat_net: 1e6 }], effectif_tranche: '22', creation: '1985-01-01', dirigeants: [{ nom: 'A', age: 67, personne_morale: false, qualite: 'Président de SAS' }, { nom: 'B', age: 85, personne_morale: false, qualite: 'Administrateur' }] },
  ...o,
});
const T = { maintenant: Date.parse('2026-10-21') };

test('Fit : ticket, type, zone, lien, exclusions', () => {
  assert.equal(Sc.scoreFit(cible()).score, 100);
  assert.equal(Sc.scoreFit(cible(), { types: ['bureaux'] }).score, 75);
  assert.equal(Sc.scoreFit(cible(), { departements: ['69'] }).score, 80);
  assert.equal(Sc.scoreFit(cible({ confiance: 'faible' })).score, 80);
  assert.ok(Sc.scoreFit(cible(), { exclusionsNaf: ['52'] }).exclu);
});

test('Motivation : fonds, dirigeant 60+, achat ancien, BODACC', () => {
  const m = Sc.scoreMotivation(cible(), T);
  assert.equal(m.score, 30); // 15 (67 ans, président) + 15 (propriétaire de 1990, aucune vente)
  const f = Sc.scoreMotivation(cible({ fonds: [{ nom: 'SIPAREX', qualite: 'Administrateur' }], bodacc: [{ nature: 'dirigeant', date: '2026-03-01' }] }), T);
  assert.equal(f.score, 80);
  assert.ok(f.signaux.includes('fonds') && f.signaux.includes('changement_dirigeant'));
});

test('Locataire : 3 exercices positifs, procedure collective exclut, donnees partielles', () => {
  const l = Sc.scoreLocataire(cible(), undefined, T);
  assert.equal(l.score, 90); // 20 anciennete + 30 resultats + 15 CA en hausse + 15 CA + 10 effectif
  assert.ok(Sc.scoreLocataire(cible({ bodacc: [{ nature: 'procedure', sur: 'occupant', date: '2026-02-01' }] })).exclu);
  assert.ok(Sc.scoreLocataire(cible({ occupant: { ...cible().occupant, finances: [] } })).partiel);
});

test('global pondere par le mandat et phrase', () => {
  const s = Sc.scorer(cible(), { poids: { fit: 100, motivation: 0, locataire: 0 } }, T);
  assert.equal(s.global, 100);
  assert.match(s.phrase, /^Un dirigeant de 67 ans et des murs probablement détenus de longue date \(propriétaire créé en 1990\)\.$/);
});

test('fusion d\'une entreprise presente dans deux departements', () => {
  const a = cible();
  const b = cible({ departements: ['83'], murs: [mur({ id: 'p-2', departement: '83', valeur: { centrale: 8e6, basse: 7e6, haute: 9e6 } })] });
  const [f] = Sc.fusionner([[a], [b]]);
  assert.deepEqual(f.departements, ['06', '83']);
  assert.equal(f.murs.length, 2);
  assert.equal(f.totaux.centrale, 20e6);
});

test('mandat en phrase libre', () => {
  const r = Md.lirePhrase('SCPI logistique et activité, 8 à 30 M€, Auvergne-Rhône-Alpes et PACA, bail ferme 9 ans minimum');
  assert.equal(r.criteres.ticketMin, 8e6);
  assert.equal(r.criteres.ticketMax, 30e6);
  assert.deepEqual(r.criteres.types, ['logistique', 'activite']);
  assert.deepEqual(r.criteres.zones, ['Auvergne-Rhône-Alpes', "Provence-Alpes-Côte d'Azur"]);
  assert.equal(r.criteres.departements.length, 18);
  assert.equal(r.criteres.bailMinAns, 9);
  const h = Md.lirePhrase('Commerces entre 5 et 20 millions dans le Rhône, rendement 6,5 %, hors restauration');
  assert.deepEqual(h.criteres.departements, ['69']);
  assert.equal(h.criteres.rendement, 6.5);
  assert.deepEqual(h.criteres.exclusionsTypes, ['hotellerie']);
  const n = Md.normaliser({ ticketMin: 'x', types: ['inconnu'], exclusionsNaf: ['56', 'pas un code'] });
  assert.equal(n.ticketMin, 5e6);
  assert.ok(n.types.length >= 6);
  assert.deepEqual(n.exclusionsNaf, ['56']);
});
