// Interprete une instruction en langage naturel de l'analyste ("pilotage par
// le langage" du simulateur) et la traduit en une LISTE D'OPERATIONS sur le
// modele -- Claude ne calcule et n'invente JAMAIS un chiffre financier ici :
// il choisit uniquement QUEL champ modifier, QUELLE annee, QUEL montant tel
// qu'exprime par l'analyste. Le recalcul reel (TRI, DSCR, cash-flows...) est
// ensuite refait integralement cote client par le meme moteur deterministe
// que le reste du simulateur (computeModel dans simulator.js) ; le message
// de confirmation affiche a l'utilisateur est lui aussi assemble cote client
// a partir des chiffres reellement recalcules, jamais a partir du texte
// renvoye par le modele.
//
// Schema volontairement plat, sans aucun champ nullable/optionnel (lecon
// tiree de l'erreur 400 "compiled grammar is too large" rencontree sur les
// schemas d'extraction -- voir extraction.js) : tous les champs sont
// requis, types simples (string/number/integer/boolean/enum), pas d'union.
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();
const { CHAT_MODEL } = require('./models');
const MODEL = CHAT_MODEL;

// Memes cles que FIELD dans public/js/simulator.js -- tenues manuellement en
// synchronisation (pas de partage de module cote client/serveur dans ce
// projet). Les booleens (loyerSoumisTVA, commissionAgentActive,
// commissionAgentInclusFAI, chargesCoproRefacturable, taxeFonciereRefacturable,
// renegociationActive) sont exposes en 0/1 pour rester dans le sous-ensemble
// de types simples du schema.
const EDITABLE_FIELDS = [
  'surface', 'loyerAnnuelInitial', 'indexationPct', 'tauxVacancePct', 'loyerSoumisTVA', 'tauxTVA',
  'prixAffiche', 'negociationPct', 'commissionAgentActive', 'commissionAgentPct', 'commissionAgentInclusFAI',
  'tauxDroitsEnregistrement', 'fraisDossierBancaire', 'coutCreationSociete', 'fraisCourtage',
  'chargesCoproRefacturable', 'chargesCoproAnnuelles', 'taxeFonciereRefacturable', 'taxeFonciereAnnuelle',
  'fraisGestionPct', 'fraisComptabilite', 'assurancePNO', 'chargesDiverses',
  'apport', 'dureeCreditAns', 'tauxInteretPct', 'periodeInFineAns', 'tauxAssuranceCreditPct',
  'renegociationActive', 'anneeRenegociation', 'nouveauTauxRenegociation', 'iraRenegociationMois',
  'anneeSortie', 'rendementSortiePct', 'commissionRentePct',
  'none',
];

// Metriques annuelles disponibles pour un graphique cree par l'IA (memes
// cles que les champs reellement presents dans chaque ligne "annees" de
// computeModel, cote client -- voir ANNUAL_METRICS dans simulator.js) et
// champs numeriques balayables pour un graphique de sensibilite (memes cles
// que SWEEP_FIELDS cote client) / indicateurs de sortie correspondants
// (memes cles que SWEEP_METRICS cote client).
const CHART_METRICS = ['loyerAnnuel', 'loyersNets', 'cashFlow', 'cumulCashFlow', 'capitalRestantDu', 'dscr', 'impotIS', 'chargesExploitation', 'none'];
const SWEEP_FIELDS = ['tauxInteretPct', 'tauxVacancePct', 'indexationPct', 'rendementSortiePct', 'apport', 'negociationPct', 'dureeCreditAns', 'anneeSortie', 'fraisGestionPct', 'none'];
const SWEEP_METRICS = ['tri', 'moic', 'cashFlowMoyenAn', 'avgDscr', 'rendementLocatifMoyen', 'none'];

const opSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['set_field', 'add_capex', 'apply_scenario', 'reset', 'create_chart', 'none'] },
    field: { type: 'string', enum: EDITABLE_FIELDS },
    value: { type: 'number' },
    year: { type: 'integer' },
    label: { type: 'string' },
    scenario: { type: 'string', enum: ['optimiste', 'pessimiste', 'base', 'none'] },
    chartMetric: { type: 'string', enum: CHART_METRICS },
    chartMetric2: { type: 'string', enum: CHART_METRICS },
    chartXField: { type: 'string', enum: SWEEP_FIELDS },
    chartYMetric: { type: 'string', enum: SWEEP_METRICS },
    chartTitle: { type: 'string' },
  },
  required: ['type', 'field', 'value', 'year', 'label', 'scenario', 'chartMetric', 'chartMetric2', 'chartXField', 'chartYMetric', 'chartTitle'],
  additionalProperties: false,
};

