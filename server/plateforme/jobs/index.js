// Registre des jobs que le worker sait executer : { nom de file : { executer, concurrence, parOrganisation } }.
// Les files sans entree ici existent (voir ../file.js) mais attendent la phase qui les implemente.
const { ingest } = require('./ingest');

module.exports = {
  'document.ingest': { executer: ingest, parOrganisation: 4 },
};
