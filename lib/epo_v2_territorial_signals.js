const { normalize } = require('./epo_v2_utils');

function upcRegistryNoteText(upcResult = null) {
  if (!upcResult) return 'UPC registry check unavailable.';
  const status = normalize(upcResult.status || '');
  if (!status) return 'UPC registry check unavailable.';
  if (/^opted out$/i.test(status)) return 'UPC opt-out registered.';
  if (/^opt-out withdrawn$/i.test(status)) return 'UPC opt-out withdrawn.';
  if (/^no opt-out found$/i.test(status)) return 'No UPC opt-out found.';
  return status;
}

function territorialStatusLevel({ ueStatus = '', upcNote = '', notableStates = [] } = {}) {
  const ueLow = normalize(ueStatus).toLowerCase();
  const upcLow = normalize(upcNote).toLowerCase();
  if (/unitary effect registered/.test(ueLow)) return 'ok';
  if (/ue requested|request for examination was made|request/.test(ueLow) || /opt-out/.test(upcLow)) return 'warn';
  if ((notableStates || []).length) return 'warn';
  return 'info';
}

function territorialPresentationModel(ue = {}, upcResult = null, federated = {}) {
  const ueStatus = normalize(ue?.ueStatus || ue?.statusRaw || '');
  const coverageStates = normalize(ue?.memberStates || federated?.upMemberStates || '');
  const upcNote = upcRegistryNoteText(upcResult);
  const notableStates = Array.isArray(federated?.notableStates) ? federated.notableStates : [];
  const nationalStates = Array.isArray(federated?.states) ? federated.states : [];

  return {
    ueStatus,
    upcNote,
    coverageStates,
    notableStates,
    nationalStates,
    level: territorialStatusLevel({ ueStatus, upcNote, notableStates }),
  };
}

module.exports = {
  upcRegistryNoteText,
  territorialStatusLevel,
  territorialPresentationModel,
};
