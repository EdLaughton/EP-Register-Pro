function normalize(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function dedupeCaseInsensitive(bits = []) {
  return bits
    .filter(Boolean)
    .filter((bit, idx, arr) => arr.findIndex((other) => other.toLowerCase() === bit.toLowerCase()) === idx);
}

const TIMELINE_LEVEL_RULES = Object.freeze([
  {
    level: 'bad',
    test: (low) => /deemed to be withdrawn|application deemed to be withdrawn|loss of rights|rule\s*112\(1\)|application refused|application rejected|revoked|revocation|lapsed|not maintained|request for re-establishment.*rejected|rights restored refused|withdrawn by applicant|deemed withdrawn/.test(low),
  },
  {
    level: 'warn',
    test: (low) => /deadline|time limit|final date|summons to oral proceedings|rule\s*116|article\s*94\(3\)|art\.?\s*94\(3\)|rule\s*71\(3\)|intention to grant|communication from the examining|communication under|opposition|third party observations|request for re-establishment|further processing/.test(low),
  },
  {
    level: 'ok',
    test: (low) => /mention of grant|patent granted|grant decision|fee paid|renewal paid|annual fee paid|validation|registered|recorded/.test(low),
  },
]);

function classifyTimelineImportance(title, detail = '', source = '', actor = 'Other', baseLevel = 'info') {
  const base = ['bad', 'warn', 'ok', 'info'].includes(baseLevel) ? baseLevel : 'info';
  const low = normalize(`${title || ''}\n${detail || ''}\n${source || ''}\n${actor || ''}`).toLowerCase();
  for (const rule of TIMELINE_LEVEL_RULES) {
    if (rule.test(low)) return rule.level;
    if (base === rule.level) return rule.level;
  }
  return 'info';
}

const PACKET_EXPLANATION_MAP = Object.freeze({
  'international search / iprp': 'ISA/IPRP packet from the international phase.',
  'partial international search': 'Partial international search packet with the provisional opinion/search results.',
  'european search package': 'European search report packet, including ESR opinion/strategy where present.',
  'extended european search package': 'European search packet including an extended-ESR annex.',
  'supplementary european search package': 'Supplementary European search packet for Euro-PCT regional phase entry.',
  'intention to grant (r71(3) epc)': 'Rule 71(3) grant-intention packet, including text-for-grant documents.',
  'response to intention to grant': 'Applicant response packet to the Rule 71(3) / grant-intention communication.',
  'grant decision': 'Formal grant decision from the EPO.',
  'further processing': 'Recovery packet showing further processing after a missed time limit.',
  'euro-pct non-entry failure': 'Loss-of-rights packet showing failure to complete Euro-PCT entry acts in time.',
  'grant-formalities failure': 'Loss-of-rights packet caused by missing grant-formality acts or payments.',
  'fees / written-opinion failure': 'Loss-of-rights packet caused by fee non-payment and/or no reply to the written opinion.',
  'written-opinion loss': 'Loss-of-rights packet caused by no reply to the written opinion.',
});

function docPacketExplanation(label = '') {
  return PACKET_EXPLANATION_MAP[normalize(label).toLowerCase()] || '';
}

function timelineSubtitle(item = {}) {
  const detailBits = String(item.detail || '')
    .split(/\s*(?:·|\n)+\s*/)
    .map((bit) => normalize(bit))
    .filter(Boolean);
  const actor = normalize(item.actor || '');
  const explanation = normalize(item.explanation || '');
  return dedupeCaseInsensitive([...detailBits, explanation, normalize(item.source || ''), actor && actor !== 'Other' ? actor : '']).join(' · ');
}

function shouldAppendSingleRunLabel(itemDetail = '', groupLabel = '') {
  const detail = normalize(itemDetail).toLowerCase();
  const label = normalize(groupLabel).toLowerCase();
  if (!label) return false;
  if (!detail) return true;
  if (detail.includes(label)) return false;
  if (/^(examination|other|formalities \/ other)$/i.test(groupLabel)) return false;
  return true;
}

const COMPACT_TITLE_EXACT_MAP = new Map([
  ['Text intended for grant (version for approval)', 'Grant text for approval'],
  ['Text intended for grant (clean copy)', 'Grant text (clean copy)'],
  ['Communication about intention to grant a European patent', 'Intention to grant'],
  ['Annex to the communication about intention to grant a European patent', 'Grant communication annex'],
  ['Bibliographic data of the European patent application', 'Bibliographic data'],
  ['Request for correction/amendment of the text proposed for grant sent from 01.04.2012', 'Grant text correction request'],
  ['Reminder period for payment of examination fee/designation fee and correction of deficiencies in Written Opinion/amendment', 'Exam / designation fee reminder'],
  ['Communication regarding the transmission of the European search report', 'Search report transmission'],
  ['Amendments received before examination', 'Amendments before examination'],
]);

const COMPACT_TITLE_REPLACEMENTS = Object.freeze([
  [/\s+a European patent$/i, ''],
  [/^New entry:\s*/i, ''],
  [/^Deletion\s+-\s*/i, ''],
  [/\s+sent from 01\.04\.2012$/i, ''],
]);

function compactOverviewTitle(title = '') {
  const normalized = normalize(title);
  if (!normalized) return '—';
  if (COMPACT_TITLE_EXACT_MAP.has(normalized)) return COMPACT_TITLE_EXACT_MAP.get(normalized);
  return COMPACT_TITLE_REPLACEMENTS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), normalized).trim();
}

module.exports = {
  TIMELINE_LEVEL_RULES,
  PACKET_EXPLANATION_MAP,
  COMPACT_TITLE_EXACT_MAP,
  COMPACT_TITLE_REPLACEMENTS,
  classifyTimelineImportance,
  docPacketExplanation,
  timelineSubtitle,
  shouldAppendSingleRunLabel,
  compactOverviewTitle,
};
