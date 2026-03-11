const { classifyDocSignal } = require('./epo_v2_doc_signals');

const PACKET_SIGNAL_PRECEDENCE = Object.freeze([
  'Euro-PCT non-entry failure',
  'Grant-formalities failure',
  'Fees / written-opinion failure',
  'Written-opinion loss',
  'Loss-of-rights communication',
  'Further processing',
  'Grant decision',
  'Patent certificate',
  'Extension of time limit',
  'Extended European search package',
  'Supplementary European search package',
  'International search / IPRP',
  'Partial international search',
  'European search package',
  'Intention to grant (R71(3) EPC)',
  'Opposition',
  'Oral proceedings',
  'Search package',
]);

const STANDALONE_PACKET_BUNDLES = new Set([
  'Further processing',
  'Grant decision',
  'Patent certificate',
  'Extension of time limit',
  'Euro-PCT non-entry failure',
  'Grant-formalities failure',
  'Fees / written-opinion failure',
  'Written-opinion loss',
  'Loss-of-rights communication',
  'Opposition',
  'Oral proceedings',
]);

function packetSignalBundle(signal) {
  return signal?.bundle || '';
}

function standalonePacketBundle(signal) {
  const bundle = packetSignalBundle(signal);
  return STANDALONE_PACKET_BUNDLES.has(bundle) ? bundle : '';
}

function classifyPacketSignal(models = []) {
  const signals = (models || [])
    .map((model) => classifyDocSignal({ title: model?.title || '', procedure: model?.procedure || '' }))
    .filter(Boolean);

  if (!signals.length) return null;

  for (const bundle of PACKET_SIGNAL_PRECEDENCE) {
    const match = signals.find((signal) => signal.bundle === bundle);
    if (match) return { ...match, source: 'normalized-packet-signal' };
  }

  return { ...signals[0], source: 'normalized-packet-signal' };
}

module.exports = {
  PACKET_SIGNAL_PRECEDENCE,
  STANDALONE_PACKET_BUNDLES,
  packetSignalBundle,
  standalonePacketBundle,
  classifyPacketSignal,
};
