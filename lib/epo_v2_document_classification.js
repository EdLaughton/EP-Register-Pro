const { normalize } = require('./epo_v2_utils');
const { classifyDocSignal } = require('./epo_v2_doc_signals');

function parseApplicationType(mainData = {}) {
  const appNo = mainData.appNo || '';
  const priorities = Array.isArray(mainData.priorities) ? mainData.priorities : [];
  const internationalAppNo = normalize(mainData.internationalAppNo || '').toUpperCase();
  const statusRaw = normalize(mainData.statusRaw || '');

  const hasExplicitPctMarker =
    /\bPCT\/[A-Z]{2}\d{4}\/\d{5,}\b/i.test(internationalAppNo)
    || /\bWO\d{4}[A-Z]{2}\d{3,}\b/i.test(internationalAppNo)
    || /\b(?:E\/PCT|EURO-?PCT|regional phase)\b/i.test(statusRaw);

  if (hasExplicitPctMarker || priorities.some((priority) => /^WO\d{4}[A-Z]{2}\d{3,}$/i.test(String(priority?.no || '')))) {
    return 'E/PCT regional phase';
  }
  if (mainData.isDivisional || mainData.parentCase) return 'Divisional';
  if (priorities.length > 0) return 'EP convention filing';
  if (/^EP\d+$/i.test(appNo)) return 'EP direct first filing';
  return 'Unknown';
}

function classifyDocument(title, procedure = '') {
  const t = String(title || '').toLowerCase();
  const p = String(procedure || '').toLowerCase();

  const isSearchResponseContext =
    /search\s*\/\s*examination|search\s*and\s*examination|search report|search opinion/.test(p)
    || /after receipt of \(?(?:european\)? )?search report|before examination/.test(t);

  const isGrantContext = /rule\s*71\(3\)|intention to grant|text intended for grant|text proposed for grant|proposed for grant/.test(`${t} ${p}`);
  const isGrantCommunicationTitle = /text intended for grant|communication about intention to grant|annex to the communication about intention to grant|intention to grant/.test(t);
  const isGrantResponse = isGrantContext
    && !isGrantCommunicationTitle
    && /amend|correction|request|claims|description|translation|approval|text proposed for grant/.test(t);

  const normalizedSignal = classifyDocSignal({ title, procedure });
  if (normalizedSignal) {
    if (normalizedSignal.family === 'search') {
      return { bundle: 'Search package', level: normalizedSignal.level, actor: normalizedSignal.actor };
    }
    if (normalizedSignal.bundle === 'Intention to grant (R71(3) EPC)') {
      return { bundle: 'Grant package', level: normalizedSignal.level, actor: normalizedSignal.actor };
    }
    return { bundle: normalizedSignal.bundle, level: normalizedSignal.level, actor: normalizedSignal.actor };
  }

  const isLossOfRights = /deemed to be withdrawn|application deemed to be withdrawn|loss of rights|communication under rule\s*112\(1\)|rule\s*112\(1\)|noting of loss of rights|application refused|application rejected/.test(`${t} ${p}`);
  if (isLossOfRights) {
    return { bundle: 'Examination', level: 'bad', actor: 'EPO' };
  }

  if (/by applicant|amendment by applicant|filed by applicant|from applicant/.test(p)) {
    if (isGrantResponse) {
      return { bundle: 'Grant package', level: 'warn', actor: 'Applicant' };
    }
    if (isSearchResponseContext && !isGrantContext && /amend|claims|description|letter|annotations|subsequently filed items/.test(t)) {
      return { bundle: 'Response to search', level: 'info', actor: 'Applicant' };
    }
    if (/request for grant|description|claims|drawings|designation of inventor|priority document|annex/.test(t)) {
      return { bundle: 'Filing package', level: 'info', actor: 'Applicant' };
    }
    return { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
  }

  if (/acknowledgement of receipt|receipt of electronic submission|auto-acknowledgement/.test(t) || /acknowledgement/.test(p)) {
    return { bundle: 'Other', level: 'info', actor: 'System' };
  }

  if (isGrantResponse) {
    return { bundle: 'Grant package', level: 'warn', actor: 'Applicant' };
  }

  if (isSearchResponseContext && !isGrantContext && /amend|claims|description|letter accompanying subsequently filed items|annotations|amendments received before examination/.test(t)) {
    return { bundle: 'Response to search', level: 'info', actor: 'Applicant' };
  }

  if (/amended claims filed|amendment by applicant|claims and\/or description|filed after receipt/i.test(t)) {
    return isGrantContext
      ? { bundle: 'Grant package', level: 'warn', actor: 'Applicant' }
      : { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
  }

  if (/search report|search opinion|written opinion|search strategy|esr/.test(t)) return { bundle: 'Search package', level: 'info', actor: 'EPO' };
  if (/rule\s*71\(3\)|intention to grant|text intended for grant|mention of grant/.test(t)) return { bundle: 'Grant package', level: 'warn', actor: 'EPO' };
  if (/annex to (?:the )?communication|communication annex|annex.*examining division/.test(t)) {
    return /intention to grant|rule\s*71\(3\)/.test(t)
      ? { bundle: 'Grant package', level: 'warn', actor: 'EPO' }
      : { bundle: 'Examination', level: 'info', actor: 'EPO' };
  }
  if (/article\s*94\(3\)|art\.\s*94\(3\)|communication from the examining|examining division has become responsible/.test(t)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
  if (/renewal|annual fee/.test(t)) return { bundle: 'Renewal', level: 'ok', actor: 'Applicant' };
  if (/request for grant|description|claims|drawings|designation of inventor|priority document/.test(t)) return { bundle: 'Filing package', level: 'info', actor: 'Applicant' };
  if (/reply|response|arguments|observations|letter|filed by applicant|submission|request/.test(t)) return { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
  if (/opposition|third party/.test(t) || /third party/.test(p)) return { bundle: 'Opposition', level: 'warn', actor: 'Third party' };

  if (/examining division|epo|office/.test(p)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
  return { bundle: 'Other', level: 'info', actor: 'Other' };
}

function refineDocumentClassification(title = '', procedure = '', cls = {}) {
  const t = normalize(title).toLowerCase();
  const p = normalize(procedure).toLowerCase();
  const merged = `${t} ${p}`;
  if (/reminder to observe due time limit|communication concerning the reminder|invitation pursuant to rule\s*45|communication under rule\s*112\(1\)|loss of rights|notification of forthcoming publication|transmission of the certificate|mention of grant|decision to grant|communication to designated inventor|search started|examining division becomes responsible|examination started|publication of the mention of the grant|grant of a european patent/.test(merged)) {
    return {
      bundle: /loss of rights|rule\s*112\(1\)|deemed to be withdrawn/.test(merged) ? 'Examination' : (cls.bundle || 'Other'),
      level: /loss of rights|rule\s*112\(1\)|deemed to be withdrawn/.test(merged) ? 'bad' : (cls.level || 'info'),
      actor: 'EPO',
    };
  }
  return cls;
}

module.exports = {
  parseApplicationType,
  classifyDocument,
  refineDocumentClassification,
};
