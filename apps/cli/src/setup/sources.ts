export interface SetupSourceDescriptor {
  sourceName: string;
  sourceUrl: string;
  requiresAuth: boolean;
  requiresLicense: boolean;
  optionalProbe: boolean;
  notes?: string;
}

export const defaultSetupSources: SetupSourceDescriptor[] = [
  {
    sourceName: "Artsy",
    sourceUrl: "https://www.artsy.net",
    requiresAuth: true,
    requiresLicense: false,
    optionalProbe: true,
    notes: "Optional probe; may require partner access depending on region and account state."
  },
  {
    sourceName: "MutualArt",
    sourceUrl: "https://www.mutualart.com",
    requiresAuth: true,
    requiresLicense: false,
    optionalProbe: true,
    notes: "Optional probe; auth capture is useful when a valid session is available."
  },
  {
    sourceName: "askART",
    sourceUrl: "https://www.askart.com",
    requiresAuth: true,
    requiresLicense: true,
    optionalProbe: true,
    notes: "Licensed/optional source; skip unless you have legitimate access."
  },
  {
    sourceName: "Sanatfiyat",
    sourceUrl: "https://www.sanatfiyat.com",
    requiresAuth: false,
    requiresLicense: true,
    optionalProbe: false,
    notes: "Licensed-only source."
  }
];

export function listAuthRelevantSources(): SetupSourceDescriptor[] {
  return defaultSetupSources.filter((source) => source.requiresAuth || source.requiresLicense);
}

export function listOptionalProbeSources(): SetupSourceDescriptor[] {
  return defaultSetupSources.filter((source) => source.optionalProbe);
}

export function findSetupSourceByName(sourceName: string): SetupSourceDescriptor | undefined {
  const normalized = sourceName.trim().toLowerCase();
  return defaultSetupSources.find((source) => source.sourceName.toLowerCase() === normalized);
}
