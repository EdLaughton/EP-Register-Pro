const { normalize, text } = require('./epo_v2_doclist_parser');

function bodyText(doc) {
  return normalize(doc?.body?.innerText || doc?.body?.textContent || '');
}

function rowLabelValuePairs(row) {
  const pairs = {};
  let currentKey = '';
  for (const cell of row.querySelectorAll('th,td')) {
    const raw = normalize(text(cell));
    const tag = String(cell.tagName || '').toUpperCase();
    const cls = String(cell.className || '').toLowerCase();
    const isLabel = tag === 'TH' || /\bth\b/.test(cls) || cls.includes('header');
    if (isLabel) {
      currentKey = raw.replace(/:\s*$/, '').trim();
      if (currentKey && !(currentKey in pairs)) pairs[currentKey] = '';
      continue;
    }
    if (!currentKey) continue;
    if (raw) pairs[currentKey] = pairs[currentKey] ? `${pairs[currentKey]} ${raw}`.trim() : raw;
    currentKey = '';
  }
  return pairs;
}

function fieldByLabel(doc, regexes) {
  for (const row of doc.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('th,td')].map(text);
    if (cells.length < 2) continue;
    for (let i = 0; i < cells.length - 1; i++) {
      if (!regexes.some((re) => re.test(cells[i] || ''))) continue;
      const value = cells.slice(i + 1).filter(Boolean).join('\n').trim();
      if (value) return value;
    }
  }
  for (const dl of doc.querySelectorAll('dl')) {
    const children = [...dl.children];
    for (let i = 0; i < children.length; i++) {
      if (children[i]?.tagName !== 'DT') continue;
      if (!regexes.some((re) => re.test(text(children[i])))) continue;
      const values = [];
      for (let j = i + 1; j < children.length && children[j]?.tagName !== 'DT'; j++) {
        if (children[j]?.tagName === 'DD') values.push(text(children[j]));
      }
      const value = values.filter(Boolean).join('\n').trim();
      if (value) return value;
    }
  }
  return '';
}

function fieldTailByLabel(doc, regexes) {
  for (const row of doc.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('th,td')];
    if (cells.length < 2) continue;
    for (let i = 0; i < cells.length - 1; i++) {
      if (!regexes.some((re) => re.test(text(cells[i]) || ''))) continue;
      const value = text(cells[cells.length - 1]);
      if (value) return value;
    }
  }
  return '';
}

function stripBulletinRef(value = '') {
  return normalize(String(value || '').replace(/\s*\[\d{4}\/\d{2}\]\s*/g, ' '));
}

function cleanMemberStatesValue(value = '') {
  return stripBulletinRef(String(value || '').replace(/^\s*\d{2}\.\d{2}\.\d{4}\s*/i, ' '));
}

function cleanUeStatusValue(value = '') {
  return normalize(String(value || '')
    .replace(/\bStatus updated on\b\s*\d{2}\.\d{2}\.\d{4}\b/gi, ' ')
    .replace(/\bDatabase last updated on\b\s*\d{2}\.\d{2}\.\d{4}\b/gi, ' '));
}

function parseUeFromDocument(doc) {
  const pageText = bodyText(doc);
  const status = cleanUeStatusValue(fieldByLabel(doc, [/^Status$/i, /^Procedural status$/i]));
  const renewalPaidYears = [...new Set([...doc.querySelectorAll('tr')]
    .map((row) => {
      const match = normalize(text(row)).match(/renewal fee unitary effect year\s*0*(\d{1,2})\b/i);
      return match ? Number(match[1] || 0) : 0;
    })
    .filter(Boolean))].sort((a, b) => b - a);
  let ueStatus = '';
  let upcOptOut = '';

  if (/unitary effect registered|registered as a unitary patent/i.test(pageText)) ueStatus = 'Unitary effect registered';
  else if (/request.*unitary effect|unitary effect.*request/i.test(pageText)) ueStatus = 'UE requested';
  else if (status) ueStatus = status;

  if (/opt[\s-]*out.*registered|opted[\s-]*out/i.test(pageText)) upcOptOut = 'Opted out';
  else if (/opt[\s-]*out.*withdrawn|opt[\s-]*out.*removed/i.test(pageText)) upcOptOut = 'Opt-out withdrawn';
  else if (/no\s*opt[\s-]*out|not\s*opted/i.test(pageText)) upcOptOut = 'No opt-out';

  const memberStateLabels = [/^Member States? covered by Unitary/i, /^Participating member states?$/i];
  const memberStates = cleanMemberStatesValue(
    fieldTailByLabel(doc, memberStateLabels)
    || fieldByLabel(doc, memberStateLabels)
  );

  return {
    statusRaw: status,
    ueStatus,
    upcOptOut,
    memberStates,
    renewalPaidYears,
    highestRenewalPaidYear: renewalPaidYears[0] || null,
    text: pageText,
  };
}

function parseFederatedFromDocument(doc, caseNo = '') {
  const states = [];
  const summary = {
    appNo: caseNo,
    fullPublicationNo: '',
    applicantProprietor: '',
    status: '',
    upMemberStates: '',
    invalidationDate: '',
    renewalFeesPaidUntil: '',
    recordUpdated: '',
  };

  const captureSummary = (pairs) => {
    if (!summary.appNo && pairs['EP application number']) summary.appNo = pairs['EP application number'];
    if (!summary.fullPublicationNo && pairs['Full publication number']) summary.fullPublicationNo = pairs['Full publication number'];
    if (!summary.applicantProprietor && pairs['Applicant / proprietor']) summary.applicantProprietor = pairs['Applicant / proprietor'];
    if (!summary.status && pairs.Status) summary.status = pairs.Status;
    if (!summary.upMemberStates && pairs['Member States covered by Unitary Patent Protection']) summary.upMemberStates = pairs['Member States covered by Unitary Patent Protection'];
    if (!summary.invalidationDate && pairs['Invalidation date']) summary.invalidationDate = pairs['Invalidation date'];
    if (!summary.renewalFeesPaidUntil && pairs['Renewal fees paid until']) summary.renewalFeesPaidUntil = pairs['Renewal fees paid until'];
    if (!summary.recordUpdated && pairs['Record last updated']) summary.recordUpdated = pairs['Record last updated'];
  };

  for (const row of doc.querySelectorAll('tr')) {
    const pairs = rowLabelValuePairs(row);
    if (Object.keys(pairs).length < 1) continue;
    captureSummary(pairs);
    if (!pairs.State) continue;
    states.push({
      state: pairs.State,
      nationalPublicationNo: pairs['National publication number'] || '',
      publicationDate: pairs['Publication date'] || '',
      upMemberStates: pairs['Member States covered by Unitary Patent Protection'] || '',
      invalidationDate: pairs['Invalidation date'] || '',
      renewalFeesPaidUntil: pairs['Renewal fees paid until'] || '',
      recordUpdated: pairs['Record last updated'] || '',
      notInForceSince: pairs['Not in force since'] || '',
      status: pairs.Status || summary.status || '',
    });
  }

  return {
    ...summary,
    states,
    notableStates: states.filter((state) => normalize(state.notInForceSince || '') || /lapse|revok|terminated|not in force/i.test(`${state.status || ''} ${state.nationalPublicationNo || ''}`)),
  };
}

module.exports = {
  bodyText,
  rowLabelValuePairs,
  fieldByLabel,
  parseUeFromDocument,
  parseFederatedFromDocument,
};
