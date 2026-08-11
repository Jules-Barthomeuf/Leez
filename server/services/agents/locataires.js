// Agent "locataires" -- generalise l'ancienne fonction "AI Insight par
// locataire" (recherche web au clic sur une ligne d'etat locatif,
// desormais retiree de webSearch.js/routes/webSearch.js) sur l'architecture
// agent_runs/agent_findings. Un agent_run peut couvrir UN SEUL locataire
// (lance depuis une ligne du rent roll, page Donnees) ou TOUS les
// locataires du dossier (lance depuis l'ecran Agents) -- meme fonction dans
// les deux cas, la portee est juste la taille du tableau `tenants` fourni.
//
// Chaque locataire = un appel Claude independant (researchTenantFindings,
// webSearch.js) plutot qu'un seul appel batch pour tous les locataires :
// preserve le budget "8 recherches web max" par locataire (max_uses:8,
// deja la valeur existante avant cette migration) et donne une progression
// reelle par locataire (current_step_label), pas une barre qui saute d'un
// coup a la fin.
const { researchTenantFindings } = require('../webSearch');
const { mapWithConcurrency } = require('../concurrency');

const CONCURRENCY = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// onProgress({ stepLabel, stepsDone }) : appele apres CHAQUE locataire
// traite (succes ou echec individuel) -- c'est ce que le job runner
// persiste dans agent_runs.current_step_label/steps_done.
// isCancelled() (optionnel) : verifie AVANT de lancer chaque recherche --
// n'interrompt pas un appel Claude deja en vol (le SDK ne nous donne pas
// la main pendant .finalMessage()), mais empeche tout nouveau depart des
// que l'analyste a demande l'annulation. Les locataires non commences
// restent simplement absents des findings, jamais une entree "annulee"
// fabriquee.
async function runLocatairesAgent({ tenants, dealContext, onProgress, isCancelled }) {
  const list = Array.isArray(tenants) ? tenants.filter(t => t?.name) : [];
  const allFindings = [];
  const stepsLog = [];
  const errors = [];
  let tokenCost = 0;
  let done = 0;

  await mapWithConcurrency(list, CONCURRENCY, async (tenant) => {
    if (isCancelled?.()) return;
    const label = `Recherche : ${tenant.name}`;
    try {
      const { findings, tokenCost: cost } = await researchTenantFindings({
        tenantName: tenant.name,
        activite: tenant.activite || '',
        dealContext,
      });
      tokenCost += cost;
      for (const f of findings) {
        // source_date valide uniquement si au format AAAA-MM-JJ attendu du
        // modele -- une valeur malformee ne doit jamais faire echouer
        // l'ecriture en base (colonne `date` typee), juste etre ignoree.
        const sourceDate = DATE_RE.test(f.source_date || '') ? f.source_date : null;
        allFindings.push({ ...f, source_date: sourceDate, payload: { ...f.payload, tenantName: tenant.name } });
      }
      stepsLog.push(findings.length ? `${label} -- ${findings.length} élément(s) trouvé(s).` : `${label} -- rien d'exploitable.`);
    } catch (err) {
      errors.push({ tenant: tenant.name, message: err.message || String(err) });
      stepsLog.push(`${label} -- échec (${err.message || err}).`);
    } finally {
      done += 1;
      onProgress?.({ stepLabel: label, stepsDone: done });
    }
  });

  // Annulation demandee pendant l'execution : etat neutre, findings deja
  // obtenus conserves tels quels (voir spec §7.4) -- ne passe jamais par la
  // regle "tous en echec => failed" ni par le resume normal.
  if (isCancelled?.()) {
    return {
      status: 'cancelled',
      findings: allFindings,
      summary: `Annulé après ${done}/${list.length} locataire(s).`,
      steps_log: stepsLog,
      stepsTotal: list.length || 1,
      tokenCost,
    };
  }

  // Distinct d'un simple "rien trouve" (insufficient_data, cas normal) :
  // si TOUS les locataires ont echoue (erreur technique -- API indisponible,
  // credits epuises...), c'est un vrai echec du run, pas une absence de
  // donnees -- remonte comme exception pour que le job runner le persiste
  // en status 'failed' avec un message lisible, plutot qu'un
  // 'insufficient_data' trompeur qui laisserait croire a une recherche
  // reellement menee a bien mais infructueuse.
  if (list.length > 0 && errors.length === list.length) {
    throw new Error(`Échec sur les ${list.length} locataire(s) recherché(s) : ${errors[0].message}`);
  }

  // Resume DETERMINISTE (jamais redige par le modele) : uniquement des
  // comptes deja connus cote code, donc par construction jamais de chiffre
  // absent des findings -- pas besoin de faire courir ce texte-la a
  // travers la regle anti-hallucination #3, qui reste utile pour de futurs
  // agents dont le resume EST redige par le modele.
  const summaryParts = [`${list.length} locataire(s) recherché(s)`, `${allFindings.length} élément(s) trouvé(s)`];
  if (errors.length) summaryParts.push(`${errors.length} échec(s)`);
  const summary = summaryParts.join(', ') + '.';

  return {
    status: 'succeeded', // agentOutputValidation.js retranche vers insufficient_data si allFindings est vide
    findings: allFindings,
    summary,
    // Resume construit ici a partir de comptes deja connus (jamais redige
    // par le modele) -- exempte la regle anti-hallucination #3 (nombres du
    // resume absents des findings), qui ne s'applique qu'a un resume
    // redige par le modele. Voir agentOutputValidation.js.
    deterministicSummary: true,
    steps_log: stepsLog,
    stepsTotal: list.length || 1,
    tokenCost,
  };
}

module.exports = { runLocatairesAgent };
