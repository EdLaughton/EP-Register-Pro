const { normalize } = require('./epo_v2_doclist_parser');
const { postureLossLabel, postureRecoveryLabel } = require('./epo_v2_posture_signals');
const { compactOverviewTitle } = require('./epo_v2_timeline_signals');

function formatDaysHuman(days) {
  const value = Math.abs(Number(days || 0));
  const rounded = Number.isFinite(value) ? Math.round(value) : 0;
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

function resolvedOverviewStatus(mainSourceStatus, statusSummary, posture) {
  if (mainSourceStatus === 'notfound') return { simple: 'Not found', level: 'bad' };
  if (mainSourceStatus === 'empty') return { simple: 'No main data', level: 'warn' };
  return {
    simple: posture?.currentLabel || statusSummary?.simple || 'Unknown',
    level: posture?.currentLevel || statusSummary?.level || 'warn',
  };
}

function isMonitoringDeadline(deadline = {}) {
  const label = normalize(deadline?.label || '').toLowerCase();
  return /opposition period/.test(label) || /third-party monitor/.test(label);
}

function isReviewDeadline(deadline = {}) {
  if (!deadline || deadline.reference || deadline.anchorOnly) return false;
  if (deadline.reviewOnly) return true;
  if (!deadline.date || Number.isNaN(deadline.date?.getTime?.())) return true;
  return String(deadline.confidence || '').toLowerCase() === 'low';
}

function deadlinePresentationBuckets(deadlines = [], currentClosedPosture = false) {
  const buckets = { active: [], monitoring: [], review: [], historical: [] };
  for (const deadline of (deadlines || [])) {
    if (deadline?.reference || deadline?.anchorOnly) continue;
    if (currentClosedPosture) {
      buckets.historical.push(deadline);
      continue;
    }
    if (deadline?.resolved || deadline?.superseded) {
      buckets.historical.push(deadline);
      continue;
    }
    if (isMonitoringDeadline(deadline)) {
      buckets.monitoring.push(deadline);
      continue;
    }
    if (isReviewDeadline(deadline)) {
      buckets.review.push(deadline);
      continue;
    }
    buckets.active.push(deadline);
  }
  for (const key of Object.keys(buckets)) buckets[key].sort((a, b) => (a?.date?.getTime?.() || 0) - (b?.date?.getTime?.() || 0));
  return buckets;
}

function selectNextDeadline(deadlines = [], currentClosedPosture = false, now = new Date()) {
  const actionable = deadlinePresentationBuckets(deadlines, currentClosedPosture).active;
  if (!actionable.length) return null;
  const upcoming = actionable.find((deadline) => deadline.date > now);
  if (upcoming) return upcoming;
  if (currentClosedPosture) return null;
  return actionable[0] || null;
}

function activeDeadlineNoteText(deadlines = [], currentClosedPosture = false, posture = null) {
  const buckets = deadlinePresentationBuckets(deadlines, currentClosedPosture);
  if (buckets.active.length && currentClosedPosture) {
    return 'No active procedural deadline detected on the current withdrawn/closed posture; remaining clocks are historical, appellate, or low-confidence.';
  }
  if (buckets.active.length) return '';
  if (buckets.monitoring.length) {
    return 'No active applicant/EPO deadline detected; remaining clocks are third-party monitoring windows.';
  }
  if (buckets.review.length) {
    return `No auto-remindable deadline detected; ${buckets.review.length} low-confidence or manual-review item${buckets.review.length === 1 ? '' : 's'} remain.`;
  }
  if (buckets.historical.some((deadline) => deadline.superseded) && currentClosedPosture) {
    return 'No active procedural deadline detected; later loss-of-rights events superseded earlier response periods.';
  }
  if (buckets.historical.some((deadline) => deadline.resolved)) {
    return posture?.recovered
      ? 'No active procedural deadline detected; earlier response periods appear answered and the case later recovered from an adverse posture.'
      : 'No active procedural deadline detected; earlier response periods appear already answered.';
  }
  return currentClosedPosture ? 'No active procedural deadline detected on the current withdrawn/closed posture.' : '';
}

function capitalize(text = '') {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : '';
}

function recoveryActionModel(posture = {}, waitingOn = '', waitingDays = null, latestApplicant = null) {
  const loss = posture?.latestLoss || null;
  const recovery = posture?.latestRecoveryDecision || posture?.latestRecovery || null;
  const recoveryRequest = posture?.latestRecoveryRequest || null;
  const grant = posture?.latestGrantDecision || null;
  const lossText = loss ? capitalize(postureLossLabel(loss)) : 'Adverse posture';
  const recoveryText = recovery
    ? (compactOverviewTitle(recovery.title || recovery.detail || '') || capitalize(postureRecoveryLabel(recovery)))
    : '';
  const grantText = grant ? (compactOverviewTitle(grant.title || grant.detail || '') || 'Grant decision') : '';
  const pendingApplicant = recoveryRequest || latestApplicant || null;
  const applicantText = pendingApplicant
    ? `${pendingApplicant.dateStr || '—'} · ${compactOverviewTitle(pendingApplicant.title || '')}`
    : '';

  if (posture?.recovered && recovery) {
    const summaryBits = [
      loss?.dateStr ? `${loss.dateStr} · ${lossText}` : lossText,
      recovery?.dateStr ? `${recovery.dateStr} · ${recoveryText}` : recoveryText,
      posture?.recoveredBeforeGrant && grant?.dateStr ? `${grant.dateStr} · ${grantText}` : '',
    ].filter(Boolean);
    return {
      label: 'Recovery path',
      badge: posture.recoveredBeforeGrant ? 'Recovered before grant' : 'Recovered',
      level: 'ok',
      summary: summaryBits.join(' → '),
      note: posture.recoveredBeforeGrant
        ? 'Earlier adverse posture was cured before the file returned to grant.'
        : 'Earlier adverse posture was cured and the file later returned to the active track.',
    };
  }

  if (waitingOn === 'EPO recovery outcome') {
    const summaryBits = [
      loss?.dateStr ? `${loss.dateStr} · ${lossText}` : lossText,
      applicantText,
    ].filter(Boolean);
    return {
      label: 'Recovery path',
      badge: 'Recovery pending',
      level: 'warn',
      summary: summaryBits.join(' → '),
      note: `${recoveryRequest ? 'Recovery has been requested' : 'Applicant appears to have responded'} after the adverse posture; monitor the EPO recovery outcome${waitingDays != null ? ` (${formatDaysHuman(waitingDays)} since applicant reply)` : ''}.`,
    };
  }

  if (posture?.currentClosed && loss) {
    return {
      label: 'Recovery path',
      badge: 'Recovery options',
      level: 'bad',
      summary: loss?.dateStr ? `${loss.dateStr} · ${lossText}` : lossText,
      note: 'Adverse posture detected. Check further processing first; if unavailable, consider Rule 136 re-establishment.',
    };
  }

  return null;
}

function certaintyLabel(baseLabel, confidence = '') {
  const low = String(confidence || '').toLowerCase();
  if (!low || low === 'high') return baseLabel;
  return low === 'medium' ? `Likely ${baseLabel.toLowerCase()}` : `Estimated ${baseLabel.toLowerCase()}`;
}

function overviewPresentationHints({ mainSourceStatus = '', posture = null, nextDeadline = null, renewal = null } = {}) {
  const postureConfidence = String(mainSourceStatus || '').toLowerCase() === 'ok' && !posture?.partial ? 'high' : 'medium';
  return {
    postureLabel: certaintyLabel('Current posture', postureConfidence),
    waitingLabel: certaintyLabel('Waiting on', nextDeadline?.confidence || postureConfidence),
    nextDeadlineLabel: certaintyLabel('Next deadline', nextDeadline?.confidence || ''),
    renewalLabel: certaintyLabel('Renewal status', renewal?.confidence || ''),
    renewalNextFeeLabel: certaintyLabel('Next renewal fee', renewal?.confidence || ''),
  };
}

function buildActionableOverviewState({ mainSourceStatus = '', statusSummary = null, posture = null, deadlines = [], waitingOn = '', waitingDays = null, latestApplicant = null, renewal = null } = {}) {
  const nextDeadline = selectNextDeadline(deadlines, !!posture?.currentClosed);
  return {
    status: resolvedOverviewStatus(mainSourceStatus, statusSummary, posture),
    deadlineBuckets: deadlinePresentationBuckets(deadlines, !!posture?.currentClosed),
    nextDeadline,
    nextDeadlineNote: activeDeadlineNoteText(deadlines, !!posture?.currentClosed, posture),
    recoveryAction: recoveryActionModel(posture, waitingOn, waitingDays, latestApplicant),
    presentationHints: overviewPresentationHints({ mainSourceStatus, posture, nextDeadline, renewal }),
  };
}

module.exports = {
  formatDaysHuman,
  resolvedOverviewStatus,
  isMonitoringDeadline,
  deadlinePresentationBuckets,
  selectNextDeadline,
  activeDeadlineNoteText,
  recoveryActionModel,
  certaintyLabel,
  overviewPresentationHints,
  buildActionableOverviewState,
};
