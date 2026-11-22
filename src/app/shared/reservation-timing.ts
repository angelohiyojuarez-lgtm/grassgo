import { Component, OnDestroy, OnInit, input, signal } from '@angular/core';
import { Reservation, clockLabel } from '../core/models/booking';
@Component({
  selector: 'gg-reservation-timing',
  template: `
    @if (reservation(); as r) {
      @if (completed()) {
        <p class="notice">
          <strong>Partido finalizado</strong> · {{ clock(r.actualStartAt) }} –
          {{ clock(endAt()) }}
        </p>
      } @else if (r.estimatedStartAt) {
        <div class="notice ops-customer-timing">
          <strong>{{
            r.serviceStatus === 'running'
              ? 'Tu partido está en juego'
              : delayed()
                ? 'Tu horario estimado cambió'
                : 'Horario estimado de tu partido'
          }}</strong>
          <p>
            {{ clock(r.actualStartAt || r.estimatedStartAt) }} – {{ clock(r.estimatedEndAt) }} ·
            hora de Perú
          </p>
          @if (r.engine === 'direct' && r.serviceStatus === 'running') {
            <p>Termina automáticamente al cumplirse 60 minutos desde el inicio real.</p>
          }
          @if (r.awaitingFinish && r.engine !== 'direct') {
            <p>Esperando que el administrador confirme el término del partido.</p>
          } @else if (delayed()) {
            <p>
              Hay un retraso en la cancha. Conservas tus 60 minutos completos desde el inicio real.
            </p>
          }
        </div>
      }
    }
  `,
})
export class ReservationTiming implements OnInit, OnDestroy {
  readonly reservation = input.required<Reservation>();
  readonly clock = clockLabel;
  readonly now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;
  ngOnInit(): void {
    this.timer = setInterval(() => this.now.set(Date.now()), 1000);
  }
  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
  endAt(): number | null {
    const r = this.reservation();
    return (
      r.actualEndAt || (r.engine === 'direct' && r.actualStartAt ? r.actualStartAt + 3600000 : null)
    );
  }
  completed(): boolean {
    const r = this.reservation();
    return (
      r.serviceStatus === 'completed' ||
      (r.engine === 'direct' &&
        r.serviceStatus === 'running' &&
        !!r.actualStartAt &&
        this.now() >= r.actualStartAt + 3600000)
    );
  }
  delayed(): boolean {
    const r = this.reservation();
    return !!r.estimatedStartAt && !!r.startsAt && r.estimatedStartAt > r.startsAt + 59999;
  }
}
