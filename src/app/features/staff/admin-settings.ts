import { Component, OnChanges, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BookingService, bookingError } from '../../core/services/booking.service';
interface AdminSettings {
  revision: number;
  name: string;
  location: string;
  description: string;
  reference: string;
  phone: string;
  openHour: number | null;
  closeHour: number | null;
  days: number[];
  holdMinutes: number | null;
  payment: { methods?: string[]; recipient?: string; phone?: string; mode?: string };
  courts: {
    id: string;
    name: string;
    dayPriceCents: number;
    nightPriceCents: number;
    nightStartsAt: number;
  }[];
}
@Component({
  selector: 'gg-admin-settings',
  imports: [FormsModule],
  template: `
    <div class="section-heading">
      <div>
        <span class="eyebrow">TU OPERACIÓN</span>
        <h2>Configuración del local</h2>
      </div>
    </div>
    @if (error()) {
      <div class="notice notice-error" role="alert">
        {{ error() }}
        <button class="text-button" (click)="load()" [disabled]="busy()">
          Recargar configuración
        </button>
      </div>
    }
    @if (message()) {
      <div class="notice notice-success" role="status">{{ message() }}</div>
    }
    @if (loading()) {
      <p role="status">Cargando configuración…</p>
    }
    @if (settings; as s) {
      <form class="ops-settings" (ngSubmit)="save()">
        <section class="panel">
          <span class="eyebrow">01 · INFORMACIÓN PÚBLICA</span>
          <h3>{{ s.name }}</h3>
          <p>{{ s.location }}</p>
          <label
            >Teléfono de contacto<input
              name="phone"
              [(ngModel)]="s.phone"
              maxlength="20"
              type="tel"
          /></label>
          <label
            >Referencia para llegar<input
              name="reference"
              [(ngModel)]="s.reference"
              maxlength="300"
          /></label>
          <label
            >Descripción del local<textarea
              name="description"
              [(ngModel)]="s.description"
              maxlength="1000"
              rows="4"
            ></textarea>
          </label>
        </section>
        <section class="panel">
          <span class="eyebrow">02 · ATENCIÓN</span>
          <h3>Días y horarios</h3>
          <div class="ops-days">
            @for (day of weekdays; track $index) {
              <label
                ><input
                  type="checkbox"
                  [checked]="s.days.includes($index)"
                  (change)="toggleDay($index)"
                />{{ day }}</label
              >
            }
          </div>
          <div class="ops-form-row">
            <label
              >Abre a las<select name="open" [(ngModel)]="s.openHour" required>
                @for (h of hours; track h) {
                  <option [ngValue]="h">{{ hour(h) }}</option>
                }
              </select></label
            >
            <label
              >Cierra a las<select name="close" [(ngModel)]="s.closeHour" required>
                @for (h of closingHours; track h) {
                  <option [ngValue]="h">{{ hour(h) }}</option>
                }
              </select></label
            >
          </div>
          <p class="muted">
            El mismo horario se aplica a los días seleccionados. Reservas en bloques de una hora. No
            se admite atención que cruce la medianoche.
          </p>
        </section>
        <section class="panel ops-wide">
          <span class="eyebrow">03 · TARIFAS POR CANCHA</span>
          <h3>Precios para nuevas reservas</h3>
          <p>Las reservas existentes conservan el precio con el que se solicitaron.</p>
          @for (c of s.courts; track c.id) {
            <fieldset class="ops-prices">
              <legend>{{ c.name }}</legend>
              <label
                >Día · S/ por hora<input
                  [name]="c.id + '-day'"
                  type="number"
                  min="10"
                  max="10000"
                  step="0.01"
                  required
                  [ngModel]="c.dayPriceCents / 100"
                  (ngModelChange)="c.dayPriceCents = cents($event)"
              /></label>
              <label
                >Noche · S/ por hora<input
                  [name]="c.id + '-night'"
                  type="number"
                  min="10"
                  max="10000"
                  step="0.01"
                  required
                  [ngModel]="c.nightPriceCents / 100"
                  (ngModelChange)="c.nightPriceCents = cents($event)"
              /></label>
              <label
                >Tarifa nocturna desde<select [name]="c.id + '-from'" [(ngModel)]="c.nightStartsAt">
                  @for (h of hours; track h) {
                    <option [ngValue]="h">{{ hour(h) }}</option>
                  }
                </select></label
              >
            </fieldset>
          }
        </section>
        <section class="panel ops-wide">
          <span class="eyebrow">04 · CONDICIONES VIGENTES</span>
          <h3>Reservas y pagos</h3>
          <div class="ops-policy">
            <span>Adelanto fijo <strong>S/ 10</strong></span
            ><span>Duración desde inicio real <strong>60 minutos</strong></span
            ><span
              >Plazo del comprobante
              <strong>{{ s.holdMinutes ?? 'Sin configurar' }} min</strong></span
            >
          </div>
          <p>
            {{ s.payment.methods?.join(' / ') || 'Métodos pendientes' }} ·
            {{ s.payment.recipient || 'Titular pendiente' }} ·
            {{ s.payment.phone || 'Número pendiente' }}
          </p>
          @if (s.payment.mode === 'demo') {
            <p class="demo-label">PRUEBA · SIN PAGOS REALES</p>
          }
          <p class="muted">
            La portada, las fotos, el QR, el titular de cobro y las altas de canchas se gestionan
            desde superadministración. Aquí puedes ajustar la operación de las canchas asignadas.
          </p>
        </section>
        <div class="ops-wide ops-save">
          <p>Se publicarán los datos de contacto, horarios y tarifas del local.</p>
          <button type="submit" class="button button-primary" [disabled]="busy() || loading()">
            {{ busy() ? 'Guardando…' : 'Guardar configuración' }}
          </button>
        </div>
      </form>
    }
  `,
})
export class AdminSettingsComponent implements OnChanges {
  readonly establishmentId = input.required<string>();
  private readonly backend = inject(BookingService);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  settings: AdminSettings | null = null;
  readonly weekdays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly closingHours = Array.from({ length: 24 }, (_, i) => i + 1);
  hour(h: number): string {
    return h === 24 ? '00:00 (fin del día)' : `${String(h).padStart(2, '0')}:00`;
  }
  cents(value: number): number {
    return Math.round(value * 100);
  }
  ngOnChanges(): void {
    this.settings = null;
    void this.load();
  }
  toggleDay(day: number): void {
    if (this.settings)
      this.settings.days = this.settings.days.includes(day)
        ? this.settings.days.filter((d) => d !== day)
        : [...this.settings.days, day];
  }
  async load(): Promise<void> {
    const establishmentId = this.establishmentId();
    this.loading.set(true);
    this.error.set('');
    try {
      const value = await this.backend.call<AdminSettings>('getAdminSettings', { establishmentId });
      if (this.establishmentId() === establishmentId) this.settings = value;
    } catch (error) {
      this.error.set(bookingError(error));
    } finally {
      this.loading.set(false);
    }
  }
  async save(): Promise<void> {
    const s = this.settings;
    if (!s || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await this.backend.call('saveAdminSettings', {
        establishmentId: this.establishmentId(),
        expectedRevision: s.revision,
        settings: {
          description: s.description,
          reference: s.reference,
          phone: s.phone,
          days: s.days,
          openHour: s.openHour,
          closeHour: s.closeHour,
          courts: s.courts.map(({ name, ...court }) => court),
        },
      });
      this.message.set(
        'Configuración publicada. Las nuevas reservas usarán estas tarifas y horarios.',
      );
      await this.load();
    } catch (error) {
      this.error.set(bookingError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
