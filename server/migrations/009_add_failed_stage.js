// Suivi de l'etape en echec du pipeline (voir server/services/pipeline.js)
// -- permet a POST /documents/:id/retry de reprendre uniquement a partir de
// l'etape qui a echoue, sans refaire les etapes deja persistees.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('documents', { failed_stage: { type: 'text' } });
};

exports.down = (pgm) => {
  pgm.dropColumn('documents', 'failed_stage');
};
