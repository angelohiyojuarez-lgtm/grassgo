import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { ReservationRating } from '../../shared/reservation-rating';
import { ReservationShare } from '../../shared/reservation-share';
import { ReservationTiming } from '../../shared/reservation-timing';
import { RouterLink } from '@angular/router';
import { BookingService, bookingError } from '../../core/services/booking.service';
import { Reservation, money, slotLabel, statusLabel } from '../../core/models/booking';
import { Icon } from '../../shared/icon';
@Component({
  selector: 'gg-my-reservations',
  imports: [RouterLink, Icon, ReservationTiming, ReservationShare, ReservationRating],
  template: `<div class="page">
    <a class="back-link" routerLink="/inicio"><gg-icon name="back" /> Volver al inicio</a>
    <div class="page-heading">
      <span class="eyebrow">TU AGENDA DE JUEGO</span>
      <h1>Mis reservas<span class="cyan-text">.</span></h1>
      <p>
        Consulta tus solicitudes y el estado de tus comprobantes. Actualización automática cada 10
        segundos.
      </p>
    </div>
    @if (error()) {
      <div class="notice notice-error" role="alert">
        {{ error() }}<button class="text-button" (click)="load()">Volver a consultar</button>
      </div>
    }
    @if (loading()) {
      <div class="panel loading-state" role="status">Consultando tus reservas…</div>
    } @else if (!items().length && !error()) {
      <div class="panel compact-empty">
        <span class="empty-icon"><gg-icon name="calendar" /></span>
        <h2>La próxima pichanga te espera</h2>
        <p>Todavía no tienes solicitudes de reserva.</p>
        <a class="button button-primary" routerLink="/sedes"
          >Ver canchas <gg-icon name="arrow"
        /></a>
      </div>
    } @else {
      <div class="reservation-list">
        @for (item of items(); track item.id) {
          <article class="panel reservation-card">
            <div class="reservation-card-top">
              <span class="tag" [class.confirmed]="item.status === 'confirmed'">{{
                status(item.status)
              }}</span>
              @if (item.demo) {
                <span class="demo-label">PRUEBA · SIN PAGOS REALES</span>
              }
            </div>
            <h2>{{ item.establishmentName }}</h2>
            <p>{{ item.courtName }}</p>
            <gg-reservation-timing [reservation]="item" />
            <div class="reservation-facts">
              <span><gg-icon name="calendar" />{{ item.date }}</span
              ><span><gg-icon name="clock" />{{ slot(item.hour) }}</span>
            </div>
            <div class="balance-line">
              <span
                >Adelanto
                {{
                  item.paymentStatus === 'verified'
                    ? 'verificado'
                    : item.paymentStatus === 'submitted'
                      ? 'en revisión'
                      : 'pendiente'
                }}</span
              ><strong>{{ money(item.advanceCents) }}</strong>
            </div>
            @if (item.status === 'pending_payment') {
              <a
                class="button button-primary"
                [routerLink]="['/reservar', item.establishmentId, item.courtId]"
                [queryParams]="{ solicitud: item.id }"
                >Continuar y adjuntar comprobante <gg-icon name="upload"
              /></a>
            }
            @if (item.status === 'pending_verification') {
              <p class="muted">
                El comprobante está en revisión. El administrador debe verificar el ingreso real
                para confirmar.
              </p>
              <a
                class="text-button"
                [routerLink]="['/reservar', item.establishmentId, item.courtId]"
                [queryParams]="{ solicitud: item.id }"
                >Ver estado de la solicitud</a
              >
            }
            @if (
              item.expiresAt && ['pending_payment', 'pending_verification'].includes(item.status)
            ) {
              <p class="muted">
                Plazo de la solicitud: {{ expiration(item.expiresAt) }} (hora de Perú).
              </p>
            }
            @if (item.status === 'expired') {
              <p class="muted">
                La solicitud venció. Si ya pagaste, comunícate con el establecimiento para que
                revise tu caso.
              </p>
            }
            <gg-reservation-rating [reservation]="item" />
            <gg-reservation-share [reservation]="item" />
          </article>
        }
      </div>
    }
  </div>`,
})
export class MyReservations implements OnInit, OnDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private inFlight = false;
  private destroyed = false;
  private readonly booking = inject(BookingService);
  readonly items = signal<Reservation[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly status = statusLabel;
  readonly slot = slotLabel;
  readonly money = money;
  expiration(instant: number): string {
    return new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(instant));
  }
  ngOnInit(): void {
    void this.load();
    this.timer = setInterval(() => {
      if (!document.hidden) void this.load(true);
    }, 10000);
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    clearInterval(this.timer);
  }
  async load(silent = false): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    if (!silent && !this.items().length) this.loading.set(true);
    try {
      const items = await this.booking.mine();
      if (!this.destroyed) {
        this.items.set(items);
        this.error.set('');
      }
    } catch (error) {
      if (!this.destroyed) this.error.set(bookingError(error));
    } finally {
      this.loading.set(false);
      this.inFlight = false;
    }
  }
}
