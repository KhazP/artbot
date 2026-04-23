import { z } from "zod";

export const deepResearchSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  plannerModel: z.string().default("gemini-pro-latest"),
  researchMode: z.enum(["deep_research_max"]).default("deep_research_max"),
  warnOnRun: z.boolean().default(true),
  spendCapReminderUsd: z.number().int().positive().default(20),
  openFullReportAfterRun: z.boolean().default(true)
});

export type DeepResearchSettings = z.infer<typeof deepResearchSettingsSchema>;

export const deepResearchCitationSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional()
});

export type DeepResearchCitation = z.infer<typeof deepResearchCitationSchema>;

export const deepResearchPlanSchema = z.object({
  normalRunSummary: z.string(),
  missingEvidenceSummary: z.string(),
  researchObjectives: z.array(z.string()),
  followUpQuestions: z.array(z.string()),
  prioritySearchTargets: z.array(z.string()),
  finalReportInstructions: z.string()
});

export type DeepResearchPlan = z.infer<typeof deepResearchPlanSchema>;

export const deepResearchProviderMetadataSchema = z.object({
  plannerModel: z.string(),
  researchMode: z.string(),
  agentId: z.string().optional(),
  planningDurationMs: z.number().int().nonnegative().optional(),
  researchDurationMs: z.number().int().nonnegative().optional(),
  completedAt: z.string().optional()
});

export type DeepResearchProviderMetadata = z.infer<typeof deepResearchProviderMetadataSchema>;

export const deepResearchResultSchema = z.object({
  enabled: z.boolean(),
  status: z.enum(["disabled", "skipped", "completed", "failed"]),
  summary: z.string().nullable().optional(),
  promptPlan: deepResearchPlanSchema.nullable().optional(),
  reportMarkdown: z.string().nullable().optional(),
  citations: z.array(deepResearchCitationSchema).default([]),
  warnings: z.array(z.string()).default([]),
  providerMetadata: deepResearchProviderMetadataSchema.optional(),
  artifactPath: z.string().optional()
});

export type DeepResearchResult = z.infer<typeof deepResearchResultSchema>;
