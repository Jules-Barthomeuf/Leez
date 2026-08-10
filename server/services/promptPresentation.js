// Interprete une instruction en langage naturel de l'analyste sur la
// Presentation comite (barre flottante, meme patron que le "pilotage par
// langage" du Simulateur -- voir promptSim.js) et la traduit en une LISTE
// D'OPERATIONS bornees. Contrairement au Simulateur, il n'y a ici AUCUNE
// hypothese modifiable : les operations ne touchent jamais aux donnees
// verifiees du dossier (prix, surfaces, loyers, indicateurs...), seulement
// a l'etat d'affichage de la presentation elle-meme (diapositive visible,
// date du comite -- seul champ editable par l'analyste sur ce document --
// plein ecran, impression, regeneration depuis les donnees actuelles,
// fermeture). Le modele ne choisit QUE l'operation ; l'execution reelle est
// deterministe, cote client (dpApplyOp dans app.js), reutilisant les memes
// fonctions que les boutons de la barre d'outils.
//
// Schema volontairement plat (meme lecon que promptSim.js) : tous les
// champs sont requis, types simples, pas d'union/nullable.
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();
const MODEL = 'claude-opus-5';

// Memes 9 diapositives, dans le meme ordre, que buildDeckHTML cote client
// (public/js/app.js) -- tenues manuellement en synchronisation.
const SLIDE_KEYS = ['hero', 'synthese', 'actif', 'locatif', 'echeancier', 'previsionnel', 'rendements', 'vigilance', 'recommandation', 'none'];
const SLIDE_DESCRIPTIONS = `- hero : titre, prix demande, cap rate recalcule, date du comite (diapositive 1)
- synthese : synthese executive, KPIs cles, verdict de l'Audit (diapositive 2)
- actif : presentation du bien et de sa localisation (diapositive 3)
- locatif : analyse locative, etat locatif, loyer moyen/m² (diapositive 4)
- echeancier : echeancier des baux et concentration locative (diapositive 5)
- previsionnel : previsionnel financier (NOI projete, necessite le Simulateur verrouille) (diapositive 6)
- rendements : rendements et hypotheses du Simulateur (TRI, MoIC, cash-on-cash) (diapositive 7)
- vigilance : points de vigilance issus de l'Audit Leez (diapositive 8)
- recommandation : verdict de l'Audit et prochaines etapes (diapositive 9)`;

// Type de photo cible pour "attach_photo" -- memes deux emplacements deja
// geres par la Presentation (buildDeckHTML) : couverture (fond de la
// diapositive de titre) et carte de situation (diapositive Actif &
// localisation). Jamais d'autre categorie ici : les autres types de
// documents annexes se gerent depuis l'onglet Documents, pas ce chat.
const PHOTO_TYPES = ['Photo de couverture', 'Carte de situation', 'none'];

// Champs de la fiche d'identite EFFECTIVEMENT affiches sur une diapositive
// de la Presentation, et donc les seuls qu'une correction demandee ici peut
// toucher -- memes cles que patchField cote client (Donnees), meme
// mecanisme reel d'edition (PATCH /documents/:id/edit, marque le champ
// "edited": true, la citation d'origine est conservee pour tracabilite mais
// le champ n'est plus presente comme verifie par le document). Ce N'EST PAS
// une entorse au principe zero-hallucination : l'analyste dicte lui-meme la
// nouvelle valeur, le modele ne fait que router vers le meme champ que
// celui qu'il aurait modifie a la main dans Donnees -- jamais une valeur
// inventee par le modele.
const EDITABLE_FIELDS = ['adresse', 'typeActif', 'sousMarche', 'classeDPE', 'prixDemande', 'surfaceLocativeGLA', 'anneeConstruction', 'nombreLots', 'placesParking', 'none'];
const NUMERIC_FIELD_UNITS = { prixDemande: 'euros', surfaceLocativeGLA: 'm²', anneeConstruction: 'annee', nombreLots: 'nombre entier', placesParking: 'nombre entier' };

const opSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['goto_slide', 'set_comite_date', 'fullscreen', 'print', 'regenerate', 'attach_photo', 'edit_field', 'close', 'none'] },
    slide: { type: 'string', enum: SLIDE_KEYS },
    comiteDate: { type: 'string' },
    fullscreenAction: { type: 'string', enum: ['enter', 'exit', 'toggle', 'none'] },
    photoType: { type: 'string', enum: PHOTO_TYPES },
    field: { type: 'string', enum: EDITABLE_FIELDS },
    fieldValue: { type: 'string' },
  },
  required: ['type', 'slide', 'comiteDate', 'fullscreenAction', 'photoType', 'field', 'fieldValue'],
  additionalProperties: false,
};

const presentationSchema = {
  type: 'object',
  properties: {
    supported: { type: 'boolean' },
    reason: { type: 'string' },
    operations: { type: 'array', items: opSchema },
  },
  required: ['supported', 'reason', 'operations'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Tu es le module d'interpretation de la barre de commande de la Presentation comite d'un outil d'analyse immobiliere (meme principe que le pilotage par langage du Simulateur : tu ne modifies JAMAIS une donnee toi-meme, tu traduis l'instruction en operations structurees executees ensuite par du code deterministe deja existant).

La Presentation comprend 9 diapositives, TOUTES generees a partir de donnees deja extraites/calculees/verifiees du dossier :
${SLIDE_DESCRIPTIONS}

Types d'operation :
1. "goto_slide" : navigue vers une diapositive precise (ex: "montre-moi les risques" -> slide=vigilance ; "va a la conclusion" -> slide=recommandation ; "les hypotheses de rendement" -> slide=rendements). Remplis slide ; laisse comiteDate='', fullscreenAction='none'.
2. "set_comite_date" : modifie la date du comite affichee sur la diapositive de titre (ex: "mets la date du comite au 15 septembre 2026" -> comiteDate="15 septembre 2026"). Remplis comiteDate avec le texte tel que formule par l'analyste (ne calcule ni ne devine jamais une date non fournie) ; laisse slide='none', fullscreenAction='none'.
3. "fullscreen" : bascule le mode plein ecran. Remplis fullscreenAction ('enter'/'exit'/'toggle' si l'intention n'est pas explicite) ; laisse slide='none', comiteDate=''.
4. "print" : lance l'impression / export PDF de la presentation. Laisse slide='none', comiteDate='', fullscreenAction='none'.
5. "regenerate" : reconstruit la presentation a partir des donnees actuellement dans le dossier (utile apres avoir verrouille le Simulateur ou modifie une donnee dans l'onglet Donnees). Laisse slide='none', comiteDate='', fullscreenAction='none'.
6. "attach_photo" : associe une image JOINTE AU MESSAGE (voir "Image jointe" ci-dessous) a un emplacement de la Presentation. Remplis photoType : 'Photo de couverture' si l'instruction parle du fond/de l'arriere-plan/de la couverture/de la photo principale (ex: "mets cette image en fond", "utilise cette photo en couverture") -- c'est le choix par defaut si l'intention n'est pas precisee ; 'Carte de situation' si l'instruction parle explicitement d'une carte, d'un plan de situation ou de localisation. N'utilise CE type QUE si le contexte indique qu'une image est reellement jointe au message -- si l'instruction parle d'ajouter/joindre une photo mais qu'AUCUNE image n'est jointe, mets supported=false et explique dans "reason" qu'il faut d'abord joindre une image via le trombone avant d'envoyer le message. Laisse slide='none', comiteDate='', fullscreenAction='none'.
7. "close" : ferme la presentation. Laisse slide='none', comiteDate='', fullscreenAction='none'.
8. "edit_field" : corrige un champ de la fiche d'identite AFFICHE sur une diapositive, a la valeur EXACTE dictee par l'analyste (ex: "le prix demande c'est en fait 4 300 000", "corrige la surface a 2 700 m2", "l'adresse est en fait 12 rue de la Paix", "mets le DPE a D"). Remplis field parmi : ${EDITABLE_FIELDS.filter(f => f !== 'none').join(', ')} (memes champs que ceux affiches sur les diapositives Titre/Synthese/Actif) et fieldValue avec la valeur telle qu'annoncee par l'analyste : pour les champs numeriques (${Object.entries(NUMERIC_FIELD_UNITS).map(([k, u]) => `${k} en ${u}`).join(', ')}), ecris UNIQUEMENT le nombre, sans separateur de milliers ni symbole (ex: "4300000", pas "4 300 000 €") ; pour les champs texte (adresse, typeActif, sousMarche, classeDPE), le texte tel quel. Ne calcule et n'invente JAMAIS une valeur non explicitement donnee par l'analyste -- si l'instruction ne precise pas de nouvelle valeur claire, mets supported=false et demande la valeur exacte dans "reason". Laisse slide='none', comiteDate='', fullscreenAction='none', photoType='none'.
9. "none" : operation vide, utilisee uniquement pour completer le tableau si tu as moins d'operations reelles.

Une instruction peut donner lieu a plusieurs operations (ex: "mets la date au 20 octobre et va a la conclusion" -> set_comite_date + goto_slide).

IMPORTANT -- ce que tu ne dois JAMAIS faire : "edit_field" (point 8) est la SEULE facon dont une donnee du dossier peut changer ici, et UNIQUEMENT quand l'analyste dicte lui-meme, explicitement, la nouvelle valeur exacte -- jamais une estimation, une deduction ou une donnee externe (comparables de marche, etc.) de ta part. Pour toute autre demande de changer une donnee (loyer, indicateur calcule, texte narratif d'une diapositive, ajouter/retirer une diapositive, afficher un chiffre non deja calcule, modifier une donnee du Simulateur...), mets supported=false et explique dans "reason" que ce type de donnee se modifie depuis un autre onglet (Donnees pour l'etat locatif complet, Simulateur pour les hypotheses financieres) -- ne propose JAMAIS une operation qui inventerait ou recalculerait une donnee. Exception specifique : si l'analyste demande de MASQUER, RETIRER ou CACHER un element precis d'UNE diapositive (un KPI, une ligne du tableau locatif, un fait, une alerte de vigilance, une hypothese...) -- pas de le supprimer du dossier, seulement de l'affichage de la presentation -- mets supported=false et explique dans "reason" qu'il peut cliquer sur le petit "✕" qui apparait au survol de cet element, directement sur la diapositive concernee, pour le masquer (chaque diapositive propose aussi un "réafficher tout" si plusieurs elements y sont masques) -- ne confonds jamais cette demande d'affichage avec une demande de modification de donnee. Renvoie aussi supported=false pour toute demande hors du perimetre ci-dessus (question generale, recherche externe...), avec une "reason" d'une phrase invitant a utiliser l'Assistant global pour ce type de demande. Si supported=true, "reason" est un resume tres court (une phrase) de l'intention comprise, sans aucune donnee chiffree.`;

async function interpretPresentationCopilot({ prompt, context }) {
  const c = context || {};
  const contextText = `Diapositive actuellement affichee : ${c.currentSlide || 'hero'}\nDate du comite actuelle : ${c.comiteDate ? `"${c.comiteDate}"` : '(non definie)'}\nSimulateur verrouille pour ce dossier : ${c.simLocked ? 'oui' : 'non'}\nImage jointe au message : ${c.hasImageAttached ? 'oui' : 'non'}\n\nInstruction de l'analyste : "${String(prompt || '').slice(0, 2000)}"`;
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: presentationSchema } },
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

module.exports = { interpretPresentationCopilot, SLIDE_KEYS };
