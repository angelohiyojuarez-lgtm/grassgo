import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  NewPlatformCourt,
  PlatformOnboardingService,
  onboardingError,
} from '../../core/services/platform-onboarding.service';
import { solesToCents } from '../../core/models/establishment-pricing';

export interface CourtDraft {
  id: string;
  name: string;
  sport: string;
  surface: string;
  dayPrice: string;
  nightPrice: string;
  nightStartsAt: number | null;
}
export const emptyCourtDraft = (id: string): CourtDraft => ({
  id,
  name: '',
  sport: '',
  surface: '',
  dayPrice: '',
  nightPrice: '',
  nightStartsAt: null,
});
export function readCourtDraft(
  draft: CourtDraft,
  advanceCents: number | null = null,
): NewPlatformCourt | null {
  const dayPriceCents = solesToCents(draft.dayPrice),
    nightPriceCents = solesToCents(draft.nightPrice);
  if (
    !/^[A-Za-z0-9-]{1,80}$/.test(draft.id) ||
    draft.name.trim().length < 2 ||
    draft.name.trim().length > 100 ||
    draft.sport.trim().length < 2 ||
    draft.sport.trim().length > 40 ||
    draft.surface.trim().length < 2 ||
    draft.surface.trim().length > 80 ||
    dayPriceCents === null ||
    nightPriceCents === null ||
    !Number.isInteger(draft.nightStartsAt) ||
    draft.nightStartsAt! < 0 ||
    draft.nightStartsAt! > 23 ||
    (advanceCents !== null && (dayPriceCents < advanceCents || nightPriceCents < advanceCents))
  )
    return null;
  return {
    id: draft.id,
    name: draft.name.trim(),
    sport: draft.sport.trim(),
    surface: draft.surface.trim(),
    dayPriceCents,
    nightPriceCents,
    nightStartsAt: draft.nightStartsAt!,
  };
}

@Component({
  selector: 'gg-platform-court-fields',
  imports: [FormsModule],
  template: `<div class="court-fields">
    <label
      >Nombre de la cancha<input
        [name]="'court-name-' + draft().id"
        [(ngModel)]="draft().name"
        [disabled]="disabled()"
        required
        minlength="2"
        maxlength="100"
        placeholder="Nombre para identificarla"
    /></label>
    <label
      >Deporte<select
        [name]="'court-sport-' + draft().id"
        [(ngModel)]="draft().sport"
        [disabled]="disabled()"
        required
      >
        <option value="" disabled>Elige el deporte</option>
        <option>Fútbol</option>
        <option>Fútbol 7</option>
        <option>Vóley</option>
        <option>Multideporte</option>
      </select></label
    >
    <label
      >Superficie<select
        [name]="'court-surface-' + draft().id"
        [(ngModel)]="draft().surface"
        [disabled]="disabled()"
        required
      >
        <option value="" disabled>Elige la superficie</option>
        <option>Grass sintético</option>
        <option>Piso sintético</option>
        <option>Losa deportiva</option>
        <option>Césped natural</option>
      </select></label
    >
    <label
      >Precio de día por hora (S/)<input
        [name]="'court-day-' + draft().id"
        [(ngModel)]="draft().dayPrice"
        [disabled]="disabled()"
        inputmode="decimal"
        required
        maxlength="8"
        placeholder="Precio real de esta cancha"
    /></label>
    <label
      >Precio de noche por hora (S/)<input
        [name]="'court-night-' + draft().id"
        [(ngModel)]="draft().nightPrice"
        [disabled]="disabled()"
        inputmode="decimal"
        required
        maxlength="8"
        placeholder="Precio real de esta cancha"
    /></label>
    <label
      >¿Desde qué hora aplica el precio de noche?<select
        [name]="'court-hour-' + draft().id"
        [(ngModel)]="draft().nightStartsAt"
        [disabled]="disabled()"
        required
      >
        <option [ngValue]="null" disabled>Elige la hora</option>
        @for (hour of hours; track hour) {
          <option [ngValue]="hour">{{ hourLabel(hour) }}</option>
        }
      </select></label
    >
    <small class="price-hint">Si cobras lo mismo de día y de noche, repite el precio.</small>
  </div>`,
  styles: [
    `
      :host {
        display: block;
      }
      .court-fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
        gap: 20px;
      }
      label {
        display: grid;
        gap: 10px;
        align-content: start;
        font-weight: 700;
        color: var(--ink, #173c28);
        font-size: 16px;
        line-height: 1.5;
      }
      .price-hint {
        grid-column: 1 / -1;
        font-size: 14px;
        line-height: 1.6;
        color: var(--ink, #173c28);
      }
      input,
      select {
        width: 100%;
        min-height: 56px;
        border: 1px solid var(--border, #cbd5e1);
        border-radius: 13px;
        padding: 13px;
        background: var(--paper, #fff);
        color: var(--ink, #173c28);
        font: inherit;
        font-weight: 500;
      }
      :is(input, select):focus-visible {
        outline: 3px solid #029fbd;
        outline-offset: 3px;
      }
      input::placeholder {
        color: var(--ink, #173c28);
        opacity: 0.7;
      }
      @media (max-width: 650px) {
        .court-fields {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class PlatformCourtFields {
  readonly draft = input.required<CourtDraft>();
  readonly disabled = input(false);
  readonly hours = Array.from({ length: 24 }, (_, hour) => hour);
  hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
  }
}

@Component({
  selector: 'gg-platform-court-editor',
  imports: [FormsModule, PlatformCourtFields],
  templateUrl: './platform-court-editor.html',
  styleUrl: './platform-court-editor.css',
})
export class PlatformCourtEditor {
  private readonly service = inject(PlatformOnboardingService);
  readonly establishmentId = input.required<string>();
  readonly advanceCents = input<number | null>(null);
  readonly saved = output<void>();
  readonly cancel = output<void>();
  readonly draft = signal(emptyCourtDraft(crypto.randomUUID()));
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  async save(): Promise<void> {
    if (this.busy()) return;
    const court = readCourtDraft(this.draft(), this.advanceCents());
    if (!court) {
      this.error.set(
        'Completa el nombre, deporte, superficie, precios y hora de noche. Los precios deben cubrir el adelanto del negocio.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await this.service.addCourt(this.establishmentId(), court);
      this.message.set(
        'Cancha guardada. Sus precios ya están disponibles para el dueño y la ficha del negocio.',
      );
      this.saved.emit();
    } catch (error) {
      this.error.set(onboardingError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
