// Note de comité (.docx) -- second artéfact du Centre d'export (Écran 7 du
// cahier des charges "vertical AI"), après le feeder Excel. Même règle
// absolue que tout le reste de Leez : le mémo est un GABARIT DÉTERMINISTE
// peuplé uniquement de données déjà extraites+vérifiées par citation
// (ficheIdentite), déjà recalculées par le code (indicateurs), ou déjà
// produites par les moteurs déterministes existants (audit, mandateFit,
// réconciliation). Aucun appel au modèle, aucun texte généré : une valeur
// manquante s'affiche "non communiqué", et la recommandation finale est un
// champ laissé VIDE pour l'analyste -- jamais une recommandation inventée.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, AlignmentType, BorderStyle,
} = require('docx');

const NC = 'non communiqué';
const fmtEur = n => Math.round(n).toLocaleString('fr-FR') + ' €';
const fmt2 = n => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Valeur citée : affichée VERBATIM (c'est la citation vérifiée du document,
// la reformater serait déjà une interprétation).
function cited(field) {
  const v = field && field.value != null && field.value !== '' ? String(field.value) : null;
  return v || NC;
}

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: 'D8D2C7' };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function cell(text, { bold = false, header = false, width } = {}) {
  return new TableCell({
    borders: cellBorders,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { fill: 'F4F1EA' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: bold || header, size: 18 })] })],
  });
}
function table(headerCells, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headerCells.map(h => cell(h, { header: true })) }),
      ...rows.map(r => new TableRow({ children: r.map(c => cell(c)) })),
    ],
  });
}
function heading(text) {
  return new Paragraph({
    spacing: { before: 260, after: 100 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 17, color: '6B6357', characterSpacing: 20 })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 60 },
    bullet: opts.bullet ? { level: 0 } : undefined,
    children: [new TextRun({ text, size: 19, italics: !!opts.italics, color: opts.color })],
  });
}

const MANDATE_SYMBOL = { ok: '✓', echec: '✗', indetermine: '?' };
const SIGNAL_LABEL = { ok: 'Conforme', warning: 'Écart notable', critical: 'Écart critique', indetermine: 'Donnée insuffisante' };

function buildIcMemo(doc) {
  const fi = doc.ficheIdentite || {};
  const ind = doc.indicateurs || {};
  const audit = doc.audit || {};
  const fit = audit.mandateFit || { configured: false, criteria: [] };
  const cards = (audit.cards || []).filter(c => c.niveau === 'rouge' || c.niveau === 'orange');
  const points = audit.pointsACreuser || [];
  const recon = doc.reconciliation || [];
  const adresse = cited(fi.adresse) !== NC ? cited(fi.adresse) : doc.filename;
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const children = [
    new Paragraph({ children: [new TextRun({ text: 'NOTE DE COMITÉ — TRIAGE', bold: true, size: 16, color: '9A9184', characterSpacing: 30 })] }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: adresse, size: 40 })],
      heading: HeadingLevel.TITLE,
    }),
    body(`${cited(fi.typeActif)} · ${cited(fi.codePostalVille)} · générée le ${today}`, { color: '6B6357' }),

    heading('Fiche de synthèse'),
    table(['Indicateur', 'Valeur', 'Provenance'], [
      ['Prix demandé', cited(fi.prixDemande), 'Cité du document (vérifié)'],
      ['Surface locative (GLA)', cited(fi.surfaceLocativeGLA), 'Cité du document (vérifié)'],
      ['Rendement affiché', cited(fi.rendementAffiche), 'Cité du document (vérifié)'],
      ['Taux de capitalisation recalculé', ind.capRateRecalcule != null ? fmt2(ind.capRateRecalcule) + ' %' : NC, 'Recalculé (état locatif / prix)'],
      ["Taux d'occupation physique (TOP)", ind.tauxOccupation != null ? fmt2(ind.tauxOccupation) + ' %' : NC, "Recalculé (état locatif réel)"],
      ["Résultat net d'exploitation (NOI)", ind.resultatNetExploitation != null ? fmtEur(ind.resultatNetExploitation) : NC, "Recalculé (compte d'exploitation)"],
    ]),

    heading('Conformité au mandat'),
  ];

  if (!fit.configured || fit.criteria.length === 0) {
    children.push(body("Aucun critère d'investissement configuré dans les réglages du fonds.", { italics: true }));
  } else {
    for (const c of fit.criteria) {
      children.push(body(`${MANDATE_SYMBOL[c.status] || '?'}  ${c.label} — ${c.detail || ''}`));
    }
  }

  children.push(heading('Points de vigilance'));
  if (cards.length === 0) {
    children.push(body("Aucune alerte critique ou point de vigilance détecté sur les critères vérifiés par Leez.", { italics: true }));
  } else {
    for (const c of cards.slice(0, 8)) {
      children.push(body(`${c.niveau === 'rouge' ? '🚩' : '⚠'} ${c.titre} — ${c.constat || ''}`));
    }
    if (cards.length > 8) children.push(body(`… et ${cards.length - 8} autre(s) — voir l'onglet Points d'attention dans Leez.`, { italics: true }));
  }

  children.push(heading('Réconciliation — OM vs pièces'));
  if (recon.length === 0) {
    children.push(body('Réconciliation indisponible.', { italics: true }));
  } else {
    children.push(table(
      ['Métrique', 'Invoqué (OM)', 'Constaté sur pièces', 'Signal'],
      recon.map(r => [r.label, r.invoqueLabel || NC, r.constateLabel || NC,
        (r.deltaPct != null ? `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct} % · ` : '') + (SIGNAL_LABEL[r.signal] || r.signal)]),
    ));
  }

  if (points.length > 0) {
    children.push(heading('Points à creuser avant de décider'));
    for (const p of points.slice(0, 6)) children.push(body(`${p.titre} — ${p.detail || ''}`, { bullet: true }));
  }

  children.push(
    heading("Recommandation de l'analyste"),
    body('☐ Pass        ☐ Deep dive        ☐ À discuter en comité'),
    body('Commentaire : ______________________________________________________________'),
    new Paragraph({
      spacing: { before: 300 },
      children: [new TextRun({
        text: "Générée par Leez uniquement à partir des données extraites du document et vérifiées par citation, ou recalculées par un moteur déterministe. Les valeurs absentes sont indiquées « non communiqué », jamais estimées. La recommandation ci-dessus est laissée à l'analyste.",
        size: 15, italics: true, color: '9A9184',
      })],
    }),
  );

  const d = new Document({
    creator: 'Leez',
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children }],
  });
  return Packer.toBuffer(d);
}

module.exports = { buildIcMemo };
