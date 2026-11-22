import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BookingService, bookingError } from '../../core/services/booking.service';
import {
  Availability,
  BookingSlot,
  PILOT,
  Reservation,
  money,
  slotLabel,
  clockLabel,
  statusLabel,
} from '../../core/models/booking';
import {
  BusinessCatalogService,
  PublicBusiness,
  PublicCourt,
} from '../../core/services/business-catalog.service';
import { BusinessImage } from '../../shared/business-image';
import { ReservationShare } from '../../shared/reservation-share';
import { Icon } from '../../shared/icon';
import { addDays, calendarDays, limaToday, longDate } from './calendar-utils';

@Component({
  selector: 'gg-booking-flow',
  imports: [RouterLink, Icon, BusinessImage, ReservationShare],
  templateUrl: './booking-flow.html',
})
export class BookingFlow implements OnDestroy, OnInit {
  private readonly booking = inject(BookingService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(BusinessCatalogService);
  private readonly changes = inject(ChangeDetectorRef, { optional: true });
  private readonly establishmentId = this.route.snapshot.paramMap.get('establishmentId') || '';
  private readonly courtId = this.route.snapshot.paramMap.get('courtId') || '';
  readonly metadataLoading = signal(true);
  readonly weeklyDays = signal<number[] | null>(null);
  valid = false;
  venue = { ...PILOT };
  court: PublicCourt | null = null;
  readonly money = money;
  readonly slotLabel = slotLabel;
  readonly clock = clockLabel;
  readonly scheduleStale = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  private clockTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private destroyed = false;
  private unsubscribeCatalog?: () => void;
  private metadataEpoch = 0;
  private catalogKey = '';
  private metadataFailed = false;
  private refreshAgain = false;
  async refreshSchedule(): Promise<void> {
    if (this.refreshing || this.busy() || !this.valid || ![2, 3].includes(this.step())) return;
    this.refreshing = true;
    const date = this.date();
    const epoch = this.metadataEpoch;
    try {
      const value = await this.booking.availability(this.establishmentId, this.courtId, date);
      if (
        this.destroyed ||
        epoch !== this.metadataEpoch ||
        !this.valid ||
        date !== this.date() ||
        ![2, 3].includes(this.step())
      )
        return;
      this.availability.set(value);
      this.scheduleStale.set(false);
      this.preview.set(false);
      this.error.set('');
      if (
        this.hour() !== null &&
        !value.slots.some((slot) => slot.hour === this.hour() && slot.available)
      ) {
        this.hour.set(null);
        this.step.set(2);
        this.error.set('La agenda cambió. Elige un horario disponible de la lista actualizada.');
      }
    } catch {
      if (!this.destroyed) this.scheduleStale.set(true);
    } finally {
      this.refreshing = false;
      if (this.refreshAgain && !this.destroyed && !this.busy()) {
        this.refreshAgain = false;
        void this.refreshSchedule();
      }
    }
  }
  private acceptMetadata(items: PublicBusiness[]): void {
    if (this.destroyed) return;
    const local = items.find((item) => item.id === this.establishmentId);
    const court = local?.courts.find((item) => item.id === this.courtId);
    const nextKey = JSON.stringify(local || null);
    const changed = nextKey !== this.catalogKey;
    if (changed) {
      this.catalogKey = nextKey;
      ++this.metadataEpoch;
    }
    if (local && court) {
      const days = Array.isArray(local.days) ? local.days : [];
      this.weeklyDays.set(local.scheduleRevision || days.length ? [...days] : null);
      this.court = court;
      this.venue = {
        ...PILOT,
        ...local,
        image: court.images[0] || (local.id === 'el-puma' ? '/assets/login-estadio.png' : ''),
        referenceImage: !court.images.length,
        dayPriceCents: court.dayPriceCents,
        nightPriceCents: court.nightPriceCents,
        nightStartsAt: court.nightStartsAt,
      };
      this.valid = true;
      if (this.metadataFailed) {
        this.error.set('');
        this.metadataFailed = false;
      }
      if (this.step() === 1 && this.isWeeklyClosed(this.date())) {
        this.error.set('El local no atiende este día. Elige otra fecha.');
      } else if (this.error() === 'El local no atiende este día. Elige otra fecha.') {
        this.error.set('');
      }
      if (changed && [2, 3].includes(this.step())) {
        this.scheduleStale.set(true);
        if (this.refreshing || this.busy()) this.refreshAgain = true;
        else void this.refreshSchedule();
      }
    } else if (this.reservation()) {
      this.weeklyDays.set(null);
      this.restoreReservationMetadata(this.reservation()!);
    } else {
      this.weeklyDays.set(null);
      this.valid = false;
      this.court = null;
      this.availability.set(null);
      this.scheduleStale.set(true);
    }
    this.metadataLoading.set(false);
    this.changes?.markForCheck();
  }
  private metadataError(): void {
    if (this.destroyed) return;
    this.metadataFailed = true;
    if (!this.reservation()) {
      this.valid = false;
      this.court = null;
      this.availability.set(null);
      this.scheduleStale.set(true);
    }
    this.error.set(
      'No pudimos actualizar los datos de esta cancha. Vuelve a consultarla desde Canchas.',
    );
    this.metadataLoading.set(false);
    this.changes?.markForCheck();
  }
  private restoreReservationMetadata(reservation: Reservation): void {
    this.venue = {
      ...PILOT,
      id: reservation.establishmentId,
      name: reservation.establishmentName,
      location: '',
      image: '',
      advanceCents: reservation.advanceCents,
      dayPriceCents: reservation.totalCents,
      nightPriceCents: reservation.totalCents,
      nightStartsAt: reservation.hour,
      courts: [{ id: reservation.courtId, name: reservation.courtName, sport: '' }],
    };
    this.court = {
      id: reservation.courtId,
      name: reservation.courtName,
      sport: '',
      surface: '',
      images: [],
      dayPriceCents: reservation.totalCents,
      nightPriceCents: reservation.totalCents,
      nightStartsAt: reservation.hour,
    };
    this.valid = true;
  }
  readonly longDate = longDate;
  readonly today = limaToday();
  readonly lastDate = addDays(this.today, 90);
  readonly step = signal(1);
  readonly date = signal(this.today);
  readonly month = signal(this.today.slice(0, 7));
  readonly hour = signal<number | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly preview = signal(false);
  readonly availability = signal<Availability | null>(null);
  readonly reservation = signal<Reservation | null>(null);
  readonly file = signal<File | null>(null);
  readonly fileUrl = signal('');
  readonly fileError = signal('');
  readonly proofSent = signal(false);
  readonly currentTime = signal(Date.now());
  readonly expired = computed(() => {
    const item = this.reservation();
    return (
      item?.status === 'expired' ||
      !!(
        item &&
        ['pending_payment', 'pending_verification'].includes(item.status) &&
        item.expiresAt &&
        item.expiresAt <= this.currentTime()
      )
    );
  });
  readonly canUpload = computed(
    () => this.reservation()?.status === 'pending_payment' && !this.expired(),
  );
  readonly reservationStatus = computed(() =>
    this.expired()
      ? 'Solicitud vencida'
      : this.reservation()
        ? statusLabel(this.reservation()!.status)
        : 'Solicitud de reserva',
  );
  readonly expirationLabel = computed(() => {
    const expiresAt = this.reservation()?.expiresAt;
    return expiresAt
      ? new Intl.DateTimeFormat('es-PE', {
          timeZone: 'America/Lima',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(expiresAt))
      : '';
  });
  readonly cells = computed(() => calendarDays(this.month()));
  readonly monthLabel = computed(() =>
    new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${this.month()}-01T12:00:00Z`),
    ),
  );
  readonly slots = computed(() => this.availability()?.slots || []);
  readonly groups = [
    { title: 'Madrugada', subtitle: '00:00 – 06:00', from: 0, to: 6 },
    { title: 'Mañana', subtitle: '06:00 – 12:00', from: 6, to: 12 },
    { title: 'Tarde', subtitle: '12:00 – 18:00', from: 12, to: 18 },
    { title: 'Noche', subtitle: '18:00 – 00:00', from: 18, to: 24 },
  ];
  readonly price = computed(
    () => this.slots().find((slot) => slot.hour === this.hour())?.priceCents || 0,
  );
  readonly total = computed(() => this.reservation()?.totalCents ?? this.price());
  readonly paymentMode = computed(
    () => this.reservation()?.paymentSnapshot?.mode || this.availability()?.paymentMode,
  );
  readonly qr = computed(() =>
    this.paymentMode() === 'live'
      ? this.reservation()?.paymentSnapshot?.qr || this.availability()?.paymentQr || ''
      : this.paymentMode() === 'demo'
        ? '/assets/demo-payment-qr.svg'
        : '',
  );
  readonly paymentMethods = computed(() =>
    (
      this.reservation()?.paymentSnapshot?.methods ||
      this.availability()?.paymentMethods || ['Yape', 'Plin']
    ).join(' o '),
  );
  readonly paymentRecipient = computed(
    () =>
      this.reservation()?.paymentSnapshot?.recipient || this.availability()?.paymentRecipient || '',
  );
  readonly paymentPhone = computed(
    () => this.reservation()?.paymentSnapshot?.phone || this.availability()?.paymentPhone || '',
  );
  private requestId = crypto.randomUUID();
  async ngOnInit(): Promise<void> {
    this.timer = setInterval(() => {
      if (!document.hidden) {
        void this.refreshSchedule();
        if (this.step() === 4) void this.refreshReservation();
      }
    }, 10000);
    this.clockTimer = setInterval(() => this.currentTime.set(Date.now()), 1000);
    try {
      const stop = await this.catalog.observe(
        (items) => this.acceptMetadata(items),
        () => this.metadataError(),
      );
      if (this.destroyed) {
        stop();
        return;
      }
      this.unsubscribeCatalog = stop;
    } catch {
      this.metadataError();
    }

    if (this.destroyed) return;

    const reservationId = this.route.snapshot.queryParamMap.get('solicitud');
    if (!reservationId) return;
    this.busy.set(true);
    try {
      const reservation = (await this.booking.mine()).find(
        (item) =>
          item.id === reservationId &&
          item.establishmentId === this.establishmentId &&
          item.courtId === this.courtId,
      );
      if (this.destroyed) return;
      if (!reservation) throw new Error('No encontramos la solicitud.');
      if (!this.valid) {
        this.restoreReservationMetadata(reservation);
      }
      this.error.set('');
      this.reservation.set(reservation);
      this.date.set(reservation.date);
      this.hour.set(reservation.hour);
      this.proofSent.set(reservation.paymentStatus !== 'unpaid');
      this.step.set(4);
    } catch {
      this.error.set('No pudimos retomar esa solicitud. Consulta su estado en Mis reservas.');
    } finally {
      this.busy.set(false);
    }
  }
  monthChange(delta: number): void {
    const current = new Date(`${this.month()}-01T12:00:00Z`);
    current.setUTCMonth(current.getUTCMonth() + delta);
    const next = current.toISOString().slice(0, 7);
    if (next >= this.today.slice(0, 7) && next <= this.lastDate.slice(0, 7)) this.month.set(next);
  }
  isWeeklyClosed(date: string): boolean {
    const days = this.weeklyDays();
    if (days === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const instant = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date)
      return false;
    return !days.includes(instant.getUTCDay());
  }
  chooseDate(date: string): void {
    if (this.isWeeklyClosed(date)) {
      this.error.set('El local no atiende este día. Elige otra fecha.');
      return;
    }
    this.date.set(date);
    this.hour.set(null);
    this.availability.set(null);
    this.error.set('');
    this.scheduleStale.set(false);
    this.requestId = crypto.randomUUID();
  }
  groupSlots(from: number, to: number): BookingSlot[] {
    return this.slots().filter((slot) => slot.hour >= from && slot.hour < to);
  }
  isPast(hour: number): boolean {
    return (
      new Date(`${this.date()}T${String(hour).padStart(2, '0')}:00:00-05:00`).getTime() <=
      Date.now()
    );
  }
  async confirmDate(): Promise<void> {
    if (this.busy()) return;
    if (this.isWeeklyClosed(this.date())) {
      this.error.set('El local no atiende este día. Elige otra fecha.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.hour.set(null);
    const date = this.date();
    const epoch = this.metadataEpoch;
    try {
      const value = await this.booking.availability(this.establishmentId, this.courtId, date);
      if (date !== this.date() || this.destroyed || epoch !== this.metadataEpoch) {
        this.refreshAgain = true;
        return;
      }
      this.availability.set(value);
      this.preview.set(false);
      this.scheduleStale.set(false);
    } catch (error) {
      if (date !== this.date() || this.destroyed) return;
      this.availability.set(null);
      this.preview.set(true);
      this.scheduleStale.set(true);
      this.error.set(bookingError(error));
    } finally {
      this.busy.set(false);
      if (date === this.date() && !this.destroyed) this.step.set(2);
      if (this.refreshAgain && !this.destroyed) {
        this.refreshAgain = false;
        void this.refreshSchedule();
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  selectHour(hour: number): void {
    if (
      this.scheduleStale() ||
      !this.slots().some((slot) => slot.hour === hour && slot.available) ||
      this.isPast(hour)
    )
      return;
    this.hour.set(hour);
    this.error.set('');
    this.requestId = crypto.randomUUID();
  }
  confirmHour(): void {
    const hour = this.hour();
    if (
      hour === null ||
      this.scheduleStale() ||
      this.preview() ||
      this.isPast(hour) ||
      !this.slots().some((slot) => slot.hour === hour && slot.available)
    )
      return;
    this.step.set(3);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  async create(): Promise<void> {
    const hour = this.hour();
    if (
      this.preview() ||
      this.scheduleStale() ||
      hour === null ||
      this.busy() ||
      this.isPast(hour) ||
      !this.slots().some((slot) => slot.hour === hour && slot.available)
    )
      return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.reservation.set(
        await this.booking.create(
          this.establishmentId,
          this.courtId,
          this.date(),
          hour,
          this.requestId,
        ),
      );
      this.step.set(4);
      void this.router
        .navigate([], {
          relativeTo: this.route,
          queryParams: { solicitud: this.reservation()!.id },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        })
        .catch(() => {});
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (error) {
      this.error.set(bookingError(error));
    } finally {
      this.busy.set(false);
    }
  }
  chooseFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.fileError.set('');
    if (this.fileUrl()) URL.revokeObjectURL(this.fileUrl());
    this.file.set(null);
    this.fileUrl.set('');
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size === 0 ||
      file.size > 5 * 1024 * 1024
    ) {
      this.fileError.set('Elige una imagen JPG, PNG o WebP de hasta 5 MB.');
      input.value = '';
      return;
    }
    this.file.set(file);
    this.fileUrl.set(URL.createObjectURL(file));
  }
  async sendProof(): Promise<void> {
    const file = this.file();
    const reservation = this.reservation();
    this.currentTime.set(Date.now());
    if (!file || !reservation || this.busy() || !this.canUpload()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.booking.submitProof(reservation, file);
      this.reservation.set({
        ...reservation,
        status: 'pending_verification',
        paymentStatus: 'submitted',
      });
      this.proofSent.set(true);
    } catch (error) {
      this.error.set(bookingError(error));
    } finally {
      this.busy.set(false);
    }
  }
  async refreshReservation(): Promise<void> {
    const current = this.reservation();
    if (!current || this.busy() || this.refreshing || this.destroyed) return;
    this.refreshing = true;
    try {
      const item = (await this.booking.mine()).find((item) => item.id === current.id);
      if (item && !this.destroyed) {
        this.reservation.set(item);
        this.proofSent.set(item.paymentStatus !== 'unpaid');
        this.error.set('');
      }
    } catch (error) {
      if (!this.destroyed) this.error.set(bookingError(error));
    } finally {
      this.refreshing = false;
      this.currentTime.set(Date.now());
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    clearInterval(this.timer);
    clearInterval(this.clockTimer);
    this.unsubscribeCatalog?.();
    if (this.fileUrl()) URL.revokeObjectURL(this.fileUrl());
  }
}
