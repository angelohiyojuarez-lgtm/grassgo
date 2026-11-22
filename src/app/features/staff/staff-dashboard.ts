import {
  AfterViewChecked,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AccessService } from '../../core/auth/access.service';
import { FirebaseService } from '../../core/firebase/firebase.service';
import { BookingService, bookingError } from '../../core/services/booking.service';
import { EstablishmentMembership } from '../../core/models/domain';
import { Reservation, money, slotLabel, statusLabel } from '../../core/models/booking';
import { AdminSettingsComponent } from './admin-settings';
import { AdminLocalSchedule } from './admin-local-schedule';
import { AdminLocalBusiness } from './admin-local-business';
import { AdminLocalPricing } from './admin-local-pricing';
import { AdminKiosk } from './admin-kiosk';
import { AdminIncome } from './admin-income';
import { addDays, limaToday, longDate } from '../booking/calendar-utils';
import { clockLabel } from '../../core/models/booking';
import { Icon } from '../../shared/icon';
interface Overview {
  engine?: 'direct';
  pendingLimitReached?: boolean;
  name: string;
  reservations: Reservation[];
  courts: {
    maintenance?: boolean;
    status?: string;
    runtime?: {
      date?: string;
      reservationId: string;
      actualStartAt: number;
      estimatedEndAt: number;
    } | null;
    id: string;
    name: string;
    sport?: string;
    surface?: string;
    dayPriceCents: number;
    nightPriceCents: number;
  }[];
}
@Component({
  selector: 'gg-staff-dashboard',
  imports: [
    FormsModule,
    Icon,
    AdminSettingsComponent,
    AdminLocalSchedule,
    AdminLocalBusiness,
    AdminLocalPricing,
    AdminKiosk,
    AdminIncome,
  ],
  templateUrl: './staff-dashboard.html',
  styleUrl: './staff-dashboard.css',
})
export class StaffDashboard implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild(AdminLocalSchedule) localSchedule?: AdminLocalSchedule;
  @ViewChild(AdminLocalBusiness) localBusiness?: AdminLocalBusiness;
  @ViewChild(AdminLocalPricing) localPricing?: AdminLocalPricing;
  @ViewChild(AdminKiosk) localKiosk?: AdminKiosk;
  @ViewChild(AdminIncome) localIncome?: AdminIncome;
  private readonly auth = inject(AuthService);
  private readonly access = inject(AccessService);
  private readonly backend = inject(BookingService);
  private readonly firebase = inject(FirebaseService);
  private readonly router = inject(Router);
  private readonly host: ElementRef<HTMLElement> | null = inject(ElementRef, { optional: true });
  readonly portal = inject(ActivatedRoute).snapshot.data['portal'] as string;
  readonly tab = signal('reservas');
  readonly localSection = signal<'datos' | 'horarios' | 'precios'>('datos');
  readonly date = signal(limaToday());
  readonly courtFilter = signal('');
  readonly stateFilter = signal('');
  readonly clock = clockLabel;
  readonly today = limaToday;
  readonly tomorrow = () => addDays(limaToday(), 1);
  readonly dateLabel = longDate;
  readonly syncedAt = signal<number | null>(null);
  readonly stale = signal(false);
  private polling?: ReturnType<typeof setInterval>;
  private clockTick?: ReturnType<typeof setInterval>;
  readonly currentTime = signal(Date.now());
  private refreshing = false;
  private destroyed = false;
  private readonly directEstablishments = new Set<string>();
  private reviewVersion = 0;
  private dialogFocusKey = '';
  private previousFocus?: HTMLElement;
  private previousBodyOverflow?: string;
  ngAfterViewChecked(): void {
    if (!this.host || (!this.review() && !this.actionPrompt())) return;
    const prompt = this.actionPrompt();
    const key = prompt
      ? prompt.reservation.id + ':' + prompt.action
      : this.reviewVersion + ':' + this.rejecting();
    if (key === this.dialogFocusKey) return;
    const selector = prompt
      ? '#session-cancel'
      : this.rejecting()
        ? '.admin-reject-confirm button'
        : '#admin-review-close';
    const button = this.host.nativeElement.querySelector<HTMLButtonElement>(selector);
    if (button) {
      button.focus();
      this.dialogFocusKey = key;
    }
  }
  readonly actionPrompt = signal<{ reservation: Reservation; action: 'start' } | null>(null);
  readonly sessionError = signal('');
  paymentLabel(r: Reservation): string {
    return r.paymentStatus === 'verified'
      ? 'Validado'
      : r.status === 'rejected'
        ? 'No validado'
        : r.paymentStatus === 'submitted'
          ? 'Por validar'
          : 'Pendiente de comprobante';
  }
  serviceLabel(r: Reservation): string {
    return this.serviceState(r) === 'running'
      ? 'En juego'
      : this.serviceState(r) === 'completed'
        ? 'Finalizado'
        : this.status(r.status);
  }
  serviceState(r: Reservation): Reservation['serviceStatus'] {
    if (
      r.engine === 'direct' &&
      r.serviceStatus === 'running' &&
      r.actualStartAt &&
      this.currentTime() >= r.actualStartAt + 3600000
    )
      return 'completed';
    return r.serviceStatus;
  }
  endOfGame(r: Reservation): number | null {
    return r.actualEndAt || (r.actualStartAt ? r.actualStartAt + 3600000 : null);
  }
  courtInPlay(court: Overview['courts'][number]): boolean {
    return !!court.runtime && this.currentTime() < court.runtime.actualStartAt + 3600000;
  }
  count(state: string): number {
    return (this.overview()?.reservations || []).filter(
      (r) => this.serviceState(r) === state || r.status === state,
    ).length;
  }
  canStart(r: Reservation): boolean {
    return (
      r.status === 'confirmed' &&
      r.paymentStatus === 'verified' &&
      !r.serviceStatus &&
      r.date === limaToday() &&
      (r.startsAt || Infinity) <= this.currentTime() &&
      !this.overview()?.courts.some((court) => court.id === r.courtId && this.courtInPlay(court))
    );
  }
  async setTab(tab: string): Promise<void> {
    if (
      this.busy() ||
      !['reservas', 'pagos', 'canchas', 'configuracion', 'kiosko', 'ingresos'].includes(tab)
    )
      return;
    if (this.tab() === tab) return;
    if (!this.canLeaveSettings()) return;
    this.tab.set(tab);
    this.courtFilter.set('');
    this.stateFilter.set('');
    this.closeReview();
    this.overview.set(null);
    await this.initialize();
  }
  isDirectLocal(): boolean {
    return this.directEstablishments.has(this.selected()) || this.overview()?.engine === 'direct';
  }
  settingsSaving(): boolean {
    return (
      !!this.localSchedule?.isSaving() ||
      !!this.localBusiness?.isSaving() ||
      !!this.localPricing?.isSaving() ||
      !!this.localKiosk?.isSaving() ||
      !!this.localIncome?.isSaving()
    );
  }
  private canLeaveSettings(): boolean {
    if (this.settingsSaving()) return false;
    if (this.tab() === 'kiosko' || this.tab() === 'ingresos')
      return (
        !(this.localKiosk?.hasUnsavedChanges() || this.localIncome?.hasUnsavedChanges()) ||
        window.confirm('Tienes cambios sin guardar. ¿Quieres salir y descartarlos?')
      );
    if (this.tab() !== 'configuracion') return true;
    return (
      !(
        this.localSchedule?.hasUnsavedChanges() ||
        this.localBusiness?.hasUnsavedChanges() ||
        this.localPricing?.hasUnsavedChanges()
      ) || window.confirm('Tienes cambios sin guardar en Mi local. ¿Quieres salir y descartarlos?')
    );
  }
  setLocalSection(section: 'datos' | 'horarios' | 'precios'): void {
    if (section === this.localSection() || !this.canLeaveSettings()) return;
    this.localSection.set(section);
  }
  canLeavePage(): boolean {
    return !this.auth.user() || this.canLeaveSettings();
  }
  async selectEstablishment(id: string, control?: HTMLSelectElement): Promise<void> {
    // Si se cancela la salida, el selector también conserva el local actual.
    if (control) control.value = this.selected();
    if (
      this.busy() ||
      id === this.selected() ||
      !this.memberships().some((item) => item.establishmentId === id) ||
      !this.canLeaveSettings()
    )
      return;
    this.selected.set(id);
    if (control) control.value = id;
    this.overview.set(null);
    this.closeReview();
    this.courtFilter.set('');
    this.stateFilter.set('');
    await this.initialize();
  }
  async selectDate(date: string): Promise<void> {
    if (this.busy() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const instant = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) return;
    this.date.set(date);
    this.closeReview();
    await this.changeDate();
  }
  private currentView(
    establishmentId: string,
    date: string,
    tab: string,
    version: number,
  ): boolean {
    return (
      !this.destroyed &&
      establishmentId === this.selected() &&
      date === this.date() &&
      tab === this.tab() &&
      version === this.loadVersion
    );
  }
  private async loadOverview(
    establishmentId: string,
    date: string,
    tab: string,
  ): Promise<Overview> {
    if (tab === 'kiosko' || tab === 'ingresos') {
      const { doc, getDocFromServer } = await import('firebase/firestore');
      const venue = (
        await getDocFromServer(doc(await this.firebase.getDb(), 'establishments', establishmentId))
      ).data();
      if (venue?.['bookingEngine'] !== 'direct')
        throw new Error('Este local todavía no usa el kiosko conectado.');
      this.directEstablishments.add(establishmentId);
      return { engine: 'direct', name: venue['name'], reservations: [], courts: [] };
    }
    if (tab === 'pagos' && this.directEstablishments.has(establishmentId))
      return this.backend.call<Overview>('adminPendingProofs', { establishmentId });
    const result = await this.backend.call<Overview>('adminOverview', { establishmentId, date });
    if (result.engine === 'direct') {
      this.directEstablishments.add(establishmentId);
      if (tab === 'pagos')
        return this.backend.call<Overview>('adminPendingProofs', { establishmentId });
    }
    return result;
  }
  async refresh(): Promise<void> {
    if (this.refreshing || this.destroyed || this.busy() || this.loading() || !this.selected())
      return;
    this.refreshing = true;
    const establishmentId = this.selected(),
      date = this.date(),
      tab = this.tab(),
      version = this.loadVersion;
    try {
      const value = await this.loadOverview(establishmentId, date, tab);
      if (this.currentView(establishmentId, date, tab, version)) {
        this.overview.set(value);
        this.syncedAt.set(Date.now());
        this.stale.set(false);
      }
    } catch {
      if (this.currentView(establishmentId, date, tab, version)) this.stale.set(true);
    } finally {
      this.refreshing = false;
    }
  }
  async changeDate(): Promise<void> {
    this.overview.set(null);
    await this.initialize();
  }
  async refreshCurrent(): Promise<void> {
    if (!this.canLeaveSettings()) return;
    if (this.tab() === 'kiosko') await this.localKiosk?.load();
    else if (this.tab() === 'ingresos') await this.localIncome?.load();
    else await this.refresh();
  }
  async sessionAction(): Promise<void> {
    const prompt = this.actionPrompt();
    if (!prompt || this.busy()) return;
    this.busy.set(true);
    this.sessionError.set('');
    this.error.set('');
    try {
      await this.backend.call('recordSession', {
        reservationId: prompt.reservation.id,
        action: prompt.action,
      });
      this.closeSession();
      this.message.set(
        'Inicio registrado. El partido terminará automáticamente después de 60 minutos.',
      );
      await this.initialize();
    } catch (error) {
      this.sessionError.set(bookingError(error));
    } finally {
      this.busy.set(false);
    }
  }
  openSession(reservation: Reservation, action: 'start' = 'start'): void {
    if (this.busy() || !this.canStart(reservation)) return;
    const trigger = document.activeElement;
    this.closeReview();
    this.previousFocus = trigger instanceof HTMLElement ? trigger : undefined;
    this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.sessionError.set('');
    this.actionPrompt.set({ reservation, action });
  }
  closeSession(): void {
    this.actionPrompt.set(null);
    this.sessionError.set('');
    this.closeReview();
  }
  async maintenance(court: Overview['courts'][number]): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.backend.call('setCourtMaintenance', {
        establishmentId: this.selected(),
        courtId: court.id,
        maintenance: !court.maintenance,
      });
      this.message.set(
        court.maintenance
          ? 'Cancha abierta para nuevas reservas.'
          : 'Mantenimiento activado. Se bloquean nuevas reservas; las existentes se conservan.',
      );
      await this.initialize();
    } catch (error) {
      this.error.set(bookingError(error));
    } finally {
      this.busy.set(false);
    }
  }
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly memberships = signal<EstablishmentMembership[]>([]);
  readonly selected = signal('');
  readonly overview = signal<Overview | null>(null);
  readonly review = signal<Reservation | null>(null);
  readonly proofUrl = signal('');
  readonly proofLoading = signal(false);
  readonly reviewError = signal('');
  readonly rejecting = signal(false);
  verified = false;
  readonly money = money;
  readonly slot = slotLabel;
  readonly status = statusLabel;
  visibleRequests(): Reservation[] {
    return (this.overview()?.reservations || []).filter(
      (item) =>
        (this.tab() !== 'pagos' || item.status === 'pending_verification') &&
        (!this.courtFilter() || item.courtId === this.courtFilter()) &&
        (!this.stateFilter() ||
          item.status === this.stateFilter() ||
          item.serviceStatus === this.stateFilter()),
    );
  }
  ngOnInit(): void {
    this.clockTick = setInterval(() => this.currentTime.set(Date.now()), 1000);
    void this.initialize();
    this.polling = setInterval(() => {
      if (!document.hidden) void this.refresh();
    }, 10000);
  }
  private loadVersion = 0;
  async initialize(): Promise<void> {
    const version = ++this.loadVersion;
    const date = this.date(),
      tab = this.tab();
    this.loading.set(true);
    this.error.set('');
    try {
      const memberships = await this.access.memberships();
      if (version !== this.loadVersion || this.destroyed) return;
      this.memberships.set(memberships);
      if (!memberships.some((m) => m.establishmentId === this.selected()))
        this.selected.set(memberships[0]?.establishmentId || '');
      const establishmentId = this.selected();
      if (!establishmentId) {
        this.overview.set(null);
        this.error.set('No tienes un establecimiento activo asignado.');
        return;
      }
      const value = await this.loadOverview(establishmentId, date, tab);
      if (
        version !== this.loadVersion ||
        this.destroyed ||
        establishmentId !== this.selected() ||
        date !== this.date() ||
        tab !== this.tab()
      )
        return;
      this.overview.set(value);
      this.syncedAt.set(Date.now());
      this.stale.set(false);
    } catch (error) {
      if (version === this.loadVersion) {
        this.error.set(bookingError(error));
        this.stale.set(true);
        this.overview.set(null);
      }
    } finally {
      if (version === this.loadVersion) this.loading.set(false);
    }
  }
  async openReview(reservation: Reservation): Promise<void> {
    const trigger = document.activeElement;
    this.closeReview();
    this.previousFocus = trigger instanceof HTMLElement ? trigger : undefined;
    this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const version = this.reviewVersion;
    this.review.set(reservation);
    this.verified = false;
    if (!reservation.proofPath) {
      this.reviewError.set(
        'Esta solicitud no tiene un comprobante disponible. Actualiza la lista.',
      );
      return;
    }
    this.proofLoading.set(true);
    try {
      const blob = await this.backend.readProof(reservation.proofPath);
      if (!this.destroyed && version === this.reviewVersion && this.review()?.id === reservation.id)
        this.proofUrl.set(URL.createObjectURL(blob));
    } catch {
      if (version === this.reviewVersion && !this.destroyed)
        this.reviewError.set(
          'No pudimos abrir la foto. Vuelve a cargarla antes de confirmar el pago.',
        );
    } finally {
      if (version === this.reviewVersion) this.proofLoading.set(false);
    }
  }
  async proofReload(): Promise<void> {
    const reservation = this.review();
    if (reservation && !this.busy()) await this.openReview(reservation);
  }
  @HostListener('document:keydown', ['$event'])
  closeDialogWithEscape(event: Event): void {
    if (!this.review() && !this.actionPrompt()) return;
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Escape' && !this.busy()) {
      keyboard.preventDefault();
      if (this.actionPrompt()) this.closeSession();
      else this.closeReview();
    } else if (keyboard.key === 'Tab' && this.host) {
      const dialog = this.host.nativeElement.querySelector('[role="dialog"]');
      const controls = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled])',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (!first || !last) return;
      if (
        !dialog?.contains(document.activeElement) ||
        (!keyboard.shiftKey && document.activeElement === last)
      ) {
        keyboard.preventDefault();
        first.focus();
      } else if (keyboard.shiftKey && document.activeElement === first) {
        keyboard.preventDefault();
        last.focus();
      }
    }
  }
  closeReview(): void {
    ++this.reviewVersion;
    if (this.proofUrl()) URL.revokeObjectURL(this.proofUrl());
    this.proofUrl.set('');
    this.review.set(null);
    this.proofLoading.set(false);
    this.reviewError.set('');
    this.rejecting.set(false);
    this.verified = false;
    this.dialogFocusKey = '';
    if (this.previousBodyOverflow !== undefined) {
      document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = undefined;
    }
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = undefined;
  }
  private reviewIsCurrent(reservation: Reservation): boolean {
    if (
      reservation.status === 'pending_verification' &&
      (!reservation.expiresAt || reservation.expiresAt > Date.now())
    )
      return true;
    this.reviewError.set(
      'La solicitud venció o ya fue revisada. Cierra este cuadro y actualiza la lista.',
    );
    return false;
  }
  async confirmPayment(): Promise<void> {
    const reservation = this.review();
    if (
      !reservation ||
      !this.verified ||
      this.busy() ||
      this.proofLoading() ||
      !this.proofUrl() ||
      this.rejecting() ||
      !this.reviewIsCurrent(reservation)
    )
      return;
    this.busy.set(true);
    this.reviewError.set('');
    try {
      await this.backend.call('reviewPayment', {
        reservationId: reservation.id,
        action: 'confirm',
        paymentVerified: true,
        amountCents: reservation.advanceCents,
      });
      this.closeReview();
      this.message.set('Adelanto verificado y reserva confirmada.');
      await this.initialize();
    } catch (error) {
      this.reviewError.set(bookingError(error));
    } finally {
      this.busy.set(false);
    }
  }
  async rejectPayment(): Promise<void> {
    const reservation = this.review();
    if (
      !reservation ||
      this.busy() ||
      !this.rejecting() ||
      this.proofLoading() ||
      !this.reviewIsCurrent(reservation)
    )
      return;
    this.busy.set(true);
    this.reviewError.set('');
    try {
      await this.backend.call('reviewPayment', { reservationId: reservation.id, action: 'reject' });
      this.closeReview();
      this.message.set('Solicitud rechazada. El horario está disponible nuevamente.');
      await this.initialize();
    } catch (error) {
      this.reviewError.set(bookingError(error));
    } finally {
      this.busy.set(false);
    }
  }
  async logout(): Promise<void> {
    if (this.busy() || !this.canLeaveSettings()) return;
    try {
      await this.auth.logout();
      await this.router.navigateByUrl(
        this.portal === 'admin' ? '/admin/ingresar' : '/superadmin/ingresar',
      );
    } catch (error) {
      this.error.set(bookingError(error));
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    clearInterval(this.polling);
    clearInterval(this.clockTick);
    this.closeReview();
  }
}
