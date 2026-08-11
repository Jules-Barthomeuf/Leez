// Orchestration multi-agents (voir spec "Leez -- orchestration multi-
// agents" §5.2). Toutes les routes verifient d'abord que le dossier
// appartient au workspace courant via getDocument(id, req.workspaceId) --
// agent_runs/agent_findings n'ont pas de colonne workspace_id propre (voir
// le commentaire en tete de la migration 012), le scoping passe TOUJOURS
// par le dossier parent, meme pattern deja en place pour
// supporting_documents.
const express = require('express');
const {
  getDocument, getAgentRun, updateAgentRun, listAgentRunsForDossier,
  listAgentFindingsForDossier, getAgentFinding, setFindingValidationStatus,
} = require('../db');
const { launchAgentRuns, cancelAgentRun, EXECUTORS } = require('../services/agentRunner');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.post('/dossiers/:id/agents/run', asyncHandler(async (req, res) => {
  const dossier = await getDocument(req.params.id, req.workspaceId);
  if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
  const agentTypes = Array.isArray(req.body?.agents) ? req.body.agents.filter(a => typeof a === 'string') : [];
  if (agentTypes.length === 0) return res.status(400).json({ error: 'Aucun agent demandé.' });
  const tenantNames = Array.isArray(req.body?.tenantNames) ? req.body.tenantNames.filter(t => typeof t === 'string') : undefined;

  const created = await launchAgentRuns({ dossier, userId: req.userId, agentTypes, scope: { tenantNames } });
  const skipped = agentTypes.filter(a => !created.some(c => c.agentType === a));
  res.status(201).json({ created, skipped });
}));

router.post('/agent-runs/:id/cancel', asyncHandler(async (req, res) => {
  const run = await getAgentRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run introuvable.' });
  const dossier = await getDocument(run.dossier_id, req.workspaceId);
  if (!dossier) return res.status(404).json({ error: 'Run introuvable.' }); // dossier d'un autre workspace : jamais 403, meme logique qu'ailleurs
  if (!['queued', 'running'].includes(run.status)) {
    return res.status(400).json({ error: 'Ce run est déjà terminé, impossible de l\'annuler.' });
  }
  // Ecrit le statut immediatement (retour visuel instantane) -- le worker
  // ne verifie le flag qu'entre deux etapes (voir agents/locataires.js),
  // ses propres ecritures de progression ne touchent jamais `status` donc
  // aucun risque qu'elles l'ecrasent apres coup.
  await updateAgentRun(run.id, { status: 'cancelled', ended_at: new Date().toISOString() });
  cancelAgentRun(run.id);
  res.json({ ok: true });
}));

router.get('/dossiers/:id/agents/state', asyncHandler(async (req, res) => {
  const dossier = await getDocument(req.params.id, req.workspaceId);
  if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
  const [runs, findings] = await Promise.all([
    listAgentRunsForDossier(dossier.id),
    listAgentFindingsForDossier(dossier.id),
  ]);
  const findingsByRun = new Map();
  for (const f of findings) {
    if (!findingsByRun.has(f.agent_run_id)) findingsByRun.set(f.agent_run_id, []);
    findingsByRun.get(f.agent_run_id).push({
      id: f.id,
      kind: f.kind,
      payload: f.payload,
      sourceUrl: f.source_url,
      sourceLabel: f.source_label,
      sourceDate: f.source_date,
      sourceTier: f.source_tier,
      validationStatus: f.validation_status,
      targetField: f.target_field,
      createdAt: f.created_at,
    });
  }
  res.json({
    runs: runs.map(r => ({
      id: r.id,
      agentType: r.agent_type,
      status: r.status,
      dependsOn: r.depends_on,
      stepsTotal: r.steps_total,
      stepsDone: r.steps_done,
      currentStepLabel: r.current_step_label,
      sourcesCount: r.sources_count,
      result: r.result,
      errorMessage: r.error_message,
      tokenCost: r.token_cost,
      createdAt: r.created_at,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      findings: findingsByRun.get(r.id) || [],
    })),
    availableAgentTypes: Object.keys(EXECUTORS),
  });
}));

// Marque un finding valide/rejete. Si la ligne porte un target_field
// (aucun agent du Lot 1 n'en produit -- reserve aux agents "marche"/
// "comparables" du Lot 2, dont les findings alimentent un calcul), c'est a
// ce point que la valeur devra etre ecrite dans le dossier + journalisee
// dans field_audit (§3.4/§7.5 de la spec) -- pas encore construit ici,
// volontairement : rien ne l'exerce tant qu'aucun agent ne pose
// target_field, l'ajouter maintenant serait du code mort non verifiable.
router.post('/findings/:id/accept', asyncHandler(async (req, res) => {
  const finding = await getAgentFinding(req.params.id);
  if (!finding) return res.status(404).json({ error: 'Finding introuvable.' });
  const dossier = await getDocument(finding.dossier_id, req.workspaceId);
  if (!dossier) return res.status(404).json({ error: 'Finding introuvable.' });
  await setFindingValidationStatus(finding.id, 'accepted');
  res.json({ ok: true });
}));

router.post('/findings/:id/reject', asyncHandler(async (req, res) => {
  const finding = await getAgentFinding(req.params.id);
  if (!finding) return res.status(404).json({ error: 'Finding introuvable.' });
  const dossier = await getDocument(finding.dossier_id, req.workspaceId);
  if (!dossier) return res.status(404).json({ error: 'Finding introuvable.' });
  await setFindingValidationStatus(finding.id, 'rejected');
  res.json({ ok: true });
}));

module.exports = router;
