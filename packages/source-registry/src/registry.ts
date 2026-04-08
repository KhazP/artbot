import { buildSeedAdapters, type SourceAdapter } from "@artbot/source-adapters";

export class SourceRegistry {
  private adapters: SourceAdapter[];

  constructor(adapters: SourceAdapter[] = buildSeedAdapters()) {
    this.adapters = adapters;
  }

  public list(): SourceAdapter[] {
    return [...this.adapters];
  }

  public register(adapter: SourceAdapter): void {
    this.adapters = [...this.adapters, adapter];
  }
}
