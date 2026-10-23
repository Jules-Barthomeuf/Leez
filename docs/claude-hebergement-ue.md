# Claude avec un traitement en Europe : les options (23 octobre 2026)

Question posée (point 5 du 23 octobre) : l'extraction de la phase 1 lit les mêmes documents que le parseur ; comment utiliser Claude en garantissant un traitement dans l'Union européenne ? Vérifié sur les pages officielles le 23 octobre 2026. Ce qui n'a pas pu être lu est marqué **non vérifié**, avec la commande ou la page à consulter.

## Réponse courte

Oui, deux options garantissent l'UE, toutes deux avec **10 % de surcoût** sur le prix de liste et sans l'API Batch d'Anthropic :

1. **Claude in Amazon Bedrock, endpoint européen** (profil d'inférence EU, ou région unique Francfort ou Paris).
2. **Claude Models on Google Cloud (Google managed), endpoint multi-région `eu`**.

L'API Anthropic directe et « Claude Platform on AWS » ne le garantissent pas (géographies `us` et `global` seulement). Recommandation : Bedrock EU, avec Sonnet 5.5 pour l'extraction et Haiku 5.5 pour la classification, région `eu-central-1` (Francfort, la même géographie que Render).

## Tableau

| Option | Garantie UE | Modèles | Région | Prix vs API directe | Changements dans le code |
| --- | --- | --- | --- | --- | --- |
| API Anthropic directe | **Non.** `inference_geo` ne connaît que `"us"` et `"global"` ; le geo d'espace de travail est `"us"` seulement | tous | — | référence | — |
| Claude Platform on AWS (Anthropic opère, facturé via AWS Marketplace) | **Non.** La région AWS de l'espace de travail « ne fixe pas où tourne l'inférence » ; `inference_geo` : `us` ou `global` | tous (ids identiques à l'API) | toutes régions AWS commerciales pour l'espace de travail, pas pour l'inférence | identique (CCU à 0,01 $), US ×1,1 | `@anthropic-ai/aws-sdk` ; sans intérêt pour nous |
| **Claude in Amazon Bedrock** (AWS opère, « zero operator access ») | **Oui** : endpoint régional (une région) ou profil d'inférence EU (routage à l'intérieur de la géographie EU) | Fable 5.1, Opus 5.5, Opus 5, Opus 4.8, Opus 4.7, Sonnet 5.5, Sonnet 5, Haiku 5.5, Haiku 4.5 ; **Fable 5.1 régional seulement en `us-east-1`** (donc pas en UE) | `eu-central-1` Francfort, `eu-west-3` Paris, `eu-west-1` Irlande, `eu-north-1` Stockholm, `eu-central-2` Zurich, `eu-south-1`, `eu-south-2`, `eu-west-2` Londres (hors UE) | prix de liste AWS + **10 %** pour les endpoints régionaux et géographiques ; pas d'API Batch Anthropic (le batch Bedrock à −50 % existe mais hors SDK Anthropic) | `@anthropic-ai/bedrock-sdk`, client `AnthropicBedrockMantle({ awsRegion: 'eu-central-1' })`, modèle `anthropic.claude-sonnet-5-5` (ou le profil `eu.…`), identifiants AWS IAM sur Render ; même Messages API |
| **Claude Models on Google Cloud (Google managed)** | **Oui** : endpoint multi-région `eu` (« requests go to any region in the European Union ») ; endpoint régional (`europe-west1`…) seulement pour Sonnet 4.6 et antérieurs | Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5… en global et multi-région | multi-région `eu` (`aiplatform.eu.rep.googleapis.com`) | prix de liste Google + **10 %** multi-région ; pas d'API Batch Anthropic | `@anthropic-ai/vertex-sdk`, `AnthropicVertex({ projectId, region: 'eu' })`, modèle `claude-sonnet-5-5`, compte de service GCP sur Render |
| Claude in Microsoft Foundry | **Non vérifié** : la page de conformité régionale d'Anthropic annonçait l'Europe « Coming 2026 » (vu via un résumé de recherche, page non lue) | — | — | — | — |

## Sources (lues le 23 octobre 2026)

- Résidence des données, API directe : https://platform.claude.com/docs/en/manage-claude/data-residency. « Inference geo: Only `"us"` and `"global"` are available. Workspace geo: Only `"us"` is currently available. » US-only : ×1,1.
- Claude Platform on AWS : https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws. « The AWS region your workspace is bound to … does not pin where model inference runs. » Géographies `us` (×1,1) et `global`.
- Claude in Amazon Bedrock : https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock. Tableau des régions avec types d'endpoint « Global, EU » pour Francfort, Paris, Irlande, Stockholm, Zurich, Milan, Espagne, Londres ; « Regional endpoints carry a 10 percent pricing premium over global endpoints » ; « For Claude Fable 5.1, regional endpoints are currently available in `us-east-1` only » ; fonctions non prises en charge : « Message Batches, Models, Admin, … Files API, … Automatic prompt caching ». PDF, structured outputs, citations et prompt caching explicite : pris en charge. Charge utile 20 Mo.
- Bedrock, profils d'inférence : https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html. « If you have data residency requirements, call GetInferenceProfile from every source Region … Don't rely on the geographic prefix … alone. »
- Tarifs partenaires : https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing. « Regional and multi-region endpoints include a 10 percent premium over global endpoints. » Les pages de prix AWS (https://aws.amazon.com/bedrock/pricing/) et Google (https://cloud.google.com/vertex-ai/generative-ai/pricing#claude-models) sont rendues côté client : **tableau Claude non lisible ici, non vérifié**. Les agrégateurs donnent les prix de liste Anthropic (Sonnet 5.5 : 2 $ / 10 $ par Mtok ; Haiku 5.5 : 0,10 $ / 0,50 $ jusqu'à 100 k tokens), à confirmer dans la console AWS ou Google.
- Google managed : https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed. « Multi-region: Requests go to any region in the United States ("us") or the European Union ("eu"). » « Regional endpoints serve Claude Sonnet 4.6 and earlier models only. » « Multi-region and regional endpoints cost 10 percent more than global endpoints. » Charge utile 30 Mo. Rétention : https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance.

## Ce qui reste à vérifier, et comment

- Quels modèles ont un profil EU sur Bedrock aujourd'hui (la page liste les régions, pas les modèles par région) :
  ```
  aws bedrock list-inference-profiles --region eu-central-1 --type-equals SYSTEM_DEFINED \
    --query "inferenceProfileSummaries[?starts_with(inferenceProfileId, 'eu.')].[inferenceProfileId,status]" --output table
  aws bedrock get-inference-profile --region eu-central-1 --inference-profile-identifier eu.anthropic.claude-sonnet-5-5 --query 'models[].modelArn'
  ```
  Les ARN renvoyés doivent tous être en `eu-*`.
- Le prix exact par Mtok sur Bedrock et Vertex (console, région choisie).
- Les engagements contractuels (non-entraînement, rétention) : « Data protection in Amazon Bedrock » (https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) et la page de gouvernance Google ci-dessus.

## Ce que ça change dans le code (phase 1, non écrit)

- `packages/llm` expose un seul `creerClient()` qui choisit, par `LLM_PROVIDER=anthropic | bedrock | vertex`, entre `Anthropic`, `AnthropicBedrockMantle` et `AnthropicVertex` : même Messages API, mêmes prompts, mêmes `tools` et sorties structurées. Une table traduit les ids de modèles (`claude-sonnet-5-5` ↔ `anthropic.claude-sonnet-5-5`).
- Variables : `AWS_REGION=eu-central-1`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (ou, sur Google, `GOOGLE_CLOUD_PROJECT` et `GOOGLE_APPLICATION_CREDENTIALS`).
- Pas d'API Batch : l'extraction reste synchrone par document (ce que fait déjà le worker, un job par document). Prompt caching en points d'arrêt explicites.
- `llm_calls.cost_eur` : prix de liste × 1,1, en configuration.
- Limite de 20 Mo (Bedrock) ou 30 Mo (Google) par requête : un PDF de 100 Mo passe par fenêtres de pages (déjà prévu, spec 5.1).
- Les pages scannées sont envoyées en texte OCR (Tesseract) et, si besoin, en image de page : les deux restent dans la même région.

## Si aucune option UE n'était retenue

La promesse d'hébergement européen du site devrait alors distinguer le stockage et la base (UE : Render Francfort, Scaleway Paris) du traitement par le modèle (États-Unis ou mondial, avec engagement contractuel de non-entraînement et de rétention minimale). Les options ci-dessus rendent cette reformulation inutile.
