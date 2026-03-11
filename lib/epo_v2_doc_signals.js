const { EPO_CODEX_DATA } = require('./epo_codex_data');

function normalize(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function codexDescriptionRecord(description = '') {
  const key = normalize(description);
  return key ? (EPO_CODEX_DATA.byDescription[key] || null) : null;
}

function docSignalFromCodexRecord(record, title = '', procedure = '') {
  if (!record) return null;
  const t = normalize(title);
  const p = normalize(procedure);
  const actor = /third party/.test(`${t} ${p}`) || /opposition/.test(`${t} ${p}`) ? 'Third party' : 'EPO';

  switch (record.internalKey) {
    case 'GRANT_R71_3_EVENT':
      return { family: 'grant', bundle: 'Intention to grant (R71(3) EPC)', actor: 'EPO', level: 'warn', reason: 'codex grant-intended event' };
    case 'FURTHER_PROCESSING_REQUEST':
    case 'FURTHER_PROCESSING_DECISION':
      return { family: 'remedial', bundle: 'Further processing', actor: 'EPO', level: 'warn', reason: 'codex remedial event' };
    case 'NO_OPPOSITION_FILED':
      return { family: 'opposition', bundle: 'Opposition', actor: 'EPO', level: 'warn', reason: 'codex opposition-end status' };
    case 'LOSS_OF_RIGHTS_EVENT':
    case 'APPLICATION_DEEMED_WITHDRAWN':
      return { family: 'loss_of_rights', bundle: 'Loss-of-rights communication', actor: 'EPO', level: 'bad', reason: 'codex loss-of-rights event' };
    default:
      break;
  }

  if (record.phase === 'hearing') {
    return { family: 'hearing', bundle: 'Oral proceedings', actor, level: 'warn', reason: 'codex hearing-phase event' };
  }
  if (record.phase === 'opposition' || record.phase === 'opposition_end') {
    return { family: 'opposition', bundle: 'Opposition', actor, level: 'warn', reason: 'codex opposition-phase event' };
  }
  if (record.phase === 'remedial') {
    return { family: 'remedial', bundle: 'Further processing', actor: 'EPO', level: 'warn', reason: 'codex remedial-phase event' };
  }
  if (record.phase === 'loss_of_rights') {
    return { family: 'loss_of_rights', bundle: 'Loss-of-rights communication', actor: 'EPO', level: 'bad', reason: 'codex loss-of-rights phase' };
  }
  if (record.phase === 'grant') {
    return { family: 'grant', bundle: record.classification === 'deadline-bearing' ? 'Intention to grant (R71(3) EPC)' : 'Grant decision', actor: 'EPO', level: record.classification === 'deadline-bearing' ? 'warn' : 'ok', reason: 'codex grant-phase event' };
  }
  if (record.phase === 'search') {
    return { family: 'search', bundle: 'Search package', actor: 'EPO', level: 'info', reason: 'codex search-phase event' };
  }
  return null;
}

const NORMALIZED_DOC_SIGNAL_RULES = Object.freeze([
  { test: (t) => /decision to allow further processing/.test(t), signal: { family: 'remedial', bundle: 'Further processing', actor: 'EPO', level: 'warn', reason: 'further-processing decision' } },
  { test: (t) => /decision to grant a european patent/.test(t), signal: { family: 'grant', bundle: 'Grant decision', actor: 'EPO', level: 'ok', reason: 'grant decision' } },
  { test: (t) => /transmission of the certificate for a european patent pursuant to rule\s*74/.test(t), signal: { family: 'post_grant', bundle: 'Patent certificate', actor: 'EPO', level: 'ok', reason: 'rule-74 certificate' } },
  { test: (t) => /grant of extension of time limit/.test(t), signal: { family: 'remedial', bundle: 'Extension of time limit', actor: 'EPO', level: 'info', reason: 'extension of time limit' } },
  { test: (t) => /application deemed to be withdrawn.*non-entry into european phase/.test(t), signal: { family: 'loss_of_rights', bundle: 'Euro-PCT non-entry failure', actor: 'EPO', level: 'bad', reason: 'non-entry into EP phase' } },
  { test: (t) => /application deemed to be withdrawn.*translations of claims\/payment missing/.test(t), signal: { family: 'loss_of_rights', bundle: 'Grant-formalities failure', actor: 'EPO', level: 'bad', reason: 'grant formalities missing' } },
  { test: (t) => /application deemed to be withdrawn.*non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(t), signal: { family: 'loss_of_rights', bundle: 'Fees / written-opinion failure', actor: 'EPO', level: 'bad', reason: 'fees plus written-opinion failure' } },
  { test: (t) => /application deemed to be withdrawn.*non-reply to written opinion/.test(t), signal: { family: 'loss_of_rights', bundle: 'Written-opinion loss', actor: 'EPO', level: 'bad', reason: 'written opinion not answered' } },
  { test: (t) => /loss of rights|rule\s*112\(1\)/.test(t), signal: { family: 'loss_of_rights', bundle: 'Loss-of-rights communication', actor: 'EPO', level: 'bad', reason: 'rule 112 / loss-of-rights notice' } },
  { test: (t) => /document annexed to the extended european search report|extended european search report/.test(t), signal: { family: 'search', bundle: 'Extended European search package', actor: 'EPO', level: 'info', reason: 'extended search report annex' } },
  { test: (t) => /supplementary european search report/.test(t), signal: { family: 'search', bundle: 'Supplementary European search package', actor: 'EPO', level: 'info', reason: 'supplementary ESR' } },
  { test: (t) => /international preliminary report on patentability|written opinion of the isa|isr: cited documents/.test(t), signal: { family: 'search', bundle: 'International search / IPRP', actor: 'EPO', level: 'info', reason: 'IPRP / ISA packet' } },
  { test: (t) => /partial international search report|provisional opinion accompanying the partial search results/.test(t), signal: { family: 'search', bundle: 'Partial international search', actor: 'EPO', level: 'info', reason: 'partial ISR packet' } },
  { test: (t) => /communication regarding the transmission of the european search report|european search opinion|european search report|information on search strategy/.test(t), signal: { family: 'search', bundle: 'European search package', actor: 'EPO', level: 'info', reason: 'European search packet' } },
  { test: (t) => /rule\s*71\(3\)|intention to grant|text intended for grant|mention of grant/.test(t), signal: { family: 'grant', bundle: 'Intention to grant (R71(3) EPC)', actor: 'EPO', level: 'warn', reason: 'R71 / grant-intended packet' } },
  { test: (t, p) => /opposition|third party/.test(t) || /third party/.test(p), signal: { family: 'opposition', bundle: 'Opposition', actor: 'Third party', level: 'warn', reason: 'opposition / third-party filing' } },
]);

function normalizedDocSignalFromRules(title = '', procedure = '') {
  const t = normalize(title);
  const p = normalize(procedure);
  for (const rule of NORMALIZED_DOC_SIGNAL_RULES) {
    if (rule.test(t, p)) return { ...rule.signal };
  }
  return null;
}

function classifyDocSignal({ title = '', procedure = '' } = {}) {
  const codexSignal = docSignalFromCodexRecord(codexDescriptionRecord(title), title, procedure);
  if (codexSignal) return codexSignal;
  return normalizedDocSignalFromRules(title, procedure);
}

module.exports = {
  codexDescriptionRecord,
  docSignalFromCodexRecord,
  NORMALIZED_DOC_SIGNAL_RULES,
  normalizedDocSignalFromRules,
  classifyDocSignal,
};
