import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { AccessService } from '../auth/access.service';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationService } from './notification.service';
import { NotificationEvent, NotificationFeed, NotificationSound } from './notification-state';

const sdk = vi.hoisted(() => ({ onSnapshot: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (reference: { path: string }, ...filters: unknown[]) => ({ ...reference, filters }),
  where: (...parts: unknown[]) => ({ where: parts }),
  orderBy: (...parts: unknown[]) => ({ orderBy: parts }),
  limit: (value: number) => ({ limit: value }),
  onSnapshot: sdk.onSnapshot,
}));

describe('Notificaciones conectadas con sonido', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(localStorage))
      if (key.startsWith('grassgo-notifications:')) localStorage.removeItem(key);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('el historial inicial permanece silencioso y cada cambio nuevo se anuncia una sola vez', () => {
    const feed = new NotificationFeed();
    const event = (id: string, at: number): NotificationEvent => ({
      id,
      at,
      title: 'Reserva confirmada',
      detail: 'Mi local',
      href: '/reservas',
    });
    feed.reset('alice:cliente');
    expect(feed.ingest('client', [event('antigua', 1)], false)).toEqual([]);
    expect(feed.ingest('client', [event('antigua', 1), event('otra-antigua', 2)], true)).toEqual(
      [],
    );
    expect(feed.items().some((item) => item.unread)).toBe(false);
    expect(feed.ingest('client', [event('nueva', 3)], true).map((item) => item.id)).toEqual([
      'nueva',
    ]);
    expect(feed.ingest('client', [event('nueva', 3)], true)).toEqual([]);
    expect(feed.items().filter((item) => item.unread)).toHaveLength(1);
    const read = feed.markAllRead();
    expect(read).toContain('nueva');
    expect(feed.items().some((item) => item.unread)).toBe(false);
    feed.reset('alice:admin', read);
    expect(feed.items()).toEqual([]);
    expect(feed.ingest('admin:a', [event('nueva', 3)])).toEqual([]);
  });

  it('cada portal escucha solo sus fuentes y cerrar sesión descarta los avisos y callbacks anteriores', async () => {
    const user = signal<{ uid: string } | null>({ uid: 'alice' });
    const route = { url: '/reservas', events: new Subject<NavigationEnd>() };
    const watchers: {
      path: string;
      filters?: unknown[];
      next: (value: any) => void;
      stop: ReturnType<typeof vi.fn>;
    }[] = [];
    sdk.onSnapshot.mockImplementation((query, next) => {
      const stop = vi.fn();
      watchers.push({ ...query, next, stop });
      return stop;
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user } },
        {
          provide: AccessService,
          useValue: {
            memberships: async () => [{ establishmentId: 'a' }],
            isSuperadmin: async () => true,
          },
        },
        { provide: FirebaseService, useValue: { getDb: async () => ({}) } },
        { provide: Router, useValue: route },
      ],
    });
    const service = TestBed.inject(NotificationService);
    TestBed.tick();
    await vi.waitFor(() => expect(watchers).toHaveLength(1));
    const client = watchers[0];
    expect(client.path).toBe('direct_requests');
    expect(client.filters).toContainEqual({ where: ['clientUid', '==', 'alice'] });
    const snapshot = (data: Record<string, unknown>[]) => ({
      metadata: { fromCache: false },
      docs: data.map((item, index) => ({ id: 'item-' + index, data: () => item })),
    });
    client.next(snapshot([]));
    client.next(
      snapshot([{ status: 'confirmed', establishmentName: 'Local propio', createdAt: 1000 }]),
    );
    expect(service.unread()).toBe(1);
    route.url = '/admin/inicio';
    route.events.next(new NavigationEnd(1, route.url, route.url));
    TestBed.tick();
    await vi.waitFor(() => expect(watchers).toHaveLength(2));
    expect(client.stop).toHaveBeenCalledOnce();
    expect(watchers[1].filters).toContainEqual({ where: ['establishmentId', '==', 'a'] });
    client.next(
      snapshot([{ status: 'rejected', establishmentName: 'Dato de otra vista', createdAt: 2000 }]),
    );
    expect(service.items()).toEqual([]);
    route.url = '/superadmin/inicio';
    route.events.next(new NavigationEnd(2, route.url, route.url));
    TestBed.tick();
    await vi.waitFor(() =>
      expect(watchers.some((watcher) => watcher.path === 'audit_logs')).toBe(true),
    );
    const audit = watchers.find((watcher) => watcher.path === 'audit_logs')!;
    expect(audit.filters).toContainEqual({ limit: 30 });
    expect(watchers.filter((watcher) => watcher.path === 'direct_requests')).toHaveLength(2);
    audit.next(snapshot([]));
    audit.next(
      snapshot([
        { action: 'business_setting_changed', kind: 'pricing', establishmentId: 'a', at: 3000 },
      ]),
    );
    expect(service.items()[0].title).toBe('Precios actualizados');
    const operations = { establishmentId: 'a', name: 'Mi local', pendingProofs: 0, running: 0 };
    service.updateOperations([operations]);
    const beforeOperations = service.items().length;
    service.updateOperations([{ ...operations, pendingProofs: 1 }]);
    expect(service.items().some((item) => item.title === 'Comprobante por revisar')).toBe(true);
    expect(service.items()).toHaveLength(beforeOperations + 1);
    service.updateOperations([{ ...operations, pendingProofs: 1 }]);
    expect(service.items()).toHaveLength(beforeOperations + 1);
    service.updateOperations([{ ...operations, pendingProofs: 1, running: 1 }]);
    service.updateOperations([{ ...operations, pendingProofs: 1, running: 0 }]);
    expect(service.items().some((item) => item.title === 'Partido iniciado')).toBe(true);
    expect(service.items().some((item) => item.title === 'Partido finalizado')).toBe(true);
    user.set(null);
    TestBed.tick();
    expect(service.visible()).toBe(false);
    expect(service.items()).toEqual([]);
    audit.next(snapshot([{ action: 'business_published', establishmentId: 'a', at: 4000 }]));
    expect(service.items()).toEqual([]);
    expect(watchers.every((watcher) => watcher.stop.mock.calls.length === 1)).toBe(true);
  });

  it('el sonido requiere activación, respeta silencio y maneja el bloqueo del navegador sin reproducir audio', async () => {
    const tone = () => ({
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    });
    const volume = () => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    const context = {
      state: 'suspended',
      currentTime: 1,
      destination: {},
      createOscillator: vi.fn(tone),
      createGain: vi.fn(volume),
      resume: vi.fn(async () => {
        context.state = 'running';
      }),
      close: vi.fn(async () => {
        context.state = 'closed';
      }),
    };
    const create = vi.fn(() => context as unknown as AudioContext);
    const sound = new NotificationSound(create);
    expect(sound.play()).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(await sound.enable()).toBe(true);
    expect(sound.play()).toBe(true);
    expect(context.createOscillator).toHaveBeenCalledTimes(2);
    sound.mute();
    expect(sound.play()).toBe(false);
    expect(context.createOscillator).toHaveBeenCalledTimes(2);
    sound.close();
    expect(context.close).toHaveBeenCalledOnce();
    const blocked = new NotificationSound(
      () =>
        ({
          ...context,
          state: 'suspended',
          resume: vi.fn().mockRejectedValue(new Error('Audio bloqueado')),
        }) as unknown as AudioContext,
    );
    expect(await blocked.enable()).toBe(false);
    expect(blocked.play()).toBe(false);
    let resolveResume!: () => void;
    const pending = new NotificationSound(
      () =>
        ({
          ...context,
          state: 'suspended',
          resume: () => new Promise<void>((resolve) => (resolveResume = resolve)),
        }) as unknown as AudioContext,
    );
    const activation = pending.enable();
    pending.close();
    resolveResume();
    expect(await activation).toBe(false);
  });
});
