function normalize(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function classifyDocSignal({ title = '', procedure = '' } = {}) {
  const t = normalize(title);
  const p = normalize(procedure);

  if (/decision to allow further processing/.test(t)) {
    return { family: 'remedial', bundle: 'Further processing', actor: 'EPO', level: 'warn', reason: 'further-processing decision' };
  }
  if (/decision to grant a european patent/.test(t)) {
    return { family: 'grant', bundle: 'Grant decision', actor: 'EPO', level: 'ok', reason: 'grant decision' };
  }
  if (/transmission of the certificate for a european patent pursuant to rule\s*74/.test(t)) {
    return { family: 'post_grant', bundle: 'Patent certificate', actor: 'EPO', level: 'ok', reason: 'rule-74 certificate' };
  }
  if (/grant of extension of time limit/.test(t)) {
    return { family: 'remedial', bundle: 'Extension of time limit', actor: 'EPO', level: 'info', reason: 'extension of time limit' };
  }
  if (/application deemed to be withdrawn.*non-entry into european phase/.test(t)) {
    return { family: 'loss_of_rights', bundle: 'Euro-PCT non-entry failure', actor: 'EPO', level: 'bad', reason: 'non-entry into EP phase' };
  }
  if (/application deemed to be withdrawn.*translations of claims\/payment missing/.test(t)) {
    return { family: 'loss_of_rights', bundle: 'Grant-formalities failure', actor: 'EPO', level: 'bad', reason: 'grant formalities missing' };
  }
  if (/application deemed to be withdrawn.*non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(t)) {
    return { family: 'loss_of_rights', bundle: 'Fees / written-opinion failure', actor: 'EPO', level: 'bad', reason: 'fees plus written-opinion failure' };
  }
  if (/application deemed to be withdrawn.*non-reply to written opinion/.test(t)) {
    return { family: 'loss_of_rights', bundle: 'Written-opinion loss', actor: 'EPO', level: 'bad', reason: 'written opinion not answered' };
  }
  if (/loss of rights|rule\s*112\(1\)/.test(t)) {
    return { family: 'loss_of_rights', bundle: 'Loss-of-rights communication', actor: 'EPO', level: 'bad', reason: 'rule 112 / loss-of-rights notice' };
  }
  if (/document annexed to the extended european search report|extended european search report/.test(t)) {
    return { family: 'search', bundle: 'Extended European search package', actor: 'EPO', level: 'info', reason: 'extended search report annex' };
  }
  if (/supplementary european search report/.test(t)) {
    return { family: 'search', bundle: 'Supplementary European search package', actor: 'EPO', level: 'info', reason: 'supplementary ESR' };
  }
  if (/international preliminary report on patentability|written opinion of the isa|isr: cited documents/.test(t)) {
    return { family: 'search', bundle: 'International search / IPRP', actor: 'EPO', level: 'info', reason: 'IPRP / ISA packet' };
  }
  if (/partial international search report|provisional opinion accompanying the partial search results/.test(t)) {
    return { family: 'search', bundle: 'Partial international search', actor: 'EPO', level: 'info', reason: 'partial ISR packet' };
  }
  if (/communication regarding the transmission of the european search report|european search opinion|european search report|information on search strategy/.test(t)) {
    return { family: 'search', bundle: 'European search package', actor: 'EPO', level: 'info', reason: 'European search packet' };
  }
  if (/rule\s*71\(3\)|intention to grant|text intended for grant|mention of grant/.test(t)) {
    return { family: 'grant', bundle: 'Intention to grant (R71(3) EPC)', actor: 'EPO', level: 'warn', reason: 'R71 / grant-intended packet' };
  }
  if (/opposition|third party/.test(t) || /third party/.test(p)) {
    return { family: 'opposition', bundle: 'Opposition', actor: 'Third party', level: 'warn', reason: 'opposition / third-party filing' };
  }
  return null;
}

module.exports = { classifyDocSignal };
