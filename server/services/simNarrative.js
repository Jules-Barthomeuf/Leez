// Genere un commentaire narratif en francais a partir de chiffres DEJA
// calcules cote client par le moteur deterministe du simulateur -- Claude ne
// recoit que des valeurs figees et les met en recit, il n'invente et ne
// recalcule jamais un chiffre financier. Declenchement manuel (bouton),
// jamais automatique -- meme principe de gating que l'onglet Contexte.
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();
const MODEL = 'claude-opus-5';

const narrativeSchema = {
  type: 'object',
  properties: { narrative: { type: 'string' } },
  required: ['narrative'],
  additionalProperties: false,
};

const SYSTEM_PROMPT_NARRATIVE = "Tu rediges un court commentaire d'analyste (3 a 5 phrases, francais, ton professionnel de fonds d'investissement immobilier) qui resume une simulation financiere. Tu ne dois JAMAIS calculer, halluciner ou arrondir differemment un chiffre : utilise UNIQUEMENT les valeurs numeriques fournies dans le message, telles quelles, sans les recalculer. Tu peux les mettre en perspective (ex: comparer un TRI au rendement preferentiel), commenter les alertes fournies, et mentionner les hypotheses cles listees -- mais n'ajoute aucune donnee de marche, aucune estimation, aucun chiffre qui ne serait pas explicitement present dans le message. Si une donnee necessaire manque, ne la mentionne pas plutot que de l'inventer.";

async function generateSimNarrative({ metrics, assumptions, alerts }) {
  const contextText = `Indicateurs calcules :\n${Object.entries(metrics || {}).map(([k, v]) => `${k} = ${v}`).join('\n')}\n\nHypotheses cles :\n${(assumptions || []).map(a => `- ${a}`).join('\n')}\n\nAlertes detectees :\n${(alerts || []).length ? alerts.map(a => `- [${a.niveau}] ${a.titre} : ${a.constat}`).join('\n') : 'Aucune.'}`;
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT_NARRATIVE,
    output_config: { format: { type: 'json_schema', schema: narrativeSchema } },
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

module.exports = { generateSimNarrative };
