// Export Excel "feeder" (Écran 7 du cahier des charges "vertical AI") --
// un classeur .xlsx pret a etre integre dans le modele de souscription du
// fonds : etat locatif et compte d'exploitation restructures, AVEC de
// vraies formules Excel natives pour tout ce que Leez calcule
// deterministement (totaux, NOI, cap rate recalcule) plutot que des
// valeurs figees. Seules les valeurs PRIMAIRES (deja extraites et
// verifiees par citation) sont ecrites en dur -- exactement la meme regle
// que le reste de l'app : le calcul vient du code (ici, des formules
// Excel qui referencent les cellules primaires), jamais une valeur
// recalculee ailleurs et simplement recopiee.
const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1A17' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };
const TOTAL_FONT = { bold: true };

function styleHeaderRow(row) {
  row.eachCell(cell => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });
  row.font = HEADER_FONT;
}

function addEtatLocatifSheet(wb, doc) {
  const sheet = wb.addWorksheet('État locatif');
  const rows = doc.etatLocatif || [];
  const headers = ['Lot', 'Locataire', 'Activité', 'Statut', 'Surface (m²)', 'Loyer facial (€/m²)', 'Loyer économique (€/m²)', 'Loyer annuel (€)', 'Début de bail', 'Fin de bail', 'Prochaine option', 'Indexation', 'Franchise', 'Dépôt de garantie', 'Charges récupérables (%)'];
  sheet.addRow(headers);
  styleHeaderRow(sheet.getRow(1));

  const firstDataRow = 2;
  rows.forEach(r => {
    sheet.addRow([
      r.suite || '', r.locataire || '', r.activite || '', r.statut || '',
      r.surfaceSf?.value ?? null, r.loyerFacialPsf?.value ?? null, r.loyerEconomiquePsf?.value ?? null,
      r.loyerAnnuel?.value ?? null,
      r.dateDebutBail?.value || '', r.dateFinBail?.value || '', r.prochaineOptionSortie?.value || '',
      r.typeIndexation?.value || '', r.periodeFranchise?.value || '', r.depotGarantie?.value || '',
      r.chargesRecuperablesPct?.value ?? null,
    ]);
  });
  const lastDataRow = firstDataRow + rows.length - 1;

  // Ligne "Total" : formules SUM natives referencant les cellules
  // primaires ci-dessus -- pas une valeur recopiee de indicateurs.js.
  if (rows.length > 0) {
    const totalRow = sheet.addRow(['Total', '', '', '', { formula: `SUM(E${firstDataRow}:E${lastDataRow})` }, '', '', { formula: `SUM(H${firstDataRow}:H${lastDataRow})` }, '', '', '', '', '', '', '']);
    totalRow.font = TOTAL_FONT;
  }
  sheet.columns.forEach(col => { col.width = 16; });
  sheet.getColumn(2).width = 24;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return { firstDataRow, lastDataRow, count: rows.length };
}

function addT12Sheet(wb, doc) {
  const sheet = wb.addWorksheet("Compte d'exploitation (T12)");
  const rows = doc.t12 || [];
  sheet.addRow(['Poste', 'Montant (€)']);
  styleHeaderRow(sheet.getRow(1));

  const firstDataRow = 2;
  rows.forEach(r => { sheet.addRow([r.lineItem || '', r.montant?.value ?? null]); });
  const lastDataRow = firstDataRow + rows.length - 1;

  // Sous-totaux en formules natives : le decoupage produits/charges suit
  // exactement la meme regle que computeT12Totals (indicators.js) --
  // "produits" = les lignes dont le montant est positif, "charges" =
  // negatif -- mais recalcule ICI par des formules SUMIF Excel plutot que
  // recopie depuis le serveur, pour que le fichier reste vivant si
  // l'analyste corrige un montant dans Excel.
  let noteRow = lastDataRow + 2;
  if (rows.length > 0) {
    sheet.getCell(`A${noteRow}`).value = 'Total produits';
    sheet.getCell(`B${noteRow}`).value = { formula: `SUMIF(B${firstDataRow}:B${lastDataRow},">0")` };
    sheet.getRow(noteRow).font = TOTAL_FONT;
    noteRow++;
    sheet.getCell(`A${noteRow}`).value = 'Total charges';
    sheet.getCell(`B${noteRow}`).value = { formula: `SUMIF(B${firstDataRow}:B${lastDataRow},"<0")` };
    sheet.getRow(noteRow).font = TOTAL_FONT;
    const chargesRow = noteRow;
    noteRow++;
    sheet.getCell(`A${noteRow}`).value = "Résultat net d'exploitation (NOI)";
    sheet.getCell(`B${noteRow}`).value = { formula: `B${noteRow - 2}+B${chargesRow}` };
    sheet.getRow(noteRow).font = TOTAL_FONT;
  }
  sheet.getColumn(1).width = 40;
  sheet.getColumn(2).width = 18;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return { firstDataRow, lastDataRow };
}

function addSyntheseSheet(wb, doc, etatLocatifRefs) {
  const sheet = wb.addWorksheet('Synthèse');
  const fi = doc.ficheIdentite || {};
  sheet.addRow(['Indicateur', 'Valeur']);
  styleHeaderRow(sheet.getRow(1));
  // Valeurs primaires (citations deja verifiees) -- ecrites telles quelles.
  const prixDemande = fi.prixDemande?.value ? Number(String(fi.prixDemande.value).replace(/[^\d.-]/g, '')) : null;
  sheet.addRow(['Adresse', fi.adresse?.value || '']);
  sheet.addRow(['Prix demandé (€)', prixDemande]);
  sheet.addRow(['Rendement affiché (%)', fi.rendementAffiche?.value ? Number(String(fi.rendementAffiche.value).replace(/[^\d.,-]/g, '').replace(',', '.')) : null]);
  sheet.addRow(['Surface locative GLA (m²)', fi.surfaceLocativeGLA?.value || '']);
  // Cap rate recalcule : vraie formule Excel = loyer annuel total (feuille
  // Etat locatif) / prix demande (cellule B3 ci-dessus) -- reste vivant si
  // l'un des deux est corrige dans le classeur.
  if (prixDemande && etatLocatifRefs.count > 0) {
    const row = sheet.addRow(['Taux de capitalisation recalculé (%)', { formula: `('État locatif'!H${etatLocatifRefs.lastDataRow + 1}/B3)*100` }]);
    row.font = TOTAL_FONT;
  }
  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 22;
}

async function buildFeederWorkbook(doc) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Leez';
  wb.created = new Date();
  const etatLocatifRefs = addEtatLocatifSheet(wb, doc);
  addT12Sheet(wb, doc);
  addSyntheseSheet(wb, doc, etatLocatifRefs);
  return wb.xlsx.writeBuffer();
}

module.exports = { buildFeederWorkbook };
