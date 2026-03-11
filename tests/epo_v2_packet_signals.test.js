const assert = require('assert');
const {
  PACKET_SIGNAL_PRECEDENCE,
  STANDALONE_PACKET_BUNDLES,
  packetSignalBundle,
  standalonePacketBundle,
  classifyPacketSignal,
} = require('../lib/epo_v2_packet_signals');

assert(PACKET_SIGNAL_PRECEDENCE.includes('Extended European search package'), 'packet-signal core should expose packet precedence data explicitly');
assert(STANDALONE_PACKET_BUNDLES.has('Further processing'), 'packet-signal core should expose the standalone packet bundle allowlist explicitly');
assert.strictEqual(packetSignalBundle({ bundle: 'Further processing' }), 'Further processing', 'packet-signal core should expose bundle extraction helper');
assert.strictEqual(standalonePacketBundle({ bundle: 'Further processing' }), 'Further processing', 'packet-signal core should preserve standalone packet bundles');
assert.strictEqual(standalonePacketBundle({ bundle: 'European search package' }), '', 'packet-signal core should not treat grouped search packets as standalone singleton bundles');

assert.strictEqual(classifyPacketSignal([
  { title: 'Communication regarding the transmission of the European search report' },
  { title: 'Document annexed to the Extended European Search Report' },
  { title: 'European search opinion' },
]).bundle, 'Extended European search package', 'packet-signal core should prefer extended-ESR specificity over generic search labels');

assert.strictEqual(classifyPacketSignal([
  { title: 'International preliminary report on patentability' },
  { title: 'Written opinion of the ISA' },
]).bundle, 'International search / IPRP', 'packet-signal core should recognize IPRP/ISA packets');

assert.strictEqual(classifyPacketSignal([
  { title: 'Decision to allow further processing' },
  { title: 'Request for further processing' },
]).bundle, 'Further processing', 'packet-signal core should group remedial request/decision packets under Further processing');

assert.strictEqual(classifyPacketSignal([
  { title: 'Communication about intention to grant a European patent' },
  { title: 'Text intended for grant (clean copy)' },
  { title: 'Intention to grant (signatures)' },
]).bundle, 'Intention to grant (R71(3) EPC)', 'packet-signal core should recognize R71 grant-intended packets');

assert.strictEqual(classifyPacketSignal([
  { title: 'Application deemed to be withdrawn (non-payment of examination fee/designation fee/non-reply to Written Opinion)' },
  { title: 'Loss of rights communication pursuant to Rule 112(1) EPC' },
]).bundle, 'Fees / written-opinion failure', 'packet-signal core should prefer the most specific loss-of-rights explanation available in the packet');

console.log('epo_v2_packet_signals.test.js passed');
