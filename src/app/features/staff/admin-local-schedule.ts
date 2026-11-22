import {
  Component,
  HostListener,
  OnChanges,
  OnDestroy,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EstablishmentScheduleService } from '../../core/services/establishment-schedule.service';
import { DateClosure, WeeklySchedule } from '../../core/models/establishment-schedule';
import { bookingError } from '../../core/services/booking.service';
import { limaToday, longDate } from '../booking/calendar-utils';
import { Icon } from '../../shared/icon';

const emptySchedule = (): WeeklySchedule => ({
  days: [0, 1, 2, 3, 4, 5, 6],
  openHour: null,
  closeHour: null,
  revision: 0,
});
const scheduleKey = (value: WeeklySchedule): string =>
  JSON.stringify([[...value.days].sort(), value.openHour, value.closeHour]);
const validDate = (date: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date + 'T00:00:00-05:00')) &&
  new Date(Date.parse(date + 'T00:00:00-05:00') - 5 * 3600000).toISOString().slice(0, 10) === date;

@Component({
  selector: 'gg-admin-local-schedule',
  imports: [FormsModule, Icon],
  templateUrl: './admin-local-schedule.html',
  styleUrl: './admin-local-schedule.css',
})
export class AdminLocalSchedule implements OnChanges, OnDestroy {
  readonly establishmentId = input.required<string>();
  private readonly service = inject(EstablishmentScheduleService);
  readonly name = signal('');
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly checkingDate = signal(false);
  readonly listLoading = signal(false);
  readonly loadError = signal('');
  readonly weeklyError = signal('');
  readonly weeklyMessage = signal('');
  readonly closureError = signal('');
  readonly closureMessage = signal('');
  readonly listError = signal('');
  readonly closures = signal<DateClosure[]>([]);
  readonly closureLimitReached = signal(false);
  readonly pendingClosure = signal<DateClosure | null>(null);
  readonly reopening = signal<DateClosure | null>(null);
  readonly today = limaToday;
  readonly dateLabel = longDate;
  readonly hours = Array.from({ length: 24 }, (_, hour) => hour);
  readonly closingHours = Array.from({ length: 24 }, (_, hour) => hour + 1);
  readonly weekdays = [
    { id: 1, name: 'Lunes' },
    { id: 2, name: 'Martes' },
    { id: 3, name: 'Miércoles' },
    { id: 4, name: 'Jueves' },
    { id: 5, name: 'Viernes' },
    { id: 6, name: 'Sábado' },
    { id: 0, name: 'Domingo' },
  ];
  weekly = emptySchedule();
  closureDate = '';
  closureReason = '';
  private savedWeekly = '';
  private selectedClosure: DateClosure | null = null;
  private loadedDate = '';
  private savedReason = '';
  private version = 0;
  private dateVersion = 0;
  private listVersion = 0;
  private destroyed = false;

