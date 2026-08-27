// Orchestre le pipeline complet pour un document : extraction du texte reel,
// appels au modele, verification par citation, controles de coherence et
// indicateurs calcules. Met a jour le statut en base a chaque etape pour que
// le frontend puisse suivre la progression par polling.
//
// Resilience : chaque etape connait son propre nom (currentStage) ; en cas
// d'echec, `failed_stage` est persiste avec `status:'error'` pour que
// POST /documents/:id/retry (documents.js) puisse reprendre PRECISEMENT a
// cette etape (resumePipeline) plutot que de tout refaire depuis le debut.
// Chaque etape relit ses dependances depuis la base (getDocument) au lieu
// de se fier a des variables locales : le meme chemin de code sert donc
// aussi bien a un run normal qu'a une reprise apres redemarrage du serveur
// entre l'echec et le clic sur "Relancer".
const { extractPages, isLikelyScanned } = require('./pdfText');
const { extractFicheEtLocatif, extractT12, extractSignaux } = require('./extraction');
const { verifyExtractedTree } = require('./verification');
const { computeIndicateurs, computeMix } = require('./indicators');
const { runConsistencyChecks } = require('./consistency');
const { updateDocument, getDocument } = require('../db');
const analytics = require('./analytics');

const STAGES = ['extracting_pages', 'extracting_identite', 'extracting_t12', 'extracting_signaux', 'computing_indicators'];

// Bornes un document avant tout appel payant a l'API : la plupart des OM
// bureau/commerce font 40-120 pages, 150 laisse une marge confortable sans
// risquer un document demesure qui degraderait latence/fiabilite/cout.
// Constante volontairement simple a ajuster si besoin.
const MAX_PAGES = 150;

async function runPipelineFrom(documentId, workspaceId, pdfBuffer, fromStage) {
  const startIndex = Math.max(0, STAGES.indexOf(fromStage));
  const pdfBase64 = pdfBuffer.toString('base64');
  let currentStage = STAGES[startIndex];

  try {
    if (startIndex <= 0) {
      currentStage = 'extracting_pages';
      await updateDocument(documentId, { status: currentStage, failed_stage: null }, workspaceId);
      const pages = await extractPages(pdfBuffer);

      if (isLikelyScanned(pages)) {
        await updateDocument(documentId, {
          status: 'unsupported_scanned',
          page_count: pages.length,
          pages_json: pages,
          error_message: "Ce PDF semble scanné (peu ou pas de texte extrait) — l'OCR n'est pas pris en charge dans cette version.",
        }, workspaceId);
        analytics.track('extraction_unsupported_scanned', workspaceId, { workspaceId, pageCount: pages.length });
        return;
      }
      if (pages.length > MAX_PAGES) {
        await updateDocument(documentId, {
          status: 'error',
          failed_stage: 'extracting_pages',
          page_count: pages.length,
          error_message: `Ce document compte ${pages.length} pages (limite actuelle : ${MAX_PAGES}). Les documents très volumineux ne sont pas pris en charge dans cette version.`,
        }, workspaceId);
        return;
      }

      await updateDocument(documentId, { page_count: pages.length, pages_json: pages }, workspaceId);
    }

    if (startIndex <= 1) {
      currentStage = 'extracting_identite';
      await updateDocument(documentId, { status: currentStage, failed_stage: null }, workspaceId);
      const callA = await extractFicheEtLocatif(pdfBase64);
      const doc = await getDocument(documentId, workspaceId);
      const verifiedA = verifyExtractedTree(callA, doc.pages_json);
      await updateDocument(documentId, {
        fiche_identite_json: verifiedA.ficheIdentite,
        etat_locatif_json: verifiedA.etatLocatif,
      }, workspaceId);
    }

    if (startIndex <= 2) {
      currentStage = 'extracting_t12';
      await updateDocument(documentId, { status: currentStage, failed_stage: null }, workspaceId);
      const callB = await extractT12(pdfBase64);
      const doc = await getDocument(documentId, workspaceId);
      const verifiedB = verifyExtractedTree(callB, doc.pages_json);
      await updateDocument(documentId, { t12_json: verifiedB.t12 }, workspaceId);
    }

    if (startIndex <= 3) {
      currentStage = 'extracting_signaux';
      await updateDocument(documentId, { status: currentStage, failed_stage: null }, workspaceId);
      const callC = await extractSignaux(pdfBase64);
      const doc = await getDocument(documentId, workspaceId);
      const verifiedC = verifyExtractedTree(callC, doc.pages_json);
      await updateDocument(documentId, { red_flags_json: verifiedC }, workspaceId);
    }

    currentStage = 'computing_indicators';
    await updateDocument(documentId, { status: currentStage, failed_stage: null }, workspaceId);
    const doc = await getDocument(documentId, workspaceId);
    const indicateurs = computeIndicateurs({
      ficheIdentite: doc.fiche_identite_json,
      etatLocatif: doc.etat_locatif_json,
      t12: doc.t12_json,
    });
    const mix = computeMix(doc.etat_locatif_json);
    const consistencyChecks = runConsistencyChecks({
      ficheIdentite: doc.fiche_identite_json,
      etatLocatif: doc.etat_locatif_json,
      t12: doc.t12_json,
    });

    await updateDocument(documentId, {
      indicateurs_json: indicateurs,
      mix_json: mix,
      expiry_json: [],
      consistency_json: consistencyChecks,
      status: 'complete',
      // Une reprise reussie EFFACE l'erreur de la tentative precedente :
      // sans cela le dossier reste 'complete' tout en affichant l'ancien
      // message d'echec, ce qui laisse croire que l'extraction a rate.
      failed_stage: null,
      error_message: null,
    }, workspaceId);
    analytics.track('extraction_completed', workspaceId, { workspaceId, resumedFrom: startIndex > 0 ? fromStage : null });
  } catch (err) {
    await updateDocument(documentId, { status: 'error', failed_stage: currentStage, error_message: err.message || String(err) }, workspaceId);
    // Jamais err.message brut : peut en principe refleter du texte du
    // document (erreur API echoant le contenu envoye) -- contrainte NDA,
    // voir le commentaire en tete d'analytics.js. Seul un code court, sans
    // contenu, part vers PostHog.
    analytics.track('extraction_failed', workspaceId, { workspaceId, failedStage: currentStage, errorCode: err.status || err.code || err.constructor?.name || 'unknown' });
  }
}

async function runPipeline(documentId, pdfBuffer, workspaceId) {
  analytics.track('extraction_started', workspaceId, { workspaceId });
  return runPipelineFrom(documentId, workspaceId, pdfBuffer, STAGES[0]);
}

// Reprend un dossier en `status:'error'` a partir de son `failed_stage`
// (route POST /documents/:id/retry, documents.js). failed_stage absent ou
// inconnu -> repart du tout debut, jamais d'exception silencieuse.
async function resumePipeline(documentId, pdfBuffer, workspaceId, failedStage) {
  const fromStage = STAGES.includes(failedStage) ? failedStage : STAGES[0];
  return runPipelineFrom(documentId, workspaceId, pdfBuffer, fromStage);
}

module.exports = { runPipeline, resumePipeline, STAGES };
