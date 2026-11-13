export class DeliveryStore {
  private readonly completed = new Set<string>();
  private readonly inProgress = new Map<string, Promise<void>>();

  async process(id: string, work: () => Promise<void>): Promise<'processed' | 'duplicate'> {
    if (this.completed.has(id)) return 'duplicate';

    const existing = this.inProgress.get(id);
    if (existing) {
      await existing;
      return 'duplicate';
    }

    const pending = (async () => {
      await work();
      this.completed.add(id);
    })();
    this.inProgress.set(id, pending);
    try {
      await pending;
      return 'processed';
    } finally {
      this.inProgress.delete(id);
    }
  }
}
