// Contact CEO / DAF d'une cible via Apollo (optionnel : APOLLO_API_KEY).
// Recherche de la societe par son nom en France, puis des personnes aux
// postes de direction ; reveler un email coute un credit Apollo par
// personne, d'ou un plafond de deux par demande, et une demande seulement
// au clic dans la fiche (jamais en masse dans le pipeline).

const API = 'https://api.apollo.io/api/v1';
const cle = () => (process.env.APOLLO_API_KEY || '').trim();
const POSTES = ['ceo', 'president', 'président', 'directeur general', 'directeur général', 'gerant', 'gérant', 'cfo', 'daf', 'directeur administratif et financier', 'directeur financier', 'chief financial officer'];

async function appeler(chemin, corps) {
  const r = await fetch(`${API}${chemin}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cle(), 'cache-control': 'no-cache' },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(30000),
  });
  if (r.status === 401 || r.status === 403) throw new Error('Apollo refuse la cle (APOLLO_API_KEY).');
  if (r.status === 429) throw new Error('Apollo : trop de demandes, reessayez dans une minute.');
  if (r.status === 402 || r.status === 422) throw new Error('Apollo : credits epuises ou demande refusee.');
  return r.ok ? r.json().catch(() => ({})) : {};
}

async function contactsDirection({ nom, max = 2 }) {
  if (!cle()) {
    const e = new Error("Apollo n'est pas branche : ajoutez APOLLO_API_KEY dans .env pour chercher le CEO et le DAF.");
    e.status = 400;
    throw e;
  }
  const orgs = (await appeler('/mixed_companies/search', { q_organization_name: nom, organization_locations: ['France'], per_page: 5, page: 1 })).organizations || [];
  const org = orgs.find((o) => o.primary_domain) || null;
  if (!org) return { societe: null, contacts: [], note: `Aucune societe « ${nom} » avec un site web chez Apollo.` };
  const gens = ((await appeler('/mixed_people/api_search', { q_organization_domains_list: [org.primary_domain], person_titles: POSTES, per_page: 10, page: 1 })).people || []).slice(0, 6);
  const contacts = [];
  for (const p of gens.slice(0, max)) {
    const m = (await appeler('/people/match', { id: p.id })).person;
    if (!m) continue;
    contacts.push({
      nom: [m.first_name, m.last_name].filter(Boolean).join(' ') || null,
      poste: m.title || p.title || null,
      email: m.email && !/^email_not_unlocked/.test(m.email) ? m.email : null,
      linkedin: m.linkedin_url || null,
      source: 'Apollo', date: new Date().toISOString().slice(0, 10),
    });
  }
  const autres = gens.slice(max).map((p) => ({ poste: p.title || null, nom: null, masque: true }));
  return { societe: { nom: org.name, domaine: org.primary_domain, linkedin: org.linkedin_url || null }, contacts, autres };
}

module.exports = { contactsDirection, apolloBranche: () => !!cle() };
