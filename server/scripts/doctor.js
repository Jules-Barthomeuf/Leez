// Diagnostic complet d'un déploiement — une seule commande à lancer dans le
// Shell Render (ou en local) :  node server/scripts/doctor.js
// N'affiche JAMAIS la valeur d'un secret, seulement s'il est défini.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OK = s => console.log('  [OK]       ' + s);
const KO = s => console.log('  [PROBLÈME] ' + s);
const IN = s => console.log('  [info]     ' + s);

(async () => {
  console.log('\n===== DIAGNOSTIC LEEZ =====\n');
  let problemes = 0;

  // --- 1. Base de données ---
  console.log('1. BASE DE DONNÉES');
  const url = process.env.DATABASE_URL;
  if (!url) {
    KO('DATABASE_URL absente : base éphémère, EFFACÉE à chaque déploiement.');
    IN('Corriger : dashboard Render > service leez > Environment > Add from Database');
    IN('           > choisir la base > Internal Connection String > nom DATABASE_URL.');
    IN("           Si aucune base n'existe : New + > Postgres (région identique au service).");
    problemes++;
  } else {
    let host = '(illisible)';
    try { host = new URL(url).host; } catch { /* URL non standard */ }
    OK('DATABASE_URL définie — hôte : ' + host);
    try {
      const { pool } = require('../db');
      const { rows: [db] } = await pool.query('SELECT current_database() AS db');
      OK('Connexion réussie — base « ' + db.db + ' »');
      const { rows: [m] } = await pool.query("SELECT COUNT(*)::int AS n FROM pgmigrations").catch(() => ({ rows: [{ n: 0 }] }));
      if (m.n === 0) { KO('Aucune migration appliquée — les tables ne sont pas créées.'); problemes++; }
      else OK(m.n + ' migration(s) appliquée(s)');
      const { rows: [c] } = await pool.query(`
        SELECT (SELECT COUNT(*)::int FROM users) AS users,
               (SELECT COUNT(*)::int FROM workspaces) AS ws,
               (SELECT COUNT(*)::int FROM documents) AS docs`);
      IN(`Contenu : ${c.users} compte(s), ${c.ws} espace(s) de travail, ${c.docs} dossier(s)`);
      const admin = (process.env.SUPER_ADMIN_EMAIL || '').trim();
      if (admin) {
        const { rows } = await pool.query('SELECT workspace_id FROM users WHERE lower(email) = lower($1)', [admin]);
        if (!rows[0]) { KO(`Le compte ${admin} n'existe pas dans cette base.`); problemes++; }
        else if (!rows[0].workspace_id) IN(`${admin} existe mais n'a pas d'espace de travail (bouton « Créer mon espace de travail » à la connexion).`);
        else OK(`Le compte ${admin} existe et a un espace de travail.`);
      }
    } catch (err) {
      KO('Connexion impossible : ' + (err.message || err.code || 'erreur inconnue'));
      problemes++;
    }
  }

  // --- 2. Variables d'environnement ---
  console.log('\n2. VARIABLES D\'ENVIRONNEMENT');
  const attendues = [
    ['SUPER_ADMIN_EMAIL', true, 'compte administrateur de la plateforme'],
    ['BOOTSTRAP_ADMIN_PASSWORD', true, 'recrée le compte admin au démarrage s\'il manque'],
    ['SESSION_SECRET', true, 'signature des sessions (sinon déconnexions à chaque déploiement)'],
    ['UPLOAD_DIR', true, 'dossier des PDF importés'],
    ['ANTHROPIC_API_KEY', false, 'extraction des documents'],
    ['VOYAGE_API_KEY', false, 'base de connaissances'],
  ];
  for (const [key, requis, role] of attendues) {
    if (process.env[key]) OK(`${key} définie (${role})`);
    else if (requis) { KO(`${key} absente — ${role}`); problemes++; }
    else IN(`${key} absente (optionnelle) — ${role}`);
  }

  // --- 3. Stockage des fichiers ---
  console.log('\n3. STOCKAGE DES FICHIERS IMPORTÉS');
  const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
  IN('Chemin : ' + uploadDir);
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    const probe = path.join(uploadDir, '.doctor-probe');
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    const pdfs = fs.readdirSync(uploadDir).filter(f => f.endsWith('.pdf')).length;
    OK(`Accessible en écriture — ${pdfs} PDF présent(s)`);
    if (process.env.DATABASE_URL && !uploadDir.startsWith('/var/data')) {
      IN("Attention : hors d'un disque persistant, les PDF sont perdus à chaque déploiement.");
      IN('Corriger : onglet Disks du service > disque monté sur /var/data, puis UPLOAD_DIR=/var/data/uploads');
    }
  } catch (err) {
    KO('Écriture impossible : ' + err.message);
    problemes++;
  }

  console.log('\n===== ' + (problemes === 0 ? 'AUCUN PROBLÈME DÉTECTÉ' : problemes + ' PROBLÈME(S) À CORRIGER') + ' =====\n');
  process.exit(0);
})();
