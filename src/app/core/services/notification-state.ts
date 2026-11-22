export type NotificationPortal = 'cliente' | 'admin' | 'superadmin';
export interface GrassNotification {
  id: string;
  title: string;
  detail: string;
  href: string;
  at: number;
  unread: boolean;
}
export type NotificationEvent = Omit<GrassNotification, 'unread'>;

/** La primera respuesta del servidor es historial: nunca provoca una alarma. */
export class NotificationFeed {
  private baseline = new Set<string>();
  private known = new Set<string>();
  private read = new Set<string>();
  private records = new Map<string, GrassNotification>();
  scope = '';

  reset(scope: string, read: string[] = []): void {
    this.scope = scope;
    this.baseline.clear();
    this.known.clear();
    this.records.clear();
    this.read = new Set(read);
  }
  ingest(source: string, events: NotificationEvent[], fromServer = true): GrassNotification[] {
    const initial = !this.baseline.has(source);
    if (fromServer) this.baseline.add(source);
    const fresh: GrassNotification[] = [];
    for (const event of events) {
      const previous = this.records.get(event.id);
      const isNew = !this.known.has(event.id);
      const item = { ...event, unread: previous?.unread ?? (!initial && !this.read.has(event.id)) };
      this.records.set(event.id, item);
      this.known.add(event.id);
      if (!initial && isNew && item.unread) fresh.push(item);
    }
    if (this.records.size > 100) {
      const keep = new Set(this.items().map((item) => item.id));
      for (const id of this.records.keys()) if (!keep.has(id)) this.records.delete(id);
    }
    return fresh;
  }
  items(): GrassNotification[] {
    return [...this.records.values()].sort((a, b) => b.at - a.at).slice(0, 20);
  }
  markAllRead(): string[] {
    for (const item of this.records.values()) {
      item.unread = false;
      this.read.add(item.id);
    }
    return [...this.read].slice(-200);
  }
}

/** Audio local. Solo se desbloquea mediante una pulsación explícita. */
export class NotificationSound {
  private context?: AudioContext;
  enabled = false;
  constructor(private readonly create = () => new AudioContext()) {}
  async enable(): Promise<boolean> {
    try {
      this.context ??= this.create();
      const context = this.context;
      await context.resume();
      if (this.context !== context) return false;
      this.enabled = context.state === 'running';
    } catch {
      this.enabled = false;
    }
    return this.enabled;
  }
  mute(): void {
    this.enabled = false;
  }
  play(): boolean {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running') return false;
    try {
      for (const [index, frequency] of [880, 1175].entries()) {
        const tone = context.createOscillator();
        const volume = context.createGain();
        const start = context.currentTime + index * 0.17;
        tone.type = 'sine';
        tone.frequency.setValueAtTime(frequency, start);
        volume.gain.setValueAtTime(0.0001, start);
        volume.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
        volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        tone.connect(volume);
        volume.connect(context.destination);
        tone.onended = () => {
          tone.disconnect();
          volume.disconnect();
        };
        tone.start(start);
        tone.stop(start + 0.17);
      }
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }
  close(): void {
    this.enabled = false;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
