import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import type { DocumentData, Query, QuerySnapshot } from 'firebase/firestore';
import { AuthService } from '../auth/auth.service';
import { AccessService } from '../auth/access.service';
import { FirebaseService } from '../firebase/firebase.service';
import {
  GrassNotification,
  NotificationEvent,
  NotificationFeed,
  NotificationPortal,
  NotificationSound,
} from './notification-state';

const milliseconds = (value: unknown): number =>
  typeof (value as { toMillis?: unknown })?.toMillis === 'function'
    ? (value as { toMillis(): number }).toMillis()
    : typeof value === 'number'
      ? value
      : 0;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const validId = (id: string): boolean => /^[A-Za-z0-9-]{1,80}$/.test(id);
const portalFor = (url: string): NotificationPortal | null => {
  if (
    /^\/(?:$|ingresar(?:\?|$)|registro(?:\?|$)|recuperar(?:\?|$)|admin\/ingresar|superadmin\/(?:ingresar|recuperar))/.test(
      url,
    )
  )
    return null;
  return url.startsWith('/superadmin/')
    ? 'superadmin'
    : url.startsWith('/admin/')
      ? 'admin'
      : 'cliente';
};

/** Avisos derivados de datos autorizados existentes; no envía mensajes ni verifica pagos. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly auth = inject(AuthService);
  private readonly access = inject(AccessService);
  private readonly firebase = inject(FirebaseService);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  readonly portal = signal<NotificationPortal | null>(null);
  readonly items = signal<GrassNotification[]>([]);
  readonly unread = computed(() => this.items().filter((item) => item.unread).length);
  readonly visible = computed(() => this.portal() !== null);
  readonly soundEnabled = signal(false);
  readonly soundReady = signal(false);
  readonly soundPreferred = signal(false);
  readonly error = signal('');
  readonly soundError = signal('');
  private readonly feed = new NotificationFeed();
  private readonly sound = new NotificationSound();
  private activeScope = '';
  private identityDetails = '';
  private generation = 0;
  private stops: (() => void)[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private readonly requestSources = new Map<
    string,
    { data: { id: string; data: DocumentData }[]; server: boolean }
  >();
  private readonly previousOperations = new Map<
    string,
    { pendingProofs: number; running: number }
  >();
  private operationsSequence = 0;

  constructor() {
    effect(() => {
      const user = this.auth.user();
      const uid = user?.uid;
      const portal = uid ? portalFor(this.url()) : null;
      const scope = uid && portal ? `${uid}:${portal}` : '';
      const identityDetails = `${user?.email || ''}:${user?.emailVerified === true}`;
      if (scope === this.activeScope && identityDetails === this.identityDetails) return;
      this.identityDetails = identityDetails;
      this.reset(scope, portal);
      if (uid && portal) void this.connect(uid, portal, this.generation);
    });
    this.destroy.onDestroy(() => this.reset('', null));
  }
  private readStorage(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  private writeStorage(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* La campana sigue funcionando sin persistencia. */
    }
  }
  private storageKey(kind: string): string {
    return `grassgo-notifications:${this.activeScope}:${kind}`;
  }
  private readIds(kind: string): string[] {
    try {
      const value: unknown = JSON.parse(this.readStorage(this.storageKey(kind)) || '[]');
      return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string').slice(-200)
        : [];
    } catch {
      return [];
    }
  }
  private reset(scope: string, portal: NotificationPortal | null): void {
    this.generation++;
    this.stops.splice(0).forEach((stop) => stop());
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.requestSources.clear();
    this.previousOperations.clear();
    this.operationsSequence = 0;
    this.sound.close();
    this.activeScope = scope;
    this.portal.set(portal);
    this.items.set([]);
    this.error.set('');
    this.soundError.set('');
    this.soundEnabled.set(false);
    this.soundReady.set(false);
    this.soundPreferred.set(!!scope && this.readStorage(this.storageKey('sound')) === 'on');
    this.feed.reset(scope, scope ? this.readIds('read') : []);
  }
  private fail(generation: number): void {
    if (generation !== this.generation) return;
    const scope = this.activeScope,
      portal = this.portal();
    this.reset(scope, portal);
    this.error.set('No pudimos consultar los avisos. Actualiza la página o revisa tu sesión.');
  }
  private async connect(
    uid: string,
    portal: NotificationPortal,
    generation: number,
  ): Promise<void> {
    try {
      const sdk = await import('firebase/firestore');
      const db = await this.firebase.getDb();
      if (generation !== this.generation) return;
      const current = () => generation === this.generation && this.auth.user()?.uid === uid;
      const watch = (
        query: Query<DocumentData>,
        source: string,
        handle: (snapshot: QuerySnapshot<DocumentData>) => void,
      ) => {
        const stop = sdk.onSnapshot(
          query,
          (snapshot) => {
            if (current()) handle(snapshot);
          },
          () => this.fail(generation),
        );
        if (current()) this.stops.push(stop);
        else stop();
      };
      if (portal === 'superadmin') {
        if (!(await this.access.isSuperadmin()) || !current()) {
          this.fail(generation);
          return;
        }
        watch(
          sdk.query(sdk.collection(db, 'audit_logs'), sdk.orderBy('at', 'desc'), sdk.limit(30)),
          'audit',
          (snapshot) => {
            this.accept(
              'audit',
              snapshot.docs.map((item) => this.auditEvent(item.id, item.data())),
              !snapshot.metadata.fromCache,
            );
          },
        );
        const stop = sdk.onSnapshot(
          sdk.doc(db, 'platform_roles', uid),
          (snapshot) => {
            if (
              current() &&
              !snapshot.metadata.fromCache &&
              (snapshot.data()?.['role'] !== 'superadmin' ||
                snapshot.data()?.['status'] !== 'active')
            )
              this.fail(generation);
          },
          () => this.fail(generation),
        );
        if (current()) this.stops.push(stop);
        else stop();
        return;
      }
      if (portal === 'cliente') {
        watch(
          sdk.query(
            sdk.collection(db, 'direct_requests'),
            sdk.where('clientUid', '==', uid),
            sdk.orderBy('createdAt', 'desc'),
            sdk.limit(100),
          ),
          'client',
          (snapshot) => this.acceptRequests('client', snapshot),
        );
        const recipient = this.auth.user();
        if (recipient?.emailVerified && recipient.email) {
          // Una verificación recién completada debe estar también en el token.
          const token = await recipient.getIdTokenResult(true);
          if (!current()) return;
          const email = recipient.email.trim().toLowerCase();
          if (
            token.claims['email_verified'] === true &&
            text(token.claims['email']).trim().toLowerCase() === email
          ) {
            watch(
              sdk.query(
                sdk.collection(db, 'establishment_invitations'),
                sdk.where('targetEmail', '==', email),
                sdk.limit(50),
              ),
              'invitations',
              (snapshot) => {
                this.accept(
                  'invitations',
                  snapshot.docs
                    .filter((item) => item.data()['status'] === 'pending')
                    .map((item) => ({
                      id: `invitation:${item.id}`,
                      title: 'Te invitaron a administrar un negocio',
                      detail: text(item.data()['establishmentName']),
                      href: '/invitaciones',
                      at: milliseconds(item.data()['createdAt']),
                    })),
                  !snapshot.metadata.fromCache,
                );
              },
            );
          }
        }
      } else {
        const memberships = await this.access.memberships();
        if (!current()) return;
        for (const member of memberships) {
          if (!validId(member.establishmentId)) continue;
          const source = `admin:${member.establishmentId}`;
          watch(
            sdk.query(
              sdk.collection(db, 'direct_requests'),
              sdk.where('establishmentId', '==', member.establishmentId),
              sdk.orderBy('createdAt', 'desc'),
              sdk.limit(100),
            ),
            source,
            (snapshot) => this.acceptRequests(source, snapshot),
          );
        }
      }
      if (current())
        this.timer = setInterval(() => {
          if (current())
            for (const [source, value] of this.requestSources)
              this.accept(source, this.requestEvents(value.data, portal), value.server);
        }, 1000);
    } catch {
      this.fail(generation);
    }
  }
  private acceptRequests(source: string, snapshot: QuerySnapshot<DocumentData>): void {
    const data = snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
    const server = !snapshot.metadata.fromCache;
    this.requestSources.set(source, { data, server });
    this.accept(source, this.requestEvents(data, this.portal()!), server);
  }
  private requestEvents(
    records: { id: string; data: DocumentData }[],
    portal: NotificationPortal,
  ): NotificationEvent[] {
    return records.flatMap(({ id, data }) => {
      const start = milliseconds(data['actualStartAt']);
      const end = start ? start + 3600000 : 0;
      const service = start
        ? Date.now() >= end || data['serviceStatus'] === 'completed'
          ? 'completed'
          : 'running'
        : '';
      const status = service || text(data['status']);
      if (
        portal === 'cliente' &&
        !['confirmed', 'rejected', 'running', 'completed'].includes(status)
      )
        return [];
      const titles: Record<string, string> = {
        pending_payment: 'Nueva solicitud de reserva',
        pending_verification: 'Comprobante por revisar',
        confirmed: 'Reserva confirmada',
        rejected: 'Solicitud rechazada',
        running: 'El partido empezó',
        completed: 'El partido terminó',
      };
      if (!titles[status]) return [];
      const time =
        status === 'completed'
          ? end
          : status === 'running'
            ? start
            : milliseconds(data['reviewedAt'] || data['proofSubmittedAt'] || data['createdAt']);
      return [
        {
          id: `request:${id}:${status}:${service ? start : ''}`,
          title: titles[status],
          detail: [
            text(data['establishmentName']),
            text(data['date']),
            typeof data['hour'] === 'number' ? `${String(data['hour']).padStart(2, '0')}:00` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          href: portal === 'admin' ? '/admin/inicio' : '/reservas',
          at: time,
        },
      ];
    });
  }
  private auditEvent(id: string, data: DocumentData): NotificationEvent {
    const titles: Record<string, string> = {
      establishment_created: 'Nuevo negocio registrado',
      establishment_status_changed: 'Estado del negocio actualizado',
      business_published: 'Negocio publicado',
      establishment_admin_assigned: 'Dueño asignado',
      admin_assigned: 'Dueño asignado',
      owner_invitation_accepted: 'Invitación de dueño aceptada',
      platform_role_granted: 'Acceso de plataforma actualizado',
      business_configuration_saved: 'Configuración del negocio actualizada',
      business_invitation_created: 'Invitación de negocio creada',
      business_invitation_accepted: 'Invitación de negocio aceptada',
      business_booking_enabled: 'Agenda de negocio habilitada',
    };
    if (data['action'] === 'business_setting_changed') {
      titles['business_setting_changed'] =
        (
          {
            schedule: 'Horarios actualizados',
            pricing: 'Precios actualizados',
            payment: 'Datos de pago actualizados',
            contact: 'Información del negocio actualizada',
            closure: 'Cierre del negocio actualizado',
          } as Record<string, string>
        )[text(data['kind'])] || 'Configuración del negocio actualizada';
    }
    const venue = text(data['establishmentId']);
    return {
      id: `audit:${id}`,
      title: titles[text(data['action'])] || 'Nueva actividad en GrassGo',
      detail: validId(venue)
        ? 'Hay cambios en un negocio de la plataforma.'
        : 'Hay cambios en la plataforma.',
      href: validId(venue)
        ? `/superadmin/negocios?ficha=${encodeURIComponent(venue)}`
        : '/superadmin/actividad',
      at: milliseconds(data['at']),
    };
  }
  private accept(source: string, events: NotificationEvent[], server: boolean): void {
    // Los campos at sin reloj de servidor no se convierten en alarmas antiguas al recargar.
    const fresh = this.feed.ingest(source, events, server);
    const next = this.feed.items(),
      previous = this.items();
    if (
      next.length !== previous.length ||
      next.some((item, index) => {
        const old = previous[index];
        return (
          !old ||
          item.id !== old.id ||
          item.unread !== old.unread ||
          item.title !== old.title ||
          item.detail !== old.detail ||
          item.at !== old.at
        );
      })
    )
      this.items.set(next);
    if (fresh.length) void this.soundOnce(fresh.sort((a, b) => b.at - a.at)[0].id);
  }
  markAllRead(): void {
    this.writeStorage(this.storageKey('read'), JSON.stringify(this.feed.markAllRead()));
    this.items.set(this.feed.items());
  }
  /** Métricas sanitizadas de ocupación; nunca recibe personas ni imágenes de pago. */
  updateOperations(
    rows: {
      establishmentId: string;
      name: string;
      pendingProofs: number;
      running: number;
      version?: string;
    }[],
  ): void {
    if (this.portal() !== 'superadmin') return;
    const events: NotificationEvent[] = [];
    const current = new Set<string>();
    for (const row of rows) {
      if (
        !validId(row.establishmentId) ||
        ![row.pendingProofs, row.running].every((value) => Number.isInteger(value) && value >= 0)
      )
        continue;
      current.add(row.establishmentId);
      const previous = this.previousOperations.get(row.establishmentId);
      if (previous) {
        const title = row.pendingProofs > previous.pendingProofs ? 'Comprobante por revisar' : '';
        const serviceTitle =
          row.running > previous.running
            ? 'Partido iniciado'
            : row.running < previous.running
              ? 'Partido finalizado'
              : '';
        for (const [kind, label] of [
          ['proof', title],
          ['service', serviceTitle],
        ]) {
          if (!label) continue;
          const version = row.version || String(++this.operationsSequence);
          events.push({
            id: `operations:${row.establishmentId}:${kind}:${version}`,
            title: label,
            detail:
              kind === 'proof'
                ? `${row.name} · ${row.pendingProofs} comprobante(s) pendiente(s)`
                : row.name,
            href: `/superadmin/negocios?ficha=${encodeURIComponent(row.establishmentId)}`,
            at: Date.now(),
          });
        }
      }
      this.previousOperations.set(row.establishmentId, {
        pendingProofs: row.pendingProofs,
        running: row.running,
      });
    }
    for (const id of this.previousOperations.keys())
      if (!current.has(id)) this.previousOperations.delete(id);
    this.accept('operations', events, true);
  }
  async enableSound(): Promise<void> {
    const scope = this.activeScope;
    this.soundError.set('');
    const enabled = await this.sound.enable();
    if (scope !== this.activeScope) return;
    this.soundEnabled.set(enabled);
    this.soundReady.set(enabled);
    this.soundPreferred.set(enabled);
    this.writeStorage(this.storageKey('sound'), enabled ? 'on' : 'off');
    if (enabled) this.sound.play();
    else
      this.soundError.set('El navegador no pudo activar el sonido. Pulsa Activar sonido otra vez.');
  }
  mute(): void {
    this.sound.mute();
    this.soundEnabled.set(false);
    this.soundPreferred.set(false);
    this.writeStorage(this.storageKey('sound'), 'off');
  }
  testSound(): void {
    if (!this.sound.play())
      this.soundError.set('Pulsa Activar sonido para permitir el audio en este navegador.');
  }
  private async soundOnce(id: string): Promise<void> {
    if (!this.soundEnabled() || !this.soundReady()) return;
    const scope = this.activeScope;
    const play = () => {
      if (scope !== this.activeScope || !this.soundEnabled()) return;
      const sounded = this.readIds('sounded');
      if (sounded.includes(id)) return;
      this.writeStorage(this.storageKey('sounded'), JSON.stringify([...sounded, id].slice(-100)));
      if (!this.sound.play()) {
        this.soundReady.set(false);
        this.soundEnabled.set(false);
      }
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.locks)
        await navigator.locks.request(`grassgo-notifications:${scope}`, play);
      else play();
    } catch {
      /* Un navegador sin locks no afecta los avisos visuales. */
    }
  }
  dateLabel(at: number): string {
    return at
      ? new Intl.DateTimeFormat('es-PE', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'America/Lima',
        }).format(at)
      : 'Ahora';
  }
}
