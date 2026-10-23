// Job document.ingest (spec, section 4) : verifie le type du fichier, calcule
// son sha256, detecte les doublons du deal, decompresse les zip et extrait
// les pieces jointes des mails en documents enfants (chacun avec son propre
// ingest), puis passe la main a document.parse. Relancable sans doublon : un
// enfant deja cree (meme parent, meme nom) n'est pas recree, et un document
// deja marque doublon n'est pas retraite.
const AdmZip = require('adm-zip');
const { simpleParser } = require('mailparser');
const { avecOrg } = require('../db');
const St = require('../stockage');
const { envoyer } = require('../file');
const { typeDeFichier, LIMITES } = require('../../../packages/core');

const IMAGE_SIGNATURE_MAX = 20 * 1024; // les logos de signature de mail (< 20 Ko) sont ignores (section 14)

function entreesZip(buffer) {
  const zip = new AdmZip(buffer);
  return zip.getEntries()
    .filter((e) => !e.isDirectory)
    .filter((e) => !/(^|\/)(__MACOSX|\.)/.test(e.entryName))
    .map((e) => ({ nom: e.entryName.split('/').pop(), contenu: () => e.getData() }));
}

async function piecesJointes(buffer) {
  const mail = await simpleParser(buffer);
  const pieces = (mail.attachments || [])
    .filter((p) => p.filename && p.content)
    .filter((p) => !(/^image\//.test(p.contentType || '') && p.content.length < IMAGE_SIGNATURE_MAX))
    .map((p) => ({ nom: p.filename, contenu: () => p.content }));
  return { pieces, date: mail.date || null };
}

/**
 * Cree les documents enfants manquants et ecrit leurs fichiers. Rend les ids crees.
 * Un enfant dont le type n'est pas accepte est cree quand meme, puis mis en echec par son propre ingest :
 * l'utilisateur voit ainsi ce que contenait l'archive.
 */
async function creerEnfants(client, parent, enfants) {
  const crees = [];
  for (const enfant of enfants) {
    const nom = St.nomSur(enfant.nom);
    const { rows: deja } = await client.query('SELECT id FROM plateforme.documents WHERE parent_document_id = $1 AND filename = $2', [parent.id, nom]);
    if (deja.length) continue;
    const type = typeDeFichier(nom);
    const { rows: [doc] } = await client.query(
      `INSERT INTO plateforme.documents (org_id, deal_id, parent_document_id, filename, mime, status)
       VALUES ($1, $2, $3, $4, $5, 'uploaded') RETURNING id`,
      [parent.org_id, parent.deal_id, parent.id, nom, type ? type.mime : 'application/octet-stream'],
    );
    const relatif = St.cheminRelatif(parent.org_id, parent.deal_id, doc.id, nom);
    await St.ecrire(relatif, enfant.contenu());
    await client.query('UPDATE plateforme.documents SET storage_path = $2 WHERE id = $1', [doc.id, relatif]);
    crees.push(doc.id);
  }
  return crees;
}

async function ingest({ org_id, document_id }, { journal = () => {} } = {}) {
  const aEnvoyer = [];
  await avecOrg(org_id, 'worker', async (client) => {
    // Filtre explicite par organisation en plus de la RLS (principe 7).
    const { rows: [doc] } = await client.query('SELECT * FROM plateforme.documents WHERE id = $1 AND org_id = $2', [document_id, org_id]);
    if (!doc) { journal(`document ${document_id} absent (supprimé ?)`); return; }
    if (doc.status === 'duplicate') return;
    const echec = (message) => client.query("UPDATE plateforme.documents SET status = 'failed', error = $2 WHERE id = $1", [doc.id, message]);

    if (!doc.storage_path || !(await St.existe(doc.storage_path))) { await echec('Fichier absent du stockage.'); return; }
    const type = typeDeFichier(doc.filename);
    if (!type) { await echec(`Type de fichier non pris en charge : ${doc.filename}. Formats acceptés : pdf, docx, xlsx, xls, csv, eml, msg, zip, jpg, png.`); return; }
    const taille = await St.taille(doc.storage_path);
    if (taille > LIMITES.taille_fichier) { await echec('Fichier trop volumineux : 100 Mo au plus.'); return; }

    const sha = await St.sha256DuFichier(doc.storage_path);
    const { rows: doublons } = await client.query(
      'SELECT id FROM plateforme.documents WHERE deal_id = $1 AND sha256 = $2 AND id <> $3 AND org_id = $4 AND duplicate_of IS NULL AND page_range IS NULL ORDER BY created_at LIMIT 1',
      [doc.deal_id, sha, doc.id, org_id],
    );
    if (doublons.length) {
      await client.query("UPDATE plateforme.documents SET status = 'duplicate', duplicate_of = $2, sha256 = $3, size_bytes = $4, mime = $5, error = NULL WHERE id = $1", [doc.id, doublons[0].id, sha, taille, type.mime]);
      journal(`${doc.filename} : doublon de ${doublons[0].id}, chaîne arrêtée`);
      return;
    }
    await client.query("UPDATE plateforme.documents SET sha256 = $2, size_bytes = $3, mime = $4, status = 'uploaded', error = NULL, duplicate_of = NULL WHERE id = $1", [doc.id, sha, taille, type.mime]);

    let enfants = [];
    if (type.extension === 'zip') {
      const contenu = await require('fs').promises.readFile(St.cheminAbsolu(doc.storage_path));
      enfants = entreesZip(contenu);
    } else if (type.extension === 'eml') {
      const contenu = await require('fs').promises.readFile(St.cheminAbsolu(doc.storage_path));
      const { pieces, date } = await piecesJointes(contenu);
      enfants = pieces;
      if (date && !doc.document_date) await client.query('UPDATE plateforme.documents SET document_date = $2 WHERE id = $1', [doc.id, date]);
    }
    if (enfants.length) {
      const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM plateforme.documents WHERE deal_id = $1', [doc.deal_id]);
      if (n + enfants.length > LIMITES.documents_par_deal) { await echec(`Limite de ${LIMITES.documents_par_deal} documents par dossier dépassée.`); return; }
      const crees = await creerEnfants(client, { id: doc.id, org_id, deal_id: doc.deal_id }, enfants);
      journal(`${doc.filename} : ${crees.length} fichier(s) extrait(s)`);
      for (const id of crees) aEnvoyer.push(['document.ingest', { org_id, document_id: id }]);
    }
    // Un conteneur (zip, mail sans corps exploitable) n'a rien a lire lui-meme : seuls ses enfants continuent.
    if (type.extension !== 'zip') aEnvoyer.push(['document.parse', { org_id, document_id: doc.id }]);
  });
  // Apres COMMIT seulement : un job envoye avant pourrait tourner sur une ligne pas encore visible.
  for (const [nom, donnees] of aEnvoyer) await envoyer(nom, donnees, { singletonKey: `${nom}:${donnees.document_id}`, singletonSeconds: 60 });
}

module.exports = { ingest, entreesZip, piecesJointes };
