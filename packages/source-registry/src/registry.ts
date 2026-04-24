import { buildSeedAdapters, type SourceAdapter } from "@artbot/source-adapters";
import { buildCustomSourceAdapters, loadCustomSources } from "./custom-sources.js";

export class SourceRegistry {
  private adapters: SourceAdapter[];

  constructor(adapters?: SourceAdapter[]) {
    if (adapters) {
      this.adapters = adapters;
      return;
    }

    const customSources = loadCustomSources();
    if (!customSources.ok) {
      throw new Error(`Invalid custom sources file ${customSources.path}: ${customSources.errors.join("; ")}`);
    }

    this.adapters = [...buildSeedAdapters(), ...buildCustomSourceAdapters(customSources.sources)];
  }

  public list(): SourceAdapter[] {
    return [...this.adapters];
  }

  public register(adapter: SourceAdapter): void {
    this.adapters = [...this.adapters, adapter];
  }
}
