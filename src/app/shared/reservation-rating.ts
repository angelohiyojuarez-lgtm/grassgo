import { Component, input, inject, signal, computed } from '@angular/core';
import { BookingService, bookingError } from '../core/services/booking.service';
import { Reservation } from '../core/models/booking';
@Component({
  selector: 'gg-reservation-rating',
  template: `
    @if (reservation().serviceStatus === 'completed' && reservation().status === 'confirmed') {
      <section class="reservation-rating" aria-label="Calificación del establecimiento">
        @if (saved() || reservation().rating?.stars; as stars) {
          <strong>Tu calificación del local</strong>
          <p class="rating-thanks">★ {{ stars }} de 5 · ¡Gracias por contarnos!</p>
        } @else {
          <strong>¿Qué tal estuvo el local?</strong>
          <p>Tu partido terminó. Califica tu experiencia.</p>
          <div class="rating-stars" role="group" aria-label="Elige de 1 a 5 estrellas">
            @for (star of [1, 2, 3, 4, 5]; track star) {
              <button type="button" [class.selected]="selected() >= star"
                [attr.aria-label]="star + (star === 1 ? ' estrella' : ' estrellas')"
                [attr.aria-pressed]="selected() === star" [disabled]="busy()" (click)="selected.set(star)">★</button>
            }
          </div>
          <p class="rating-choice" aria-live="polite">{{ selected() ? selected() + ' de 5 estrellas' : 'Toca una estrella' }}</p>
          <button type="button" class="button button-primary" [disabled]="!selected() || busy()" (click)="send()">
            {{ busy() ? 'Guardando…' : 'Enviar calificación' }}
          </button>
          @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
        }
        @if (reservation().demo) { <p class="muted">Calificación de prueba; no cuenta para la puntuación real.</p> }
      </section>
    }
  `,
})
export class ReservationRating {
  readonly reservation = input.required<Reservation>();
  private readonly booking = inject(BookingService);
  readonly selected = signal(0);
  private readonly submitted = signal<{ id: string; stars: number } | null>(null);
  readonly saved = computed(() => this.submitted()?.id === this.reservation().id ? this.submitted()!.stars : 0);
  readonly busy = signal(false);
  readonly error = signal('');
  async send(): Promise<void> {
    if (this.busy() || !this.selected()) return;
    this.busy.set(true); this.error.set('');
    const id = this.reservation().id;
    try {
      const result = await this.booking.call<{ stars: number }>('rateEstablishment', { reservationId: id, stars: this.selected() });
      this.submitted.set({ id, stars: result.stars });
    } catch (error) {
      this.error.set((error as { code?: string }).code === 'functions/already-exists' ? 'Esta reserva ya tiene una calificación. Actualiza Mis reservas para verla.' : bookingError(error));
    } finally { this.busy.set(false); }
  }
}
