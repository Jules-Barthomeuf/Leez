// Lecteur de mails (.eml, mailparser) : le corps text/plain est la page 1
// (partie « text/plain » du jeu de benchmark), le corps HTML converti en texte
// la page 2 s'il existe seul, et les pieces jointes sont listees (elles sont
// ingerees a part par document.ingest).
const { simpleParser } = require('mailparser');

/**
 * @param {{ buffer: Buffer }} entree
 * @returns {Promise<import('../core/types').ParsedDocument>}
 */
async function parse({ buffer }) {
  const debut = Date.now();
  const mail = await simpleParser(buffer);
  const entete = [`De : ${mail.from ? mail.from.text : ''}`, `À : ${mail.to ? (Array.isArray(mail.to) ? mail.to.map((t) => t.text).join(', ') : mail.to.text) : ''}`, `Objet : ${mail.subject || ''}`, `Date : ${mail.date ? mail.date.toISOString() : ''}`].join('\n');
  const texte = (mail.text || (mail.html ? String(mail.html).replace(/<[^>]+>/g, ' ') : '')).replace(/\r\n/g, '\n').trim();
  const pages = [{
    page_number: 1, width: null, height: null, text: texte, ocr: false, partie: mail.text ? 'text/plain' : 'text/html',
    blocks: [
      { id: 'entete', type: 'title', bbox: null, char_start: 0, char_end: 0, text: entete },
      { id: 'corps', type: 'text', bbox: null, char_start: 0, char_end: texte.length, text: texte },
    ],
    pieces_jointes: (mail.attachments || []).map((p) => ({ filename: p.filename, contentType: p.contentType, size: p.size })),
    date: mail.date ? mail.date.toISOString() : null,
    subject: mail.subject || null,
  }];
  return { parser: 'email', pages, mesure: { ms: Date.now() - debut, cout_eur: 0, pages: 1 } };
}

module.exports = { nom: 'email', description: 'mailparser : corps text/plain en page 1, pièces jointes listées', parse, disponible: async () => ({ ok: true }) };
