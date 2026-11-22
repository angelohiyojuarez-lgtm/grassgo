import { Component, OnInit, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { BookingService, bookingError } from '../../core/services/booking.service';
import { DirectPlatformService } from '../../core/services/direct-platform.service';
import { AccessService } from '../../core/auth/access.service';
import { PlatformOverview, PlatformVenue, PlatformAuditEvent } from '../../core/models/platform';
import { money } from '../../core/models/booking';
import { environment } from '../../environments/environment';
import { BusinessEditor } from './business-editor';
import { Icon } from '../../shared/icon';
import { NotificationCenter } from '../../shared/notification-center';
import { NotificationService } from '../../core/services/notification.service';
import {
  PlatformOperationsService,
  PlatformOperation,
} from '../../core/services/platform-operations.service';
import { PlatformOnboardingService } from '../../core/services/platform-onboarding.service';
import { PlatformOnboarding } from './platform-onboarding';
import { PlatformCourtEditor } from './platform-court-editor';
import { AdminLocalPricing } from '../staff/admin-local-pricing';
import { AdminKiosk } from '../staff/admin-kiosk';
import { AdminIncome } from '../staff/admin-income';

@Component({
  selector: 'gg-platform-dashboard',
  imports: [
    FormsModule,
    RouterLink,
    RouterLinkActive,
    Icon,
    BusinessEditor,
    NotificationCenter,
    PlatformOnboarding,
    PlatformCourtEditor,
    AdminLocalPricing,
    AdminKiosk,
    AdminIncome,
  ],
  templateUrl: './platform-dashboard.html',
  styleUrl: './platform-dashboard.css',
})
export class PlatformDashboard implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly backend = inject(BookingService);
  private readonly direct = inject(DirectPlatformService);
  private readonly access = inject(AccessService);
  private readonly operationsService = inject(PlatformOperationsService);
  private readonly notifications = inject(NotificationService);
  private readonly onboarding = inject(PlatformOnboardingService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly data = toSignal(this.route.data, { initialValue: this.route.snapshot.data });
  readonly section = computed(() => this.data()['section'] as string);
  readonly demo = environment.useEmulators;
  readonly directMode = signal(environment.directBooking);
  private readonly allNavigation = [
    { path: '/superadmin/inicio', title: 'Resumen general', icon: 'grid' },
    { path: '/superadmin/negocios', title: 'Negocios', icon: 'building' },
    { path: '/superadmin/negocios/nuevo', title: 'Agregar negocio', icon: 'plus' },
    { path: '/superadmin/actividad', title: 'Actividad', icon: 'activity' },
    { path: '/superadmin/configuracion', title: 'Configuración', icon: 'settings' },
  ];
  readonly navigation = computed(() => this.allNavigation);
  readonly title = computed(
    () =>
      ({
        resumen: 'Resumen general',
        negocios: 'Tus negocios',
        nuevo: this.route.snapshot.paramMap.has('establishmentId')
          ? 'Configurar negocio'
          : 'Agregar negocio',
        actividad: 'Actividad de la plataforma',
        configuracion: 'Configuración',
      })[this.section()] || 'GrassGo',
  );
  readonly venues = signal<PlatformVenue[]>([]);
  readonly events = signal<PlatformAuditEvent[]>([]);
  readonly overview = signal<PlatformOverview | null>(null);
  readonly ownedLocalIds = signal<string[]>([]);
  readonly updatedAt = signal<number | null>(null);
  readonly operations = signal<PlatformOperation[]>([]);
  readonly operationsError = signal(false);
  readonly operationsLoading = signal(true);
  readonly confirmedToday = computed(() =>
    this.operations().reduce((sum, row) => sum + row.confirmed, 0),
  );
  readonly pendingProofsToday = computed(() =>
    this.operations().reduce((sum, row) => sum + row.pendingProofs, 0),
  );
  readonly gamesRunning = computed(() =>
    this.operations().reduce((sum, row) => sum + row.running, 0),
  );
  readonly pendingPublish = signal<PlatformVenue | null>(null);
  readonly priceEditor = signal<string | null>(null);
  readonly courtEditor = signal<string | null>(null);
  readonly pricing = viewChild(AdminLocalPricing);
  readonly courtForm = viewChild(PlatformCourtEditor);
  readonly kiosk = viewChild(AdminKiosk);
  readonly income = viewChild(AdminIncome);
  readonly businessTool = signal<'kiosko' | 'ingresos' | null>(null);
  readonly configurationTarget = this.route.snapshot.paramMap.get('establishmentId');
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly auditError = signal('');
  readonly createError = signal('');
  readonly message = signal('');
  readonly query = signal('');
  readonly filter = signal('all');
  readonly detail = signal<string | null>(null);
  readonly pendingStatus = signal<{
    venue: PlatformVenue;
    status: 'approved' | 'suspended';
  } | null>(null);
  private destroyed = false;
  private stopWatching?: () => void;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private refreshAgain = false;
  private refreshing = false;
  private generation = 0;
  private stopOperations?: () => void;
  private operationVersion = 0;
  readonly selectedVenue = computed(() => this.venues().find((item) => item.id === this.detail()));
  readonly filtered = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('es');
    return this.venues().filter(
      (item) =>
        (this.filter() === 'all' ||
          (this.filter() === 'published'
            ? this.isPublished(item)
            : this.filter() === 'attention'
              ? !item.bookingEnabled && item.status !== 'suspended'
              : item.status === this.filter())) &&
        `${item.name} ${item.location}`.toLocaleLowerCase('es').includes(query),
    );
  });
  readonly published = computed(
    () => this.venues().filter((item) => this.isPublished(item)).length,
  );
  readonly drafts = computed(
    () => this.venues().filter((item) => ['draft', 'pending'].includes(item.status)).length,
  );
  readonly suspended = computed(
    () => this.venues().filter((item) => item.status === 'suspended').length,
  );
  readonly attention = computed(() =>
    this.venues().filter((item) => !item.bookingEnabled && item.status !== 'suspended'),
  );
  readonly enabled = computed(() => this.venues().filter((item) => item.bookingEnabled).length);
  readonly canViewMetrics = computed(() => !this.loading() && !this.error());
  readonly money = money;
  ngOnInit(): void {
    void this.initialize();
  }
  private async initialize(): Promise<void> {
    try {
      this.directMode.set(await this.backend.usesDirectBackend());
    } catch {
      this.error.set('No pudimos consultar la configuración. Vuelve a actualizar.');
      this.loading.set(false);
      return;
    }
    await this.refresh();
    if (this.destroyed) return;
    void this.access
      .memberships()
      .then((memberships) => {
        if (!this.destroyed)
          this.ownedLocalIds.set(memberships.map((item) => item.establishmentId));
      })
      .catch(() => undefined);
    if (this.directMode() && !this.error()) {
      try {
        const stop = await this.direct.observeChanges(
          () => this.scheduleRefresh(),
          () => {
            if (!this.destroyed) {
              this.generation++;
              this.venues.set([]);
              this.overview.set(null);
              this.events.set([]);
              this.operationVersion++;
              this.stopOperations?.();
              this.operations.set([]);
              this.error.set(
                'No pudimos mantener la conexión. Revisa tu sesión y vuelve a actualizar.',
              );
              this.loading.set(false);
            }
          },
        );
        if (this.destroyed) stop();
        else this.stopWatching = stop;
      } catch {
        // La carga inicial sigue siendo válida; el botón Actualizar consulta al servidor.
      }
    }
    const createdId = this.route.snapshot.queryParamMap.get('creado');
    const requestedId = this.route.snapshot.queryParamMap.get('ficha');
    if (requestedId && this.venues().some((item) => item.id === requestedId))
      this.detail.set(requestedId);
    const venue = this.venues().find((item) => item.id === createdId);
    if (venue && this.section() === 'negocios') {
      this.detail.set(venue.id);
      this.message.set(`${venue.name} se registró correctamente. Revisa su ficha para continuar.`);
    }
  }
  async refresh(): Promise<void> {
    if (this.destroyed) return;
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    this.refreshing = true;
    const generation = ++this.generation;
    this.loading.set(true);
    this.error.set('');
    this.auditError.set('');
    const results = await Promise.allSettled([
      this.backend.call<PlatformOverview>('platformOverview'),
      this.backend.call<{ events: PlatformAuditEvent[] }>('platformActivity'),
    ]);
    this.refreshing = false;
    if (this.destroyed || generation !== this.generation) return;
    if (results[0].status === 'fulfilled') {
      this.venues.set(results[0].value.establishments);
      this.overview.set(results[0].value);
      this.updatedAt.set(Date.now());
      if (this.directMode()) void this.watchOperations(results[0].value.establishments);
    } else {
      this.venues.set([]);
      this.overview.set(null);
      this.operationVersion++;
      this.stopOperations?.();
      this.operations.set([]);
      this.error.set('No pudimos consultar los negocios. Vuelve a actualizar.');
    }
    if (results[1].status === 'fulfilled') this.events.set(results[1].value.events);
    else {
      this.events.set([]);
      this.auditError.set('No pudimos consultar la actividad registrada.');
    }
    this.loading.set(false);
    if (this.refreshAgain) {
      this.refreshAgain = false;
      this.scheduleRefresh();
    }
  }
  private async watchOperations(venues: PlatformVenue[]): Promise<void> {
    const version = ++this.operationVersion;
    this.stopOperations?.();
    this.operationsLoading.set(true);
    this.operationsError.set(false);
    try {
      const stop = await this.operationsService.observe(
        venues,
        (rows) => {
          if (this.destroyed || version !== this.operationVersion) return;
          this.operations.set(rows);
          this.operationsLoading.set(false);
          this.notifications.updateOperations(rows);
        },
        () => {
          if (this.destroyed || version !== this.operationVersion) return;
          this.operations.set([]);
          this.operationsError.set(true);
          this.operationsLoading.set(false);
        },
      );
      if (this.destroyed || version !== this.operationVersion) stop();
      else this.stopOperations = stop;
    } catch {
      if (!this.destroyed && version === this.operationVersion) {
        this.operationsError.set(true);
        this.operationsLoading.set(false);
      }
    }
  }
  private scheduleRefresh(): void {
    if (this.destroyed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 300);
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.generation++;
    this.stopWatching?.();
    this.operationVersion++;
    this.stopOperations?.();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }
  isPublished(venue: PlatformVenue): boolean {
    return (
      venue.status !== 'suspended' &&
      (venue.publicationStatus
        ? venue.publicationStatus === 'published'
        : venue.status === 'published')
    );
  }
  showVenue(id: string): void {
    if (!this.selectVenue(id)) return;
    void this.router.navigate(['/superadmin/negocios'], { queryParams: { ficha: id } });
  }
  selectVenue(id: string): boolean {
    if (this.detail() !== id && !this.canLeavePage()) return false;
    if (this.detail() !== id) {
      this.priceEditor.set(null);
      this.courtEditor.set(null);
      this.businessTool.set(null);
    }
    this.detail.set(id);
    return true;
  }
  editPrices(id: string): void {
    if (!this.canLeavePage()) return;
    this.priceEditor.set(id);
    this.courtEditor.set(null);
    this.businessTool.set(null);
  }
  addCourt(id: string): void {
    if (!this.canLeavePage()) return;
    this.priceEditor.set(null);
    this.courtEditor.set(id);
    this.businessTool.set(null);
  }
  openBusinessTool(tool: 'kiosko' | 'ingresos'): void {
    if (this.businessTool() === tool || !this.canLeavePage()) return;
    this.priceEditor.set(null);
    this.courtEditor.set(null);
    this.businessTool.set(tool);
  }
  async courtAdded(): Promise<void> {
    this.courtEditor.set(null);
    await this.refresh();
  }
  closeDetail(): void {
    if (!this.canLeavePage()) return;
    this.priceEditor.set(null);
    this.courtEditor.set(null);
    this.businessTool.set(null);
    this.detail.set(null);
  }
  canLeavePage(): boolean {
    if (!this.auth.user()) return true;
    const editor = this.pricing();
    if (
      editor?.isSaving() ||
      this.courtForm()?.busy() ||
      this.kiosk()?.isSaving() ||
      this.income()?.isSaving()
    )
      return false;
    return (
      !(
        editor?.hasUnsavedChanges() ||
        this.kiosk()?.hasUnsavedChanges() ||
        this.income()?.hasUnsavedChanges()
      ) || window.confirm('Tienes cambios sin guardar. ¿Quieres salir y descartarlos?')
    );
  }
  statusLabel(status: string): string {
    return (
      {
        draft: 'Borrador',
        pending: 'Por revisar',
        approved: 'Aprobado',
        published: 'Publicado',
        suspended: 'Suspendido',
        active: 'Activo',
      }[status] || 'Por revisar'
    );
  }
  eventLabel(action: string): string {
    return (
      {
        establishment_created: 'Negocio registrado',
        business_configuration_saved: 'Configuración guardada',
        business_published: 'Negocio publicado',
        establishment_status_changed: 'Estado del negocio actualizado',
        payment_verified: 'Adelanto verificado',
        reservation_rejected: 'Solicitud rechazada',
        platform_role_granted: 'Acceso de superadmin asignado',
        establishment_admin_assigned: 'Responsable del negocio asignado',
        admin_assigned: 'Responsable del negocio asignado',
        owner_invitation_accepted: 'Dueño del negocio asignado',
        business_setting_changed: 'Configuración del negocio actualizada',
        business_created: 'Negocio registrado e invitación preparada',
      }[action] || 'Acción registrada'
    );
  }
  settingLabel(kind: string | undefined): string {
    return (
      (
        {
          contact: 'Datos del negocio actualizados',
          payment: 'Datos de pago y QR actualizados',
          schedule: 'Horarios actualizados',
          closure: 'Cierre o reapertura actualizado',
          pricing: 'Precios actualizados',
        } as Record<string, string>
      )[kind || ''] || 'Configuración actualizada'
    );
  }
  venueName(id: string): string {
    return this.venues().find((item) => item.id === id)?.name || id || 'GrassGo';
  }
  dateLabel(at: number | null): string {
    return at
      ? new Intl.DateTimeFormat('es-PE', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/Lima',
        }).format(at)
      : 'Fecha pendiente';
  }
  async confirmStatus(): Promise<void> {
    const change = this.pendingStatus();
    if (!change || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.backend.call('setEstablishmentStatus', {
        establishmentId: change.venue.id,
        status: change.status,
      });
      this.pendingStatus.set(null);
      this.message.set(
        `Estado de ${change.venue.name}: ${this.statusLabel(change.status).toLowerCase()}. La acción quedó registrada.`,
      );
      await this.refresh();
    } catch (error) {
      this.error.set(bookingError(error));
    } finally {
      this.busy.set(false);
    }
  }
  async confirmPublish(): Promise<void> {
    const venue = this.pendingPublish();
    if (!venue || !venue.ready || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.onboarding.publish(venue.id);
      this.pendingPublish.set(null);
      this.message.set(
        `${venue.name} ya está publicado y recibe reservas. Los comprobantes se revisarán manualmente.`,
      );
      await this.refresh();
    } catch (error) {
      this.error.set(bookingError(error));
    } finally {
      this.busy.set(false);
    }
  }
  async logout(): Promise<void> {
    if (this.busy()) return;
    try {
      await this.auth.logout();
      await this.router.navigateByUrl('/superadmin/ingresar');
    } catch {
      this.error.set('No pudimos cerrar la sesión. Intenta nuevamente.');
    }
  }
}
