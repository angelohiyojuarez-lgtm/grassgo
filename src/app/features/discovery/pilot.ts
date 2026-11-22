import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/icon';
@Component({
  selector: 'gg-pilot',
  imports: [RouterLink, Icon],
  template: `<div class="page detail-page">
    <a class="back-link" routerLink="/sedes"><gg-icon name="back" /> Volver a canchas</a>
    <div class="detail-photo">
      <img
        src="/assets/cancha-futbol.avif"
        alt="Imagen de referencia de una cancha de fútbol"
      /><span class="pill pill-light">Presentación del piloto · Imagen referencial</span>
    </div>
    <div class="detail-content">
      <div>
        <span class="eyebrow">EL PRIMER CAPÍTULO DE GRASSGO</span>
        <h1>Grass El Puma</h1>
        <p class="venue-location"><gg-icon name="pin" /> Salinas, Andahuaylas, Apurímac</p>
        <p>
          Una cancha de grass sintético y un quiosco. Aquí comienza el piloto de GrassGo, con una
          experiencia pensada para que organizar tu partido sea más sencillo.
        </p>
        <div class="feature-chips">
          <span><gg-icon name="field" /> 1 cancha sintética</span
          ><span><gg-icon name="pin" /> Andahuaylas</span>
        </div>
      </div>
      <aside class="panel">
        <span class="pill">Estamos preparando la cancha</span>
        <h2>Pronto, elige tu horario.</h2>
        <p>
          Las tarifas, los horarios y las condiciones se publicarán después de validarlos con el
          establecimiento.
        </p>
        <p class="muted">Esta presentación todavía no permite reservar ni realizar pagos.</p>
        <a class="button button-primary button-full" routerLink="/sedes"
          >Seguir explorando <gg-icon name="arrow"
        /></a>
      </aside>
    </div>
  </div>`,
})
export class Pilot {}
