#!/usr/bin/env node
// Verifie la base pointee par DATABASE_URL (decision A2) : version de Postgres,
// hote, disponibilite et installation des extensions vector, unaccent et
// pg_trgm. Sans DATABASE_URL, se connecte au Postgres local embarque.
//   node scripts/check-db.js            (local)
//   DATABASE_URL=postgres://… node scripts/check-db.js
// Code de sortie 1 si une extension requise manque (vector seulement en production).
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  let url = process.env.DATABASE_URL;
  let origine = 'DATABASE_URL';
  if (!url) {
    const { ensureLocalPostgres, LOCAL_DATABASE_URL } = require('../server/localPostgres');
    await ensureLocalPostgres();
    url = LOCAL_DATABASE_URL;
    origine = 'Postgres local embarqué (DATABASE_URL absente)';
  }
  const u = new URL(url);
  const ssl = u.hostname.endsWith('.render.com') ? { rejectUnauthorized: false } : false;
  const c = new Client({ connectionString: url, ssl });
  await c.connect();
  const { rows: [v] } = await c.query('SELECT version(), current_database() AS base, current_user AS utilisateur, inet_server_addr()::text AS adresse');
  const { rows: ext } = await c.query(`
    SELECT a.name, a.default_version AS disponible, e.extversion AS installee
    FROM pg_available_extensions a LEFT JOIN pg_extension e ON e.extname = a.name
    WHERE a.name IN ('vector', 'unaccent', 'pg_trgm') ORDER BY a.name`);
  const { rows: [{ rolsuper }] } = await c.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
  await c.end();

  console.log(`Base        : ${origine}`);
  console.log(`Hôte        : ${u.hostname}${u.port ? ':' + u.port : ''} (adresse serveur ${v.adresse || 'n/a'})`);
  console.log(`Base/rôle   : ${v.base} / ${v.utilisateur}${rolsuper ? ' (superutilisateur : la RLS ne s\'applique pas à ce rôle)' : ''}`);
  console.log(`Version     : ${v.version.split(' on ')[0]}`);
  const parNom = Object.fromEntries(ext.map((e) => [e.name, e]));
  let echec = false;
  for (const nom of ['unaccent', 'pg_trgm', 'vector']) {
    const e = parNom[nom];
    const etat = !e ? 'INDISPONIBLE sur ce serveur' : e.installee ? `installée (${e.installee})` : `disponible (${e.disponible}), non installée : CREATE EXTENSION ${nom};`;
    const requise = nom !== 'vector' || process.env.NODE_ENV === 'production' || process.env.REQUIRE_PGVECTOR === 'true';
    if (!(e && e.installee) && requise) echec = true;
    console.log(`Extension   : ${nom.padEnd(9)} ${etat}${!(e && e.installee) && !requise ? ' (tolérée hors production)' : ''}`);
  }
  console.log('Région      : non vérifiable depuis SQL. Dans Render : Dashboard → la base → Info → « Region » (attendu : Frankfurt), et le service web → Settings → Region.');
  if (echec) { console.error('\nÉCHEC : une extension requise manque.'); process.exit(1); }
  console.log('\nOK');
  process.exit(0);
}

main().catch((e) => { console.error('Erreur :', e.message); process.exit(2); });
