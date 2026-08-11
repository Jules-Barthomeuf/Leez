// Orchestrateur generique des agent_runs (voir spec "Leez -- orchestration
// multi-agents" §5.1). Meme patron "detache, statut en base, jamais
// d'attente dans le cycle de la requete HTTP" que server/services/pipeline.js
// pour l'extraction -- pas de file externe (Redis/BullMQ) : un seul process
// Node, une promesse non attendue par run, comme le pipeline le fait deja
// pour l'extraction depuis le debut de ce projet.
const { v4: uuidv4 } = require('uuid');
const {
  createAgentRun, updateAgentRun, failStaleAgentRuns, createAgentFinding,
} = require('../db');
const { buildDealContextBlock } = require('./dealContext');
const { validateAgentOutput, filterFindingsWithSource } = require('./agentOutputValidation');
const { runLocatairesAgent } = require('./agents/locataires');

// executors[agentType](dossier, scope, {onProgress, isCancelled}) -> sortie
// brute (contrat §4.2 + stepsTotal/tokenCost). Seul 'locataires' existe en
// Lot 1 -- marche, comparables, urbanisme, contradiction, synthese
// arrivent au Lot 2 (voir spec §8), meme registre a completer alors.
// `locataire`/`activite` sont des chaines PLEINES (pas des citations
// {value,page,quote}) dans etat_locatif_json -- voir
// PLAIN_ETAT_LOCATIF_FIELDS dans routes/documents.js, seuls les champs
// numeriques/dates du rent roll sont citation-wrapped.
const EXECUTORS = {
  locataires: async (dossier, scope, hooks) => {
    const rentRoll = Array.isArray(dossier.etat_locatif_json) ? dossier.etat_locatif_json : [];
    const wanted = scope?.tenantNames;
    const tenants = rentRoll
      .map(row => ({ name: row?.locataire, activite: row?.activite }))
      .filter(t => t.name && (!wanted || wanted.includes(t.name)));
    const dealContext = buildDealContextBlock(dossier.fiche_identite_json || {});
    return runLocatairesAgent({ tenants, dealContext, ...hooks });
  },
};

// Marque d'annulation, en memoire (pas en base) : un simple registre
// process-local suffit puisqu'un run vit et meurt dans le meme process qui
// l'a lance (jamais repris a l'identique -- voir failStaleAgentRuns). Purge
// a la fin de chaque run pour ne jamais grossir indefiniment.
const cancelFlags = new Map(); // agentRunId -> true

function computeStepsTotal(agentType, dossier, scope) {
  if (agentType === 'locataires') {
    const rentRoll = Array.isArray(dossier.etat_locatif_json) ? dossier.etat_locatif_json : [];
    const wanted = scope?.tenantNames;
    const count = rentRoll.filter(row => row?.locataire && (!wanted || wanted.includes(row.locataire))).length;
    return Math.max(count, 1);
  }
  return 1;
}

// Cree les lignes agent_runs en 'queued' et retourne IMMEDIATEMENT --
// l'execution reelle (executeRun) n'est jamais attendue ici (voir spec
// §5.1 : "Aucune execution dans le cycle de la requete"). Les types
// d'agent pas encore implementes (registre EXECUTORS incomplet au Lot 1)
// sont ignores silencieusement plutot que de faire echouer tout le lot --
// `created` ne contient que ce qui a reellement demarre, l'appelant peut
// comparer a `agentTypes` pour savoir ce qui a ete ignore.
async function launchAgentRuns({ dossier, userId, agentTypes, scope = {} }) {
  const created = [];
  for (const agentType of agentTypes) {
    if (!EXECUTORS[agentType]) continue;
    const id = uuidv4();
    const stepsTotal = computeStepsTotal(agentType, dossier, scope);
    await createAgentRun({ id, dossierId: dossier.id, agentType, launchedBy: userId, stepsTotal });
    created.push({ id, agentType });
    executeRun(id, agentType, dossier, scope).catch(err => {
      console.error(`Crash inattendu du run d'agent ${id} (${agentType}) :`, err);
    });
  }
  return created;
}

async function executeRun(runId, agentType, dossier, scope) {
  await updateAgentRun(runId, { status: 'running', started_at: new Date().toISOString() });
  try {
    const raw = await EXECUTORS[agentType](dossier, scope, {
      // Ecriture "best effort" : un echec de mise a jour de progression ne
      // doit jamais interrompre l'agent lui-meme (juste une barre qui ne
      // bouge pas un instant cote client, rien de grave).
      onProgress: ({ stepLabel, stepsDone }) => {
        updateAgentRun(runId, { current_step_label: stepLabel, steps_done: stepsDone }).catch(() => {});
      },
      isCancelled: () => cancelFlags.get(runId) === true,
    });

    // 'cancelled' court-circuite la validation anti-hallucination normale
    // (etat neutre explicite, pas un succes ni un echec) mais garde quand
    // meme le filtre "pas de source_url => rejete", regle absolue quel que
    // soit le statut final.
    const outcome = raw.status === 'cancelled'
      ? { status: 'cancelled', findings: filterFindingsWithSource(raw.findings), summary: raw.summary }
      : validateAgentOutput(raw);

    for (const f of outcome.findings) {
      await createAgentFinding({
        id: uuidv4(),
        agentRunId: runId,
        dossierId: dossier.id,
        kind: f.kind,
        payload: f.payload,
        sourceUrl: f.source_url,
        sourceLabel: f.source_label,
        sourceDate: f.source_date,
        sourceTier: f.source_tier,
        targetField: f.target_field || null,
      });
    }

    await updateAgentRun(runId, {
      status: outcome.status,
      steps_done: raw.stepsTotal || 1,
      current_step_label: null,
      sources_count: outcome.findings.length,
      result: { summary: outcome.summary, steps_log: raw.steps_log || [] },
      token_cost: raw.tokenCost || null,
      ended_at: new Date().toISOString(),
    });
  } catch (err) {
    // Message lisible par l'analyste (voir agent_runs.error_message dans la
    // spec), pas une stacktrace -- err.message suffit ici, les erreurs
    // levees dans ce module/webSearch.js sont deja redigees pour un humain.
    await updateAgentRun(runId, {
      status: 'failed',
      error_message: err.message || String(err),
      current_step_label: null,
      ended_at: new Date().toISOString(),
    }).catch(() => {});
  } finally {
    cancelFlags.delete(runId);
  }
}

function cancelAgentRun(runId) {
  cancelFlags.set(runId, true);
}

// Balaie au demarrage les runs laisses 'queued'/'running' par un process
// precedent (crash, redeploiement) -- voir db.js#failStaleAgentRuns. A
// appeler une fois depuis index.js, apres la resolution de DATABASE_URL.
async function sweepStaleAgentRuns() {
  const n = await failStaleAgentRuns();
  if (n > 0) console.log(`${n} run(s) d'agent laissé(s) en cours par un précédent process -> marqué(s) en échec.`);
}

module.exports = { launchAgentRuns, cancelAgentRun, sweepStaleAgentRuns, EXECUTORS };
