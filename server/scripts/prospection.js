// Prospection cession-bail en ligne de commande : le meme pipeline que
// l'ecran, pour un departement, avec l'export CSV dans data/prospection/out.
//   npm run prospection -- --dept 06 [--min 5000000] [--max 50000000]
const { lancer, cheminCsv } = require('../prospection/pipeline');

const arg = (nom, defaut) => { const i = process.argv.indexOf(`--${nom}`); return i > 0 ? process.argv[i + 1] : defaut; };
const dept = String(arg('dept', '06')).toUpperCase();

lancer(dept, { ticketMin: Number(arg('min', 5e6)), ticketMax: Number(arg('max', 50e6)), journal: (m) => console.log(m) })
  .then((r) => { console.log(JSON.stringify(r.stats, null, 2)); console.log(`CSV : ${cheminCsv(dept)}`); })
  .catch((e) => { console.error(e); process.exit(1); });
