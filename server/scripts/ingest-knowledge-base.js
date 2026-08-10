// Ingestion de la base de connaissances RAG : lit chaque PDF de
// ./knowledge_base/, le decoupe en chunks logiques verifies (kbChunker.js),
// genere un embedding par chunk (kbEmbeddings.js) et stocke le tout dans
// SQLite (kb_chunks). Idempotent : repart de zero a chaque execution (meme
// esprit que seed-demo.js), donc relancable sans creer de doublons.
//
// Usage : npm run kb:ingest
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { extractDocumentSections } = require('../services/kbChunker');
const { embedBatch } = require('../services/kbEmbeddings');

const KB_DIR = path.join(__dirname, '..', '..', 'knowledge_base');

let pool = null;

async function ingest() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY manquante -- voir .env.example.');
    process.exit(1);
  }
  if (!process.env.VOYAGE_API_KEY) {
    console.error('VOYAGE_API_KEY manquante -- voir .env.example.');
    process.exit(1);
  }
  if (!fs.existsSync(KB_DIR)) {
    console.error(`Dossier introuvable : ${KB_DIR}\nCreez-le et placez-y vos PDF avant de relancer.`);
    process.exit(1);
  }
  const files = fs.readdirSync(KB_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    console.error(`Aucun PDF trouve dans ${KB_DIR}.`);
    process.exit(1);
  }

  // require() différé après la résolution de DATABASE_URL -- en local sans
  // Postgres installé, démarre (ou rejoint) le Postgres embarqué.
  if (!process.env.DATABASE_URL) await require('../localPostgres').ensureLocalPostgres();
  const db = require('../db');
  pool = db.pool;
  const { clearKbChunks, insertKbChunk, countKbChunks } = db;

  console.log(`${files.length} PDF trouve(s) dans knowledge_base/.\n`);
  await clearKbChunks();

  let totalChunks = 0;
  let totalWarnings = 0;

  for (const file of files) {
    console.log(`Traitement de ${file}...`);
    const buffer = fs.readFileSync(path.join(KB_DIR, file));

    let sections, warnings;
    try {
      ({ sections, warnings } = await extractDocumentSections(buffer));
    } catch (err) {
      console.error(`  ERREUR sur ${file} : ${err.message}`);
      continue;
    }

    warnings.forEach(w => console.warn(`  ATTENTION [${file}] "${w.sectionTitle}" : ${w.reason}`));
    totalWarnings += warnings.length;

    if (sections.length === 0) {
      console.warn(`  Aucune section exploitable pour ${file}.`);
      continue;
    }

    // Embedding calcule sur "titre — contenu" (aide le retrieval sur des
    // chunks courts qui ne repetent pas forcement le vocabulaire du titre),
    // mais seul le contenu brut (sans le titre) est stocke en base.
    const embeddings = await embedBatch(
      sections.map(s => `${s.title} — ${s.content}`),
      { inputType: 'document' }
    );

    for (const [i, s] of sections.entries()) {
      await insertKbChunk({
        id: uuidv4(),
        sourceFile: file,
        theme: s.theme,
        sectionTitle: s.title,
        articleRef: s.articleRef,
        pageStart: s.pageStart,
        pageEnd: s.pageEnd,
        content: s.content,
        embedding: embeddings[i],
      });
      totalChunks++;
    }
    console.log(`  ${sections.length} chunk(s) inseres.`);
  }

  console.log(`\nIngestion terminee : ${totalChunks} chunk(s) au total, ${totalWarnings} avertissement(s), ${await countKbChunks()} chunk(s) en base.`);
}

ingest()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => pool?.end()); // sans ca, le Pool pg garde le process ouvert indefiniment