const copilotSchema = {
  type: 'object',
  properties: {
    supported: { type: 'boolean' },
    reason: { type: 'string' },
    operations: { type: 'array', items: opSchema },
  },
  required: ['supported', 'reason', 'operations'],
  additionalProperties: false,
};

// Description de "create_chart" partagee entre le pilotage par langage et le
// module de suggestions proactives ci-dessous -- memes regles, meme moteur
// de rendu cote client (renderAreaChart dans simulator.js).
const CREATE_CHART_DOC = `"create_chart" : cree un NOUVEAU graphique affiche dans l'onglet Visuels, a partir de chiffres REELS deja calcules par le moteur (tu ne calcules toujours aucun chiffre toi-meme, tu choisis seulement QUOI tracer). Deux formes possibles, mutuellement exclusives :
   a. Graphique ANNUEL (evolution sur la duree de detention) : remplis chartMetric (obligatoire) et eventuellement chartMetric2 (deuxieme serie a superposer, sinon 'none') parmi : loyerAnnuel, loyersNets, cashFlow, cumulCashFlow, capitalRestantDu, dscr, impotIS, chargesExploitation. Laisse chartXField='none' et chartYMetric='none'. Exemple : "trace l'evolution du DSCR" -> chartMetric='dscr'.
   b. Graphique de SENSIBILITE (un indicateur de sortie en fonction d'un parametre qui varie sur toute sa plage) : remplis chartXField (le parametre qui varie) parmi : tauxInteretPct, tauxVacancePct, indexationPct, rendementSortiePct, apport, negociationPct, dureeCreditAns, anneeSortie, fraisGestionPct, ET chartYMetric (l'indicateur affiche) parmi : tri, moic, cashFlowMoyenAn, avgDscr, rendementLocatifMoyen. Laisse chartMetric='none' et chartMetric2='none'. Exemple : "trace le TRI en fonction du taux d'interet" -> chartXField='tauxInteretPct', chartYMetric='tri'. Utilise cette forme des qu'une variation/dependance est demandee ou pertinente ("en fonction de", "selon", "si X variait", ou -- pour les suggestions proactives -- l'hypothese qui pese le plus sur le deal).
   Remplis toujours chartTitle avec un titre court et clair en francais (texte libre, PAS un chiffre calcule -- ex: "DSCR sur la duree de detention" ou "TRI selon le taux d'intérêt"). Laisse field='none', value=0, year=0, label='', scenario='none' pour ce type d'operation.`;

