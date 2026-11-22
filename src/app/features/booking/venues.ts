import { Component, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { money } from '../../core/models/booking';
import {
  BusinessCatalogService,
  PublicBusiness,
} from '../../core/services/business-catalog.service';
import { BusinessImage } from '../../shared/business-image';
import { Icon } from '../../shared/icon';
@Component({
  selector: 'gg-venues',
  imports: [RouterLink, FormsModule, Icon, BusinessImage],
  template: ` <div class="page venue-page">
    <a class="back-link" routerLink="/inicio"><gg-icon name="back" /> Volver al inicio</a>
    <div class="page-heading">
      <span class="eyebrow">EL TERRENO DE TU PRÓXIMA HISTORIA</span>
      <h1>Encuentra tu cancha<span class="cyan-text">.</span></h1>
      <p>Buenos planes empiezan con un buen lugar. Elige el tuyo.</p>
    </div>
    <label class="search-box"
      ><gg-icon name="search" /><input
        type="search"
        aria-label="Buscar local"
        placeholder="Busca un local o una ubicación"
        [ngModel]="search()"
        (ngModelChange)="search.set($event)"
    /></label>
    @if (loading()) {
      <div class="panel loading-state" role="status">Consultando establecimientos…</div>
    } @else if (error()) {
      <div class="notice notice-error" role="alert">
        {{ error() }} <button class="text-button" (click)="load()">Reintentar</button>
      </div>
    } @else {
      <div class="list-label">
        <span>ESTABLECIMIENTOS</span><span>{{ visible().length }} local(es)</span>
      </div>
      @for (venue of visible(); track venue.id) {
        <a class="photo-choice venue-choice" [routerLink]="['/sedes', venue.id, 'canchas']"
          ><div class="choice-photo">
            @if (image(venue)) {
              <img [ggMedia]="image(venue)" [alt]="'Establecimiento ' + venue.name" />
            } @else {
              <div class="venue-photo-pending">
                <gg-icon name="building" /> Foto del establecimiento pendiente
              </div>
            }
            <span class="tag image-tag">{{ venue.name }}</span>
            @if (!venue.images.length && venue.id === 'el-puma') {
              <span class="photo-caption">Imagen referencial</span>
            }
          </div>
          <div class="choice-info">
            <div>
              <span class="eyebrow">{{ venue.district || venue.location }}</span>
              <h2>{{ venue.name }}</h2>
              @if (venue.demo) {
                <p class="demo-label">LOCAL DE PRUEBA · RESERVAS ONLINE EN PREPARACIÓN</p>
              }
              @if (venue.rating; as rating) {
                <p class="business-rating">
                  ★ {{ rating.average.toFixed(1) }} / 5 · {{ rating.count }} calificación(es){{
                    rating.demo ? ' · PRUEBA' : ''
                  }}
                </p>
              }
              <p><gg-icon name="pin" /> {{ venue.location }}</p>
              <div class="choice-chips">
                <span>{{ venue.courts.length }} cancha(s)</span><span>{{ sports(venue) }}</span
                ><span>Adelanto {{ money(venue.advanceCents) }}</span>
              </div>
            </div>
            <span class="choice-arrow"><gg-icon name="arrow" /></span></div
        ></a>
      } @empty {
        <div class="panel compact-empty">
          <gg-icon name="search" />
          <h2>
            {{ venues().length ? 'No encontramos ese local' : 'Todavía no hay locales publicados' }}
          </h2>
          <p>
            {{
              venues().length
                ? 'Prueba con otra ubicación o nombre.'
                : 'Vuelve pronto para descubrir nuevos establecimientos.'
            }}
          </p>
        </div>
      }
    }
  </div>`,
})
export class Venues implements OnInit, OnDestroy {
  private readonly catalog = inject(BusinessCatalogService);
  readonly venues = signal<PublicBusiness[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly money = money;
  readonly search = signal('');
  private unsubscribe?: () => void;
  private loadVersion = 0;
  private destroyed = false;
  readonly visible = computed(() =>
    this.venues().filter((venue) =>
      `${venue.name} ${venue.location} ${venue.district}`
        .toLocaleLowerCase('es')
        .includes(this.search().trim().toLocaleLowerCase('es')),
    ),
  );
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
          this.venues.set(items);
          this.error.set('');
          this.loading.set(false);
        },
        () => {
          if (this.destroyed || version !== this.loadVersion) return;
          this.error.set('No pudimos actualizar los locales publicados. Vuelve a consultar.');
          this.loading.set(false);
        },
      );
      if (this.destroyed || version !== this.loadVersion) stop();
      else this.unsubscribe = stop;
    } catch {
      if (this.destroyed || version !== this.loadVersion) return;
      this.error.set('No pudimos consultar los locales publicados.');
      this.loading.set(false);
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.loadVersion;
    this.unsubscribe?.();
  }
  image(venue: PublicBusiness): string {
    return venue.images?.[0] || (venue.id === 'el-puma' ? '/assets/login-estadio.png' : '');
  }
  sports(venue: PublicBusiness): string {
    return [...new Set(venue.courts.map((court) => court.sport))].join(' · ');
  }
}
