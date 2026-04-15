import type { CrawlLane, PriceRecord, SourceAccessStatus, SourceAttempt } from "@artbot/shared-types";

export interface LaneOutcome {
  lane: CrawlLane;
  attempt: SourceAttempt;
  record: PriceRecord | null;
}

export interface LaneMergeResult {
  outcome: LaneOutcome;
  overwritePrevented: boolean;
}

type AttemptWithNotes = SourceAttempt & { notes?: string[] };
type RecordWithNotes = PriceRecord & { notes?: string[] };

function cloneAttempt(attempt: SourceAttempt): SourceAttempt {
  return {
    ...attempt,
    extracted_fields: { ...(attempt.extracted_fields ?? {}) }
  };
}

function cloneRecord(record: PriceRecord): PriceRecord {
  return {
    ...record,
    notes: [...(record.notes ?? [])]
  };
}

function cloneOutcome(outcome: LaneOutcome): LaneOutcome {
  return {
    lane: outcome.lane,
    attempt: cloneAttempt(outcome.attempt),
    record: outcome.record ? cloneRecord(outcome.record) : null
  };
}

function isAccepted(attempt: SourceAttempt): boolean {
  return Boolean(attempt.accepted_for_valuation || attempt.accepted_for_evidence || attempt.accepted);
}

function isBlockedOrAuthAttempt(attempt: SourceAttempt): boolean {
  return (
    attempt.source_access_status === "blocked"
    || attempt.source_access_status === "auth_required"
    || attempt.acceptance_reason === "blocked_access"
  );
}

function laneBonus(lane: CrawlLane): number {
  switch (lane) {
    case "deterministic":
      return 8;
    case "cheap_fetch":
      return 6;
    case "crawlee":
      return 4;
    case "browser":
      return 2;
    default:
      return 0;
  }
}

function confidenceScore(outcome: LaneOutcome): number {
  const score = outcome.record?.overall_confidence ?? outcome.attempt.confidence_score ?? 0;
  return Math.round(Math.max(0, Math.min(1, score)) * 20);
}

function acceptanceScore(outcome: LaneOutcome): number {
  if (outcome.attempt.accepted_for_valuation) {
    return 100;
  }
  if (outcome.attempt.accepted_for_evidence || outcome.attempt.accepted) {
    return 60;
  }
  return 0;
}

function outcomeRank(outcome: LaneOutcome): number {
  return acceptanceScore(outcome) + laneBonus(outcome.lane) + confidenceScore(outcome);
}

function verificationNote(status: SourceAccessStatus): string {
  return `verification_${status}`;
}

function mergeVerificationNotes<T extends { notes?: string[] }>(target: T | null, status: SourceAccessStatus): T | null {
  if (!target) {
    return target;
  }
  const note = verificationNote(status);
  const notes = target.notes ?? [];
  if (notes.includes(note)) {
    return target;
  }
  return {
    ...target,
    notes: [...notes, note]
  };
}

function preserveAttemptArtifacts(current: SourceAttempt, next: SourceAttempt): SourceAttempt {
  return {
    ...current,
    screenshot_path: current.screenshot_path ?? next.screenshot_path,
    pre_auth_screenshot_path: current.pre_auth_screenshot_path ?? next.pre_auth_screenshot_path,
    post_auth_screenshot_path: current.post_auth_screenshot_path ?? next.post_auth_screenshot_path,
    raw_snapshot_path: current.raw_snapshot_path ?? next.raw_snapshot_path,
    trace_path: current.trace_path ?? next.trace_path,
    har_path: current.har_path ?? next.har_path
  };
}

function withOverwritePreserved(current: LaneOutcome, next: LaneOutcome): LaneOutcome {
  const markedAttempt = preserveAttemptArtifacts(current.attempt, next.attempt);
  const nextStatus = next.attempt.source_access_status;
  const attemptWithNotes = mergeVerificationNotes(markedAttempt as AttemptWithNotes, nextStatus) as AttemptWithNotes;
  const recordWithNotes = mergeVerificationNotes(current.record as RecordWithNotes, nextStatus) as PriceRecord | null;

  return {
    lane: current.lane,
    attempt: {
      ...attemptWithNotes,
      extracted_fields: {
        ...(attemptWithNotes.extracted_fields ?? {}),
        browser_overwrite_prevented: true
      }
    },
    record: recordWithNotes
  };
}

export function captureLaneOutcome(lane: CrawlLane, attempt: SourceAttempt, record: PriceRecord | null): LaneOutcome {
  return cloneOutcome({
    lane,
    attempt,
    record
  });
}

export function mergeLaneOutcome(current: LaneOutcome | null, next: LaneOutcome): LaneMergeResult {
  const nextOutcome = cloneOutcome(next);
  if (!current) {
    return {
      outcome: nextOutcome,
      overwritePrevented: false
    };
  }

  const currentOutcome = cloneOutcome(current);
  if (isAccepted(currentOutcome.attempt) && isBlockedOrAuthAttempt(nextOutcome.attempt)) {
    return {
      outcome: withOverwritePreserved(currentOutcome, nextOutcome),
      overwritePrevented: true
    };
  }

  if (outcomeRank(nextOutcome) > outcomeRank(currentOutcome)) {
    return {
      outcome: nextOutcome,
      overwritePrevented: false
    };
  }

  return {
    outcome: currentOutcome,
    overwritePrevented: false
  };
}

export function applyMergedLaneOutcome(
  target: { attempt: SourceAttempt; record: PriceRecord | null },
  merged: LaneOutcome
): void {
  const next = cloneOutcome(merged);
  target.attempt = next.attempt;
  target.record = next.record;
}