const SYSTEM_PROMPT_COPILOT = `Tu es le module d'interpretation du "pilotage par le langage" d'un simulateur financier immobilier pour un investisseur individuel (apport personnel, pas de structure fonds). Tu ne calcules JAMAIS toi-meme un TRI, un DSCR ou tout autre chiffre financier : tu traduis UNIQUEMENT l'instruction de l'analyste en une liste d'operations structurees, appliquees ensuite par un moteur de calcul deterministe deja existant qui refait tous les calculs.

Champs editables disponibles (utilise EXACTEMENT ces cles dans "field") : ${EDITABLE_FIELDS.filter(f => f !== 'none').join(', ')}.
- Les montants monetaires (loyerAnnuelInitial, prixAffiche, fraisDossierBancaire, coutCreationSociete, fraisCourtage, chargesCoproAnnuelles, taxeFonciereAnnuelle, fraisComptabilite, assurancePNO, chargesDiverses, apport) sont en EUROS, valeur absolue (ex: "200k" -> value=200000).
- Les pourcentages (indexationPct, tauxVacancePct, tauxTVA, negociationPct, commissionAgentPct, tauxDroitsEnregistrement, fraisGestionPct, tauxInteretPct, tauxAssuranceCreditPct, nouveauTauxRenegociation, rendementSortiePct, commissionRentePct) sont en POINTS DE POURCENTAGE, valeur absolue (ex: "passe la vacance a 8%" -> field=tauxVacancePct, value=8, PAS 0.08).
- Les durees (dureeCreditAns, periodeInFineAns, anneeSortie, anneeRenegociation) sont des entiers en annees ; iraRenegociationMois est en mois (peut etre decimal, ex: 3.5).
- loyerSoumisTVA, commissionAgentActive, commissionAgentInclusFAI, chargesCoproRefacturable, taxeFonciereRefacturable et renegociationActive sont des booleens : value=1 pour activer, value=0 pour desactiver.

Types d'operation :
1. "set_field" : modifie un champ a une VALEUR ABSOLUE (jamais un delta -- si l'analyste dit "augmente de 2 points", calcule toi-meme la nouvelle valeur absolue a partir du contexte fourni). Remplis field et value ; laisse year=0, label='', scenario='none'.
2. "add_capex" : ajoute une ligne de travaux ponctuels a une annee donnee (ex: "ajoute une ligne de travaux de toiture de 200k en annee 3"). Remplis year (entier >=1), value (montant EUR) et label (description courte, ex: "Travaux de toiture") ; laisse field='none', scenario='none'.
3. "apply_scenario" : bascule l'affichage sur le scenario Optimiste/Base/Pessimiste DEJA CALCULE par le moteur, sans rien modifier (ex: "montre-moi le scenario pessimiste"). Remplis scenario ; laisse field='none', value=0, year=0, label=''. N'utilise CE type QUE pour une demande de consultation d'un des 3 scenarios deja nommes -- pas pour une demande de simulation personnalisee (crise, choc, "et si...") : dans ce cas utilise plusieurs "set_field" (voir ci-dessous).
4. "reset" : reinitialise toutes les hypotheses aux valeurs sourcees du dossier (ex: "annule tout", "reviens a la situation initiale", "enleve la crise que tu as simulee"). Une seule operation de ce type suffit ; laisse field='none', value=0, year=0, label='', scenario='none'.
5. ${CREATE_CHART_DOC}
6. "none" : operation vide, utilisee uniquement pour completer le tableau si tu as moins d'operations reelles a proposer.

Une instruction peut donner lieu a PLUSIEURS operations (jusqu'a une dizaine) -- notamment pour simuler une CRISE ou un CHOC personnalise ("simule une crise", "et si le marche se retournait ?", "simule une crise des taux severe"), qui n'est PAS un des 3 scenarios nommes mais une combinaison de "set_field" que tu choisis toi-meme selon le type de crise decrit et son intensite (legere/moderee/severe si precisee, moderee par defaut). Conventions Leez pour une combinaison credible (a exprimer en VALEURS ABSOLUES a partir de l'etat courant, jamais des deltas dans le champ "value") :
- Crise des taux / choc de taux / remontee des taux : tauxInteretPct +100 bps (legere), +200 bps (moderee/non precisee), +300 bps ou plus (severe/grave/violente).
- Crise locative / vacance / recession locative / depart de locataires : tauxVacancePct +5 pts (legere), +10 pts (moderee), +15 a 20 pts (severe) ; indexationPct ramene pres de 0.
- Crise immobiliere / krach / correction du marche / retournement (generale, sans precision) : combine plusieurs leviers -- rendementSortiePct +75 a +150 bps (compression des valeurs a la revente), tauxVacancePct +5 a +10 pts, indexationPct pres de 0, et tauxInteretPct +100 a +200 bps si un contexte de resserrement monetaire est explicitement ou implicitement en cause.
- Reprise / marche favorable / embellie : logique inverse (baisse de tauxVacancePct, hausse d'indexationPct, baisse de rendementSortiePct), avec la meme granularite legere/moderee/forte.
Ces magnitudes sont des CONVENTIONS de simulation, pas des donnees de marche extraites -- le message de confirmation affiche a l'analyste listera explicitement chaque champ modifie et sa nouvelle valeur, donc aucune ambiguite sur ce qui a ete simule. Choisis TOUJOURS des valeurs qui restent dans une plage plausible (ne fais jamais depasser un taux de vacance de 60% ou un taux d'interet de 15% par exemple, meme pour une crise "severe").

Si l'instruction porte sur une donnee que ce modele ne gere pas (comparables de marche externes, prevision macroeconomique non traduisible en un champ du simulateur, question hors du perimetre financier du simulateur), mets supported=false, explique pourquoi en une phrase dans "reason", et renvoie un tableau operations avec une seule operation de type "none". Si supported=true, "reason" est un resume tres court (une phrase, sans aucun chiffre calcule -- seulement ce que tu as compris de la demande) de l'intention de l'analyste.`;

