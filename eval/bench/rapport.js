// Rapport Markdown du benchmark des parseurs, a partir des resultats JSON de parse.js.
const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)} %`);
const ms = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const eur = (v, d = 4) => (v == null ? 'non mesuré' : `${v.toFixed(d)} €`);
const TYPES = [['natif', 'PDF natifs'], ['scan_correct', 'Scans corrects'], ['scan_degrade', 'Scans dégradés'], ['mixte', 'PDF mixte (natif + scan)'], ['tableau', 'Documents à tableaux']];

function tableau(entetes, lignes) {
  return [`| ${entetes.join(' | ')} |`, `| ${entetes.map(() => '---').join(' | ')} |`, ...lignes.map((l) => `| ${l.join(' | ')} |`)].join('\n');
}

function ecrireRapport(r, { recommandation } = {}) {
  const noms = Object.keys(r.parseurs);
  const testes = noms.filter((n) => r.parseurs[n].ok);
  const out = [];
  out.push(`# Benchmark des parseurs — ${r.date.slice(0, 10)}`);
  out.push('');
  out.push(`Commande : \`npm run bench:parse${r.commande ? ` -- ${r.commande}` : ''}\` · Machine : ${r.machine.cpu || '?'}, ${r.machine.coeurs} cœurs, ${r.machine.memoire_go} Go, Node ${r.machine.node} (${r.machine.plateforme}) · Durée totale : ${ms(r.duree_ms)}.`);
  out.push('');
  out.push('Protocole : `eval/fixtures/benchmark-v1/README.md`. Seul `documents/` est donné aux parseurs. Citations comparées après normalisation (NFKC, espaces, apostrophes, tirets, casse), similarité floue ≥ 0,90. Coordonnées de référence : pdfjs sur le PDF natif (`reference/natifs/` pour les scans). Coûts : mesurés sur les pages facturées × prix unitaire **configuré** (jamais en dur ; sans variable, « non mesuré »).');
  out.push('');
  out.push('## Parseurs');
  out.push('');
  out.push(tableau(['Parseur', 'Statut', 'Description'], noms.map((n) => [n, r.parseurs[n].statut + (r.parseurs[n].version ? ` (${r.parseurs[n].version})` : ''), r.parseurs[n].description])));
  out.push('');
  out.push(`Prix configurés : USD→EUR ${r.prix.USD_EUR ?? '—'} · Mistral OCR ${r.prix.MISTRAL_OCR_PRIX_USD_1000_PAGES ?? '—'} $/1000 pages · Azure DI ${r.prix.AZURE_DI_PRIX_USD_1000_PAGES ?? '—'} $/1000 pages · Claude ${r.prix.CLAUDE_PARSE_MODEL} ${r.prix.CLAUDE_PRIX_ENTREE_USD_MTOK ?? '—'} $/Mtok entrée, ${r.prix.CLAUDE_PRIX_SORTIE_USD_MTOK ?? '—'} $/Mtok sortie (voir .env.example pour les sources).`);
  out.push('');

  for (const jeu of r.jeux) {
    out.push(`## Jeu ${jeu.nom}`);
    out.push('');
    out.push('### Synthèse par type de document');
    out.push('');
    for (const [cle, libelle] of [['tous', 'Tous les PDF'], ...TYPES]) {
      const g = jeu.synthese[cle];
      if (!g || !g.documents.length) continue;
      out.push(`**${libelle}** (${g.documents.join(', ')})`);
      out.push('');
      out.push(tableau(
        ['Parseur', 'Citations bonne page', 'Autre page', 'CER', 'WER', 'Coord. présentes', 'Coord. correctes', 'Tableaux (structure)', 'Tableaux (lignes texte)', 'Temps/page', '€/page'],
        noms.map((n) => { const s = g.parseurs[n]; if (!s || !s.documents) return [n, r.parseurs[n].ok ? (s && s.erreurs ? `erreur sur ${s.erreurs} doc.` : '—') : 'non testé', '', '', '', '', '', '', '', '', '']; return [n + (s.erreurs ? ` (${s.erreurs} err.)` : ''), pct(s.bonne_page), pct(s.autre_page), pct(s.cer), pct(s.wer), pct(s.coordonnees_presentes, 0), pct(s.coordonnees_correctes, 0), pct(s.tableaux_structures, 0), pct(s.tableaux_lignes_texte, 0), ms(s.ms_par_page), eur(s.eur_par_page)]; }),
      ));
      out.push('');
    }
    out.push('### Par document');
    out.push('');
    out.push('Citations retrouvées à la bonne page / attendues ; entre parenthèses, le CER quand le texte natif de référence existe.');
    out.push('');
    out.push(tableau(['Document', 'Type', 'Pages', ...testes], jeu.documents.filter((d) => d.format.startsWith('pdf')).map((d) => [
      `${d.id}`, `${d.doc_type} · ${d.type}${d.tableau ? ' · tableau' : ''}`, `${d.pages_attendues ?? '?'}`,
      ...testes.map((n) => { const p = d.parseurs[n]; if (!p) return '—'; if (p.erreur) return `erreur : ${p.erreur.slice(0, 60)}`; return `${p.resume.bonne_page}/${p.resume.citations}${p.resume.cer != null ? ` (${pct(p.resume.cer, 0)})` : ''}${p.rotations && p.rotations.length ? ' ↻' : ''}`; }),
    ])));
    out.push('');
    out.push('### Robustesse');
    out.push('');
    out.push(tableau(['Parseur', 'T06 p.2 tournée (citations p.2, CER p.2, rotation)', 'T06 tampon sur le titre (citations p.1)', 'B03 scan dégradé (citations, CER, loyer imprimé)', 'Q03 en-tête 2 colonnes (WER, citations)', 'B04 mixte (bail natif, avenant scanné p.4, avenant natif p.5, CER p.4)'],
      testes.map((n) => { const x = jeu.robustesse[n] || {}; const t = x.t06_page_tournee; const tt = x.t06_tampon_titre; const b = x.b03_scan_degrade; const q = x.q03_deux_colonnes; const m = x.b04_mixte; return [n, t ? `${pct(t.citations_p2, 0)}, ${pct(t.cer_p2, 0)}, ${t.rotation_detectee ? 'oui' : 'non'}` : '—', tt ? pct(tt.citations_p1, 0) : '—', b ? `${pct(b.citations, 0)}, ${pct(b.cer, 0)}, ${b.loyer_imprime_trouve ? '36 000 € trouvé' : 'loyer non trouvé'}` : '—', q ? `${pct(q.wer, 0)}, ${pct(q.citations, 0)}` : '—', m ? `${pct(m.bail_natif_p1_3, 0)}, ${pct(m.avenant1_scan_p4, 0)}, ${pct(m.avenant2_natif_p5, 0)}, ${pct(m.cer_p4, 0)}` : '—']; })));
    out.push('');
    if (jeu.sans_solution.length) {
      out.push('### Citations qu\'aucun parseur testé ne retrouve');
      out.push('');
      out.push(tableau(['Document', 'Page', 'Champ', 'Citation attendue', 'Meilleurs scores', 'Capture'], jeu.sans_solution.map((s) => [s.id, s.page, s.champ, `« ${(s.citation || '').slice(0, 80)} »`, Object.entries(s.meilleurs_scores).map(([k, v]) => `${k} ${v == null ? '—' : v.toFixed(2)}`).join(', '), s.capture ? `[${s.capture}](../${s.capture})` : '—'])));
      out.push('');
    } else {
      out.push('Toutes les citations sont retrouvées par au moins un parseur testé.');
      out.push('');
    }
  }

  out.push('## Lecteurs Excel et mail (hors comparaison)');
  out.push('');
  if (r.lecteurs.excel.length) out.push(tableau(['Fichier', 'Valeurs correctes', 'Dont formules'], r.lecteurs.excel.map((e) => [`${e.jeu}/${e.id}`, `${e.corrects}/${e.attendus}`, `${e.formules_correctes}/${e.formules}`])));
  if (r.lecteurs.email.length) { out.push(''); out.push(tableau(['Fichier', 'Citations trouvées', 'Piège : prix attendu présent', 'Ancien prix (fil transféré) présent'], r.lecteurs.email.map((e) => [`${e.jeu}/${e.id}`, `${e.trouvees}/${e.attendues}`, e.piege.prix_attendu_present ? 'oui' : 'non', e.piege.ancien_prix_present ? 'oui (à ignorer par l\'extraction)' : 'non']))); }
  out.push('');

  out.push('## Coût et temps projetés');
  out.push('');
  out.push(tableau(['Parseur', '€/page mesuré', 'Temps/page', '2 000 pages/mois', '20 000 pages/mois', 'Calcul 2 000 p.', 'Calcul 20 000 p.'],
    Object.entries(r.projections).map(([n, p]) => [n, eur(p.eur_par_page), ms(p.ms_par_page), eur(p.cout_2000_pages_eur, 2), eur(p.cout_20000_pages_eur, 2), p.heures_calcul_2000_pages == null ? '—' : `${p.heures_calcul_2000_pages.toFixed(1)} h`, p.heures_calcul_20000_pages == null ? '—' : `${p.heures_calcul_20000_pages.toFixed(1)} h`])));
  out.push('');
  out.push('Les parseurs locaux (pdfjs, tesseract, docling) ne coûtent que du temps de calcul sur le worker ; les heures indiquées sont à un seul processus, sur cette machine.');
  out.push('');
  out.push('## Recommandation');
  out.push('');
  out.push(recommandation || '_À rédiger après lecture des résultats (eval/bench/recommandation.md)._');
  out.push('');
  return out.join('\n');
}

module.exports = { ecrireRapport };
