import { Component, computed, input, signal } from '@angular/core';
import { Reservation } from '../core/models/booking';
import { reservationShareText } from './reservation-share-text';

@Component({
  selector: 'gg-reservation-share',
  template: `
    <div class="reservation-share">
      <button type="button" class="button button-outline" (click)="open.set(!open())" [attr.aria-expanded]="open()">
        Compartir reserva ↗
      </button>
      @if (open()) {
        <div class="share-options">
          <p>Comparte los datos con tu equipo</p>
          <textarea aria-label="Datos de la reserva para compartir" readonly [value]="text()" rows="7"></textarea>
          <div class="share-actions">
            @if (nativeSupported) {
              <button type="button" class="button button-primary" (click)="share()" [disabled]="busy()">Más aplicaciones</button>
            }
            <a class="button button-outline" [href]="whatsapp()" target="_blank" rel="noopener noreferrer">WhatsApp</a>
            <a class="button button-outline" [href]="email()">Correo</a>
            <button type="button" class="button button-outline" (click)="copy()">Copiar datos</button>
          </div>
          <p class="share-feedback" role="status">{{ feedback() }}</p>
        </div>
      }
    </div>
  `,
})
export class ReservationShare {
  readonly reservation = input.required<Reservation>();
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly feedback = signal('');
  readonly nativeSupported = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  readonly text = computed(() => reservationShareText(this.reservation()));
  readonly whatsapp = computed(() => 'https://wa.me/?text=' + encodeURIComponent(this.text()));
  readonly email = computed(() => 'mailto:?subject=' + encodeURIComponent('Mi reserva en GrassGo') + '&body=' + encodeURIComponent(this.text()));
  async share(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.feedback.set('');
    try {
      await navigator.share({ title: 'Mi reserva en GrassGo', text: this.text() });
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') {
        this.feedback.set('Puedes usar WhatsApp, correo o copiar los datos.');
      }
    } finally {
      this.busy.set(false);
    }
  }
  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text());
      this.feedback.set('Datos copiados. Pégalos en la aplicación que prefieras.');
    } catch {
      this.feedback.set('Selecciona el texto del recuadro para copiarlo manualmente.');
    }
  }
}