  ngOnChanges(): void {
    void this.load();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.version;
    ++this.dateVersion;
    ++this.listVersion;
  }
  private current(id: string, version: number): boolean {
    return !this.destroyed && id === this.establishmentId() && version === this.version;
  }
  async load(): Promise<void> {
    const id = this.establishmentId(),
      version = ++this.version;
    ++this.dateVersion;
    ++this.listVersion;
    this.loading.set(true);
    this.busy.set(false);
    this.listLoading.set(false);
    this.loadError.set('');
    this.weeklyError.set('');
    this.weeklyMessage.set('');
    this.closureError.set('');
    this.closureMessage.set('');
    this.listError.set('');
    this.weekly = emptySchedule();
    this.savedWeekly = '';
    this.closureDate = '';
    this.closureReason = '';
    this.selectedClosure = null;
    this.loadedDate = '';
    this.savedReason = '';
    this.pendingClosure.set(null);
    this.reopening.set(null);
    this.checkingDate.set(false);
    try {
      const data = await this.service.load(id);
      if (!this.current(id, version)) return;
      this.name.set(data.name);
      this.weekly = { ...data.schedule, days: [...data.schedule.days] };
      this.savedWeekly = scheduleKey(this.weekly);
      this.closures.set(this.upcoming(data.closures));
      this.closureLimitReached.set(!!data.closureLimitReached || data.closures.length >= 100);
    } catch (error) {
      if (this.current(id, version)) this.loadError.set(bookingError(error));
    } finally {
      if (this.current(id, version)) this.loading.set(false);
    }
  }
  private upcoming(items: DateClosure[]): DateClosure[] {
    return items
      .filter((item) => item.closed && item.date >= limaToday())
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  hour(value: number): string {
    return value === 24 ? '24:00 · medianoche' : String(value).padStart(2, '0') + ':00';
  }
  toggleDay(day: number): void {
    if (this.busy()) return;
    this.weekly.days = this.weekly.days.includes(day)
      ? this.weekly.days.filter((item) => item !== day)
      : [...this.weekly.days, day];
    this.weeklyMessage.set('');
  }
  selectAllDays(selected: boolean): void {
    if (!this.busy()) {
      this.weekly.days = selected ? [0, 1, 2, 3, 4, 5, 6] : [];
      this.weeklyMessage.set('');
    }
  }
  weeklySummary(): string {
    if (!this.weekly.days.length) return 'Todos los días estarán cerrados para nuevas solicitudes.';
    if (this.weekly.openHour === null || this.weekly.closeHour === null)
      return 'Elige la apertura y el cierre para completar tu horario.';
    const days =
      this.weekly.days.length === 7
        ? 'Todos los días'
        : this.weekdays
            .filter((day) => this.weekly.days.includes(day.id))
            .map((day) => day.name)
            .join(', ');
    return (
      days + ' · ' + this.hour(this.weekly.openHour) + ' a ' + this.hour(this.weekly.closeHour)
    );
  }
  hasUnsavedChanges(): boolean {
    return (
      !!this.pendingClosure() ||
      !!this.reopening() ||
      (!!this.savedWeekly && scheduleKey(this.weekly) !== this.savedWeekly) ||
      this.closureReason.trim() !== this.savedReason
    );
  }
  isSaving(): boolean {
    return this.busy();
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: Event): void {
    if (this.busy() || this.hasUnsavedChanges()) {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = '';
    }
  }
  async saveWeekly(): Promise<void> {
    if (this.busy() || this.loading()) return;
    this.weeklyError.set('');
    this.weeklyMessage.set('');
    if (
      !Number.isInteger(this.weekly.openHour) ||
      !Number.isInteger(this.weekly.closeHour) ||
      this.weekly.openHour === null ||
      this.weekly.closeHour === null ||
      this.weekly.openHour < 0 ||
      this.weekly.closeHour > 24 ||
      this.weekly.openHour >= this.weekly.closeHour
    ) {
      this.weeklyError.set(
        'Elige la apertura y un cierre posterior. Por ejemplo, cerrar a medianoche se indica como 24:00.',
      );
      return;
    }
    const id = this.establishmentId(),
      version = this.version;
    const values = { ...this.weekly, days: [...this.weekly.days] };
    this.busy.set(true);
    try {
      const saved = await this.service.saveWeekly(id, values);
      if (!this.current(id, version)) return;
      this.weekly = { ...saved, days: [...saved.days] };
      this.savedWeekly = scheduleKey(saved);
      this.weeklyMessage.set('Horario guardado. Se aplicará a las nuevas solicitudes.');
    } catch (error) {
      if (this.current(id, version)) this.weeklyError.set(bookingError(error));
    } finally {
      if (this.current(id, version)) this.busy.set(false);
    }
  }
  async chooseClosureDate(date: string): Promise<void> {
    if (this.busy()) return;
    const request = ++this.dateVersion,
      id = this.establishmentId(),
      version = this.version;
    this.closureDate = date;
    this.closureReason = '';
    this.savedReason = '';
    this.selectedClosure = null;
    this.loadedDate = '';
    this.pendingClosure.set(null);
    this.closureError.set('');
    this.closureMessage.set('');
    if (!date) {
      this.checkingDate.set(false);
      return;
    }
    if (!validDate(date) || date < limaToday()) {
      this.checkingDate.set(false);
      this.closureError.set('Elige hoy o una fecha futura válida.');
      return;
    }
    this.checkingDate.set(true);
    try {
      const saved = await this.service.getClosure(id, date);
      if (!this.current(id, version) || request !== this.dateVersion || date !== this.closureDate)
        return;
      this.selectedClosure = saved;
      this.loadedDate = date;
      this.closureReason = saved?.reason || '';
      this.savedReason = this.closureReason.trim();
    } catch (error) {
      if (this.current(id, version) && request === this.dateVersion)
        this.closureError.set(bookingError(error));
    } finally {
      if (this.current(id, version) && request === this.dateVersion) this.checkingDate.set(false);
    }
  }
  reviewClosure(): void {
    if (this.busy() || this.checkingDate()) return;
    this.closureError.set('');
    this.closureMessage.set('');
    if (
      !validDate(this.closureDate) ||
      this.closureDate < limaToday() ||
      this.loadedDate !== this.closureDate
    ) {
      this.closureError.set('Primero elige una fecha y espera a que termine su consulta.');
      return;
    }
    if (this.closureReason.trim().length > 160) {
      this.closureError.set('Escribe un motivo de hasta 160 caracteres.');
      return;
    }
    if (this.selectedClosure?.closed && this.closureReason.trim() === this.savedReason) {
      this.closureError.set(
        'Esta fecha ya está cerrada. Puedes quitar su cierre en la lista de abajo.',
      );
      return;
    }
    this.pendingClosure.set({
      date: this.closureDate,
      dateStart: Date.parse(this.closureDate + 'T00:00:00-05:00'),
      closed: true,
      reason: this.closureReason.trim(),
      revision: this.selectedClosure?.revision || 0,
    });
  }
  async confirmClosure(): Promise<void> {
    const pending = this.pendingClosure();
    if (!pending || this.busy()) return;
    await this.persistClosure(pending, false);
  }
  async confirmReopen(): Promise<void> {
    const pending = this.reopening();
    if (!pending || this.busy()) return;
    await this.persistClosure({ ...pending, closed: false }, true);
  }
  private async persistClosure(value: DateClosure, reopen: boolean): Promise<void> {
    const id = this.establishmentId(),
      version = this.version;
    this.busy.set(true);
    this.closureError.set('');
    this.listError.set('');
    this.closureMessage.set('');
    try {
      const saved = await this.service.saveClosure(id, value);
      if (!this.current(id, version)) return;
      this.closures.set(
        this.upcoming([...this.closures().filter((item) => item.date !== saved.date), saved]),
      );
      if (saved.date === this.closureDate) {
        this.selectedClosure = saved;
        this.loadedDate = saved.date;
        this.savedReason = saved.reason.trim();
      }
      this.pendingClosure.set(null);
      this.reopening.set(null);
      this.closureMessage.set(
        reopen
          ? 'Cierre quitado. Se volverá a aplicar el horario habitual.'
          : 'Fecha cerrada para nuevas reservas. Las reservas existentes se mantienen.',
      );
      void this.refreshClosures();
    } catch (error) {
      if (this.current(id, version))
        (reopen ? this.listError : this.closureError).set(bookingError(error));
    } finally {
      if (this.current(id, version)) this.busy.set(false);
    }
  }
  async refreshClosures(): Promise<void> {
    const id = this.establishmentId(),
      version = this.version,
      request = ++this.listVersion;
    this.listLoading.set(true);
    this.listError.set('');
    try {
      const data = await this.service.load(id);
      if (this.current(id, version) && request === this.listVersion) {
        this.closures.set(this.upcoming(data.closures));
        this.closureLimitReached.set(!!data.closureLimitReached || data.closures.length >= 100);
      }
    } catch (error) {
      if (this.current(id, version) && request === this.listVersion)
        this.listError.set('No pudimos actualizar las fechas. Vuelve a consultar la lista.');
    } finally {
      if (this.current(id, version) && request === this.listVersion) this.listLoading.set(false);
    }
  }
}
