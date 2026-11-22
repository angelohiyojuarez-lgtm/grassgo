import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { money, hourLabel } from '../../core/models/booking';
import {
  BusinessCatalogService,
  PublicBusiness,
} from '../../core/services/business-catalog.service';
import { BusinessImage } from '../../shared/business-image';
import { Icon } from '../../shared/icon';
@Component({
  selector: 'gg-courts',
  imports: [RouterLink, Icon, BusinessImage],
  template: ` <div class="page courts-page">
    <a class="back-link" routerLink="/sedes"><gg-icon name="back" /> Todos los locales</a>
    @if (loading()) {
      <div class="panel loading-state" role="status">Consultando canchas…</div>
    } @else if (error()) {
      <div class="notice notice-error" role="alert">
        {{ error() }} <button class="text-button" (click)="load()">Reintentar</button>
      </div>
    } @else if (venue(); as local) {
      <div class="page-heading">
        <span class="eyebrow">{{ local.name }}</span>
        <h1>Elige tu cancha<span class="cyan-text">.</span></h1>
        @if (local.demo) {
          <p class="demo-label">LOCAL DE PRUEBA · RESERVAS ONLINE EN PREPARACIÓN</p>
        }
        @if (local.rating; as rating) {
          <p class="business-rating">
            ★ {{ rating.average.toFixed(1) }} / 5 · {{ rating.count }} calificación(es){{
              rating.demo ? ' · PRUEBA' : ''
            }}
          </p>
        }
        <p><gg-icon name="pin" /> {{ local.location }}</p>
        @if (local.reference) {
          <p>Referencia: {{ local.reference }}</p>
        }
        @if (local.description) {
          <p>{{ local.description }}</p>
        }
      </div>
      @if (local.images.length) {
        <section class="establishment-gallery" aria-label="Fotos del establecimiento">
          <img
            class="establishment-cover"
            [ggMedia]="local.images[0]"
            [alt]="'Portada de ' + local.name"
          />
          @if (local.images.length > 1) {
            <div class="court-gallery">
              @for (image of local.images.slice(1); track image) {
                <img [ggMedia]="image" [alt]="'Otra vista del establecimiento ' + local.name" />
              }
            </div>
          }
        </section>
      }
      @if (local.days.length || local.openHour !== null || local.phone || local.scheduleRevision) {
        <section
          class="panel establishment-information"
          aria-label="Información del establecimiento"
        >
          @if (local.scheduleRevision && !local.days.length) {
            <p>El local no tiene días de atención habilitados para nuevas reservas.</p>
          }
          @if (local.days.length && local.openHour !== null && local.closeHour !== null) {
            <div>
              <gg-icon name="clock" />
              <div>
                <strong>Horario de atención</strong>
                <p>
                  {{ dayNames(local.days) }}<br />{{ hourLabel(local.openHour) }} –
                  {{ local.closeHour === 24 ? '24:00' : hourLabel(local.closeHour) }}
                </p>
              </div>
            </div>
          }
          @if (local.phone) {
            <div>
              <gg-icon name="user" />
              <div>
                <strong>Contacto del local</strong>
                <p>
                  <a [href]="'tel:' + local.phone">{{ local.phone }}</a>
                </p>
              </div>
            </div>
          }
        </section>
      }
      <div class="list-label">
        <span>CANCHAS DEL LOCAL</span><span>{{ local.courts.length }} cancha(s)</span>
      </div>
      @for (court of local.courts; track court.id) {
        <a
          class="photo-choice court-choice"
          [routerLink]="['/reservar', local.id, court.id]"
          [attr.aria-label]="'Elegir ' + court.name + ' de ' + local.name"
          ><div class="choice-photo">
            <img
              [ggMedia]="
                court.images[0] || (local.id === 'el-puma' ? '/assets/login-estadio.png' : '')
              "
              [alt]="court.name + ' de ' + local.name"
            /><span class="tag image-tag">{{ court.sport }}</span>
            @if (!court.images.length) {
              <span class="photo-caption">Imagen referencial</span>
            }
            <span class="photo-action">Elegir esta cancha <gg-icon name="arrow" /></span>
          </div>
          <div class="choice-info">
            <div>
              <span class="eyebrow">{{ local.name }}</span>
              <h2>{{ court.name }}</h2>
              <p>
                {{ court.sport }}
                @if (court.surface) {
                  · {{ court.surface }}
                }
              </p>
            </div>
            <span class="choice-arrow"><gg-icon name="arrow" /></span></div
        ></a>
        <div class="price-strip">
          <div>
            <span>Día</span><strong>{{ money(court.dayPriceCents) }}<small> / hora</small></strong>
          </div>
          <div>
            <span>Noche · Desde {{ hourLabel(court.nightStartsAt) }}</span
            ><strong>{{ money(court.nightPriceCents) }}<small> / hora</small></strong>
          </div>
          <div>
            <span>Adelanto para reservar</span><strong>{{ money(local.advanceCents) }}</strong>
          </div>
        </div>
        @if (court.images.length > 1) {
          <div class="court-gallery">
            @for (image of court.images.slice(1); track image) {
              <img [ggMedia]="image" [alt]="'Otra vista de ' + court.name" />
            }
          </div>
        }
      }
      <div class="home-tip">
        <gg-icon name="calendar" />
        <p>Toca la foto de una cancha para elegir fecha y consultar horarios.</p>
      </div>
    } @else {
      <div class="panel compact-empty">
        <h1>Este establecimiento no está publicado</h1>
        <a class="button button-primary" routerLink="/sedes">Ver locales</a>
      </div>
    }
  </div>`,
})
export class Courts implements OnInit, OnDestroy {
  private readonly catalog = inject(BusinessCatalogService);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('establishmentId');
  readonly venue = signal<PublicBusiness | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly money = money;
  readonly hourLabel = hourLabel;
  private unsubscribe?: () => void;
  private loadVersion = 0;
  private destroyed = false;
  dayNames(days: number[]): string {
    return [
      { id: 1, name: 'Lunes' },
      { id: 2, name: 'Martes' },
      { id: 3, name: 'Miércoles' },
      { id: 4, name: 'Jueves' },
      { id: 5, name: 'Viernes' },
      { id: 6, name: 'Sábado' },
      { id: 0, name: 'Domingo' },
    ]
      .filter((day) => days.includes(day.id))
      .map((day) => day.name)
      .join(', ');
  }
  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    const version = ++this.loadVersion;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.loading.set(true);
    this.error.set('');
    try {
      const stop = await this.catalog.observe(
        (items) => {
          if (this.destroyed || version !== this.loadVersion) return;
          this.venue.set(items.find((venue) => venue.id === this.id) || null);
          this.error.set('');
          this.loading.set(false);
        },
        () => {
          if (this.destroyed || version !== this.loadVersion) return;
          this.error.set('No pudimos actualizar las canchas del local. Vuelve a consultar.');
          this.loading.set(false);
        },
      );
      if (this.destroyed || version !== this.loadVersion) stop();
      else this.unsubscribe = stop;
    } catch {
      if (this.destroyed || version !== this.loadVersion) return;
      this.error.set('No pudimos consultar las canchas del local.');
      this.loading.set(false);
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.loadVersion;
    this.unsubscribe?.();
  }
}
