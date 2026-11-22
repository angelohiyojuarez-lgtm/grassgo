import {
  Component,
  HostListener,
  OnChanges,
  OnDestroy,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EstablishmentPricingService } from '../../core/services/establishment-pricing.service';
import { CourtPricing, solesToCents } from '../../core/models/establishment-pricing';
import { money } from '../../core/models/booking';
import { Icon } from '../../shared/icon';

interface PricingDraft extends CourtPricing {
  daySoles: string;
  nightSoles: string;
  savedKey: string;
  error: string;
  message: string;
}
const key = (value: PricingDraft): string =>
  JSON.stringify([value.daySoles.trim(), value.nightSoles.trim(), value.nightStartsAt]);
const draft = (value: CourtPricing): PricingDraft => {
  const result: PricingDraft = {
    ...value,
    daySoles: value.dayPriceCents === null ? '' : (value.dayPriceCents / 100).toFixed(2),
    nightSoles: value.nightPriceCents === null ? '' : (value.nightPriceCents / 100).toFixed(2),
    savedKey: '',
    error: '',
    message: '',
  };
  result.savedKey = key(result);
  return result;
};
const errorMessage = (error: unknown, fallback: string): string => {
  const detail = error as { code?: string; message?: string };
  const code = detail?.code?.split('/').pop();
  if (['aborted', 'invalid-argument', 'failed-precondition'].includes(code || ''))
    return detail.message || fallback;
  if (code === 'permission-denied')
    return 'Tu cuenta no tiene permiso para cambiar los precios de este establecimiento.';
  return fallback;
};

@Component({
  selector: 'gg-admin-local-pricing',
  imports: [FormsModule, Icon],
  templateUrl: './admin-local-pricing.html',
  styleUrl: './admin-local-pricing.css',
})
export class AdminLocalPricing implements OnChanges, OnDestroy {
  readonly establishmentId = input.required<string>();
  readonly context = input<'local' | 'platform'>('local');
  readonly saved = output<void>();
  private readonly service = inject(EstablishmentPricingService);
  readonly name = signal('');
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly loadError = signal('');
  readonly courts = signal<PricingDraft[]>([]);
  readonly advance = signal<number | null>(null);
  readonly pendingReload = signal<PricingDraft | null>(null);
  readonly money = money;
  readonly hours = Array.from({ length: 24 }, (_, hour) => hour);
  private version = 0;
  private destroyed = false;
  ngOnChanges(): void {
    void this.load();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.version;
  }
  private current(id: string, version: number): boolean {
    return !this.destroyed && id === this.establishmentId() && version === this.version;
  }
  async load(): Promise<void> {
    const id = this.establishmentId(),
      version = ++this.version;
    this.loading.set(true);
    this.busy.set(false);
    this.name.set('');
    this.advance.set(null);
    this.loadError.set('');
    this.courts.set([]);
    this.pendingReload.set(null);
    try {
      const data = await this.service.load(id);
      if (!this.current(id, version)) return;
      this.name.set(data.name);
      this.advance.set(data.advanceCents);
      this.courts.set(data.courts.map(draft));
    } catch (error) {
      if (this.current(id, version))
        this.loadError.set(
          errorMessage(error, 'No pudimos consultar los precios. Vuelve a intentarlo.'),
        );
    } finally {
      if (this.current(id, version)) this.loading.set(false);
    }
  }
  hour(value: number): string {
    return String(value).padStart(2, '0') + ':00';
  }
  changed(value: PricingDraft): boolean {
    return key(value) !== value.savedKey;
  }
  hasUnsavedChanges(): boolean {
    return !!this.pendingReload() || this.courts().some((item) => this.changed(item));
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
  summary(value: PricingDraft): string {
    const day = solesToCents(value.daySoles),
      night = solesToCents(value.nightSoles);
    return day === null || night === null || value.nightStartsAt === null
      ? 'Completa los dos precios y la hora de la tarifa de noche.'
      : 'Día ' +
          money(day) +
          ' · Noche ' +
          money(night) +
          ' desde las ' +
          this.hour(value.nightStartsAt);
  }
  async save(value: PricingDraft): Promise<void> {
    if (this.busy() || this.loading() || !this.courts().includes(value)) return;
    value.error = '';
    value.message = '';
    const dayPriceCents = solesToCents(value.daySoles),
      nightPriceCents = solesToCents(value.nightSoles);
    if (
      dayPriceCents === null ||
      nightPriceCents === null ||
      !Number.isInteger(value.nightStartsAt) ||
      value.nightStartsAt === null ||
      value.nightStartsAt < 0 ||
      value.nightStartsAt > 23
    ) {
      value.error =
        'Escribe precios de S/ 10 a S/ 10 000, con hasta dos decimales, y elige la hora de la tarifa de noche.';
      return;
    }
    const id = this.establishmentId(),
      version = this.version;
    this.busy.set(true);
    try {
      const saved = await this.service.savePricing(id, {
        id: value.id,
        name: value.name,
        dayPriceCents,
        nightPriceCents,
        nightStartsAt: value.nightStartsAt,
        revision: value.revision,
      });
      if (!this.current(id, version)) return;
      Object.assign(value, draft(saved));
      value.message =
        'Precios guardados para nuevas solicitudes. Las reservas existentes conservan su importe.';
      this.saved.emit();
    } catch (error) {
      if (this.current(id, version))
        value.error = errorMessage(
          error,
          'No pudimos guardar. Tus cambios siguen aquí; vuelve a intentarlo.',
        );
    } finally {
      if (this.current(id, version)) this.busy.set(false);
    }
  }
  requestReload(value: PricingDraft): void {
    if (this.busy() || this.loading()) return;
    if (this.changed(value)) this.pendingReload.set(value);
    else void this.reloadCourt(value);
  }
  confirmReload(): void {
    const value = this.pendingReload();
    if (value && !this.busy()) void this.reloadCourt(value);
  }
  private async reloadCourt(value: PricingDraft): Promise<void> {
    const id = this.establishmentId(),
      version = this.version;
    this.busy.set(true);
    value.error = '';
    try {
      const data = await this.service.load(id);
      if (!this.current(id, version)) return;
      const saved = data.courts.find((item) => item.id === value.id);
      if (!saved) {
        value.error =
          'Esta cancha ya no está activa. Vuelve a consultar la configuración del local.';
        return;
      }
      Object.assign(value, draft(saved));
      this.pendingReload.set(null);
    } catch (error) {
      if (this.current(id, version))
        value.error = errorMessage(
          error,
          'No pudimos consultar los precios guardados. Tus cambios se mantienen.',
        );
    } finally {
      if (this.current(id, version)) this.busy.set(false);
    }
  }
}
