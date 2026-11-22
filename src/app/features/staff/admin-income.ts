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
import { BusinessIncomeService } from '../../core/services/business-income.service';
import {
  BusinessIncomeReport,
  CourtIncome,
  IncomeMethod,
  IncomePeriod,
} from '../../core/models/business-income';
import { money, hourLabel, clockLabel } from '../../core/models/booking';
import { kioskError } from '../../core/services/kiosk.service';
import { addDays, limaToday, longDate } from '../booking/calendar-utils';

@Component({
  selector: 'gg-admin-income',
  imports: [FormsModule],
  templateUrl: './admin-income.html',
  styleUrl: './admin-income.css',
})
export class AdminIncome implements OnChanges, OnDestroy {
  readonly establishmentId = input.required<string>();
  readonly context = input<'local' | 'platform'>('local');
  private readonly service = inject(BusinessIncomeService);
  readonly period = signal<IncomePeriod>('day');
  readonly date = signal(limaToday());
  readonly report = signal<BusinessIncomeReport | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly pending = signal<CourtIncome | null>(null);
  readonly visibleSales = signal(20);
  readonly visibleBalances = signal(10);
  method: IncomeMethod | '' = '';
  received = false;
  readonly money = money;
  readonly hour = hourLabel;
  readonly clock = clockLabel;
  readonly longDate = longDate;
  readonly todayOf = (time: number) => limaToday(new Date(time));
  private version = 0;
  private destroyed = false;
  private timer?: ReturnType<typeof setInterval>;
  ngOnChanges(): void {
    this.pending.set(null);
    this.method = '';
    this.received = false;
    this.report.set(null);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!document.hidden && !this.busy() && !this.loading()) void this.load();
    }, 30000);
    void this.load();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.version;
    if (this.timer) clearInterval(this.timer);
  }
  isSaving(): boolean {
    return this.busy();
  }
  hasUnsavedChanges(): boolean {
    return this.pending() !== null;
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: Event): void {
    if (this.isSaving() || this.hasUnsavedChanges()) {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = '';
    }
  }
  private canChange(): boolean {
    if (this.busy()) return false;
    if (this.pending() && !window.confirm('Tienes un cobro sin registrar. ¿Quieres descartarlo?'))
      return false;
    this.pending.set(null);
    return true;
  }
  async setPeriod(period: IncomePeriod): Promise<void> {
    if (period === this.period() || !this.canChange()) return;
    this.period.set(period);
    this.visibleSales.set(20);
    this.visibleBalances.set(10);
    await this.load();
  }
  async setDate(value: string): Promise<void> {
    if (!value || !this.canChange()) return;
    this.date.set(value);
    await this.load();
  }
  async move(direction: number): Promise<void> {
    let value: string;
    if (this.period() === 'month') {
      const date = new Date(this.date().slice(0, 7) + '-01T12:00:00Z');
      date.setUTCMonth(date.getUTCMonth() + direction);
      value = date.toISOString().slice(0, 10);
    } else value = addDays(this.date(), direction * (this.period() === 'week' ? 7 : 1));
    await this.setDate(value);
  }
  async load(): Promise<void> {
    const version = ++this.version,
      id = this.establishmentId();
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await this.service.report(id, this.period(), this.date());
      if (!this.destroyed && version === this.version && id === this.establishmentId())
        this.report.set(result);
    } catch (error) {
      if (!this.destroyed && version === this.version) {
        this.report.set(null);
        this.error.set(kioskError(error));
      }
    } finally {
      if (!this.destroyed && version === this.version) this.loading.set(false);
    }
  }
  periodEnd(exclusive: string): string {
    return addDays(exclusive, -1);
  }
  labelMethod(method: IncomeMethod): string {
    return { cash: 'Efectivo', yape: 'Yape', plin: 'Plin' }[method];
  }
  openBalance(value: CourtIncome): void {
    if (this.busy() || !this.canChange()) return;
    this.pending.set(value);
    this.method = '';
    this.received = false;
    this.error.set('');
    this.message.set('');
  }
  cancelBalance(): void {
    if (!this.busy()) this.pending.set(null);
  }
  async saveBalance(): Promise<void> {
    const value = this.pending();
    if (!value || this.busy()) return;
    if (!this.received || !this.method) {
      this.error.set('Elige el método y confirma que ya recibiste el saldo completo.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const version = this.version,
      id = this.establishmentId();
    try {
      const result = await this.service.receiveBalance(
        id,
        value.reservationId,
        this.method,
        this.received,
      );
      if (this.destroyed || id !== this.establishmentId() || version !== this.version) return;
      this.pending.set(null);
      this.message.set(
        result.alreadyRecorded
          ? 'Este saldo ya estaba registrado. Se cuenta una sola vez.'
          : 'Saldo cobrado registrado con la fecha de hoy.',
      );
      await this.load();
    } catch (error) {
      if (!this.destroyed && id === this.establishmentId()) this.error.set(kioskError(error));
    } finally {
      if (!this.destroyed && id === this.establishmentId()) this.busy.set(false);
    }
  }
}
