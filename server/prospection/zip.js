// Lecture d'une entree d'archive zip sans la decompresser entiere et sans
// dependance (ni `unzip` systeme, absent de certains hebergeurs) : on lit le
// repertoire central en fin de fichier, puis on inflate seulement l'entree
// demandee, en flux. L'archive DGFiP fait ~200 Mo pour toute la France ; un
// departement n'en represente que quelques dizaines.

const fs = require('fs');
const zlib = require('zlib');

function lireOctets(fd, position, longueur) {
  const buf = Buffer.alloc(longueur);
  fs.readSync(fd, buf, 0, longueur, position);
  return buf;
}

/** Les entrees de l'archive : nom, methode, tailles, position de l'en-tete local. */
function entrees(chemin) {
  const fd = fs.openSync(chemin, 'r');
  try {
    const taille = fs.fstatSync(fd).size;
    const queue = Math.min(taille, 65557);
    const fin = lireOctets(fd, taille - queue, queue);
    let eocd = -1;
    for (let i = fin.length - 22; i >= 0; i -= 1) {
      if (fin.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`Archive zip illisible : ${chemin}`);
    const nb = fin.readUInt16LE(eocd + 10);
    const tailleRep = fin.readUInt32LE(eocd + 12);
    const debutRep = fin.readUInt32LE(eocd + 16);
    const rep = lireOctets(fd, debutRep, tailleRep);
    const out = [];
    let p = 0;
    for (let k = 0; k < nb; k += 1) {
      if (rep.readUInt32LE(p) !== 0x02014b50) break;
      const methode = rep.readUInt16LE(p + 10);
      const compresse = rep.readUInt32LE(p + 20);
      const lnom = rep.readUInt16LE(p + 28);
      const lextra = rep.readUInt16LE(p + 30);
      const lcomm = rep.readUInt16LE(p + 32);
      const local = rep.readUInt32LE(p + 42);
      // Les noms de l'archive DGFiP ne sont pas en UTF-8 (« 1 ?12 ») : latin1 suffit, on ne s'en sert que pour le code departement.
      const nom = rep.toString('latin1', p + 46, p + 46 + lnom);
      out.push({ nom, methode, compresse, local });
      p += 46 + lnom + lextra + lcomm;
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

/** Un flux lisible du contenu decompresse d'une entree. */
function fluxEntree(chemin, entree) {
  const fd = fs.openSync(chemin, 'r');
  const entete = lireOctets(fd, entree.local, 30);
  fs.closeSync(fd);
  if (entete.readUInt32LE(0) !== 0x04034b50) throw new Error(`Entree zip corrompue : ${entree.nom}`);
  const debut = entree.local + 30 + entete.readUInt16LE(26) + entete.readUInt16LE(28);
  const brut = fs.createReadStream(chemin, { start: debut, end: debut + entree.compresse - 1 });
  if (entree.methode === 0) return brut;
  if (entree.methode !== 8) throw new Error(`Methode de compression zip non geree (${entree.methode}) : ${entree.nom}`);
  return brut.pipe(zlib.createInflateRaw());
}

module.exports = { entrees, fluxEntree };