// Module de suggestions proactives ("qu'est-ce qui merite d'etre regarde ?")
// -- declenchement MANUEL (bouton), jamais automatique, meme principe de
// gating cout que le reste de l'app. Reutilise le meme schema d'operations
// que le pilotage par langage, mais restreint a "create_chart" : ce module
// ne doit JAMAIS modifier une hypothese de lui-meme, seulement proposer des
// graphiques pertinents et expliquer pourquoi, a partir des alertes et
// indicateurs deja calcules (jamais un chiffre invente ou une donnee de
// marche externe).
const SYSTEM_PROMPT_SUGGEST = `Tu es le module de suggestions proactives du copilote d'un simulateur financier immobilier pour un investisseur individuel. On te fournit les indicateurs, hypotheses sourcees et alertes DEJA CALCULES pour le dossier actuellement ouvert. Ton role : decider ce qui merite le plus l'attention de l'analyste EN CE MOMENT, et proposer jusqu'a 2 graphiques pertinents pour l'illustrer.

Tu ne dois JAMAIS modifier une hypothese : les types d'operation "set_field", "add_capex", "apply_scenario" et "reset" sont INTERDITS ici -- seul ${CREATE_CHART_DOC}

Priorise tes suggestions selon les ALERTES reellement detectees, en commencant par les plus severes (rouge avant orange) : si une alerte porte sur le DSCR, propose un graphique de son evolution (chartMetric='dscr') ou de sa sensibilite ; si elle porte sur le rendement de sortie / cap rate, propose un graphique de sensibilite du TRI selon rendementSortiePct ; si elle porte sur la vacance ou l'indexation, propose l'hypothese correspondante en chartXField. S'il n'y a AUCUNE alerte, propose plutot un graphique de verification standard et utile (trajectoire du cash-flow cumule, ou sensibilite du TRI a l'hypothese la plus incertaine parmi les hypotheses sourcees fournies).

Renvoie toujours supported=true. "operations" contient 1 ou 2 operations de type "create_chart" (le reste, le cas echeant, de type "none"). "reason" est ton analyse : 2 a 4 phrases en francais expliquant CONCRETEMENT, en te referant aux alertes/indicateurs reellement fournis ci-dessous, pourquoi ces graphiques meritent d'etre regardes -- jamais un chiffre invente, jamais une donnee de marche externe.`;

async function interpretSimCopilot({ prompt, simState }) {
  const s = simState || {};
  const contextText = `Valeurs ACTUELLES du simulateur (etat courant, avant votre interpretation) :\n${Object.entries(s).map(([k, v]) => `${k} = ${v}`).join(', ')}\n\nInstruction de l'analyste : "${String(prompt || '').slice(0, 2000)}"`;
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1536,
    system: SYSTEM_PROMPT_COPILOT,
    output_config: { format: { type: 'json_schema', schema: copilotSchema } },
    messages: [{ role: 'user', content: contextText }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('Le modele a refuse cette requete (stop_reason=refusal).');
  }
  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error(`Aucune reponse structuree du modele (stop_reason=${message.stop_reason}).`);
  }
  return JSON.parse(textBlock.text);
}

async function interpretSimSuggestions({ simState, metrics, alerts, assumptions }) {
  const s = simState || {};
  const contextText = `Valeurs ACTUELLES du simulateur :\n${Object.entries(s).map(([k, v]) => `${k} = ${v}`).join(', ')}\n\nIndicateurs calcules :\n${Object.entries(metrics || {}).map(([k, v]) => `${k} = ${v}`).join('\n')}\n\nHypotheses sourcees :\n${(assumptions || []).map(a => `- ${a}`).join('\n') || 'Aucune.'}\n\nAlertes detectees :\n${(alerts || []).length ? alerts.map(a => `- [${a.niveau}] ${a.titre} : ${a.constat}`).join('\n') : 'Aucune.'}`;
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT_SUGGEST,
    output_config: { format: { type: 'json_schema', schema: copilotSchema } },
    messages: [{ role: 'user', content: contextText }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('Le modele a refuse cette requete (stop_reason=refusal).');
  }
  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error(`Aucune reponse structuree du modele (stop_reason=${message.stop_reason}).`);
  }
  const parsed = JSON.parse(textBlock.text);
  // Ceinture et bretelles : meme si le prompt l'interdit, on filtre cote
  // serveur toute operation mutante avant de renvoyer la reponse au client.
  parsed.operations = (parsed.operations || []).filter(op => op.type === 'create_chart' || op.type === 'none');
  return parsed;
}

module.exports = { interpretSimCopilot, interpretSimSuggestions, EDITABLE_FIELDS };
