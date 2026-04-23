import type { PipelineDetails } from "../state.js";

export interface ReviewQueueEntry {
  id: string;
  label: string;
  detail: string;
}

export function buildReviewQueueModel(details: PipelineDetails | null): ReviewQueueEntry[] {
  const inventoryByKey = new Map(
    (details?.inventory ?? []).map((item) => [
      item.record_key,
      {
        title: item.payload.work_title ?? "Untitled",
        sourceName: item.payload.source_name ?? "unknown"
      }
    ] as const)
  );

  return (details?.review_queue ?? []).slice(0, 6).map((item) => ({
    id: item.id,
    label: `${inventoryByKey.get(item.left_record_key ?? "")?.title ?? item.left_record_key ?? "left"} vs ${inventoryByKey.get(item.right_record_key ?? "")?.title ?? item.right_record_key ?? "right"}`,
    detail: `${item.status ?? "open"}${item.recommended_action ? ` · ${item.recommended_action}` : ""}${item.reasons?.[0] ? ` · ${item.reasons[0]}` : ""}${typeof item.confidence === "number" ? ` · ${item.confidence.toFixed(2)}` : ""}`
  }));
}
