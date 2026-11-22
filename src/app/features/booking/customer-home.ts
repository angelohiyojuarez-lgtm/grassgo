import { Component, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/icon';
@Component({
  selector: 'gg-customer-home',
  imports: [RouterLink, Icon],
  template: ` <div class="page customer-home">
    <div class="home-greeting">
      <div>
        <span class="eyebrow">TU CLUB EMPIEZA AQUÍ</span>
        <h1>Qué tal, {{ name() }}<span class="cyan-text">.</span></h1>
      </div>
      <a class="user-bubble" routerLink="/perfil" aria-label="Ir a mi perfil">{{
        name().slice(0, 1).toUpperCase()
      }}</a>
    </div>
    <section class="play-banner">
      <div class="play-banner-copy">
        <span class="hero-label"><span class="status-dot"></span> MENOS CHAT. MÁS PARTIDO.</span>
        <h2>HAZ QUE<br /><em>PASE.</em><span class="hero-asterisk" aria-hidden="true">✳</span></h2>
        <p>El plan ya está. Solo falta la cancha.<br />Encuentra tu lugar y reúne al equipo.</p>
        <a class="button button-white home-booking-button" routerLink="/sedes"
          >Buscar una cancha <gg-icon name="arrow"
        /></a>
        <span class="hero-footnote">TU PRÓXIMA BUENA HISTORIA SE JUEGA AQUÍ.</span>
      </div>
      <div
        class="play-banner-photo"
        role="img"
        aria-label="Fotografía referencial de una cancha de fútbol"
      >
        <span class="hero-photo-label">EL JUEGO<br />NOS JUNTA.</span>
        <span class="sport-photo-note">Fotografía de referencia</span>
        <div class="hero-photo-card">
          <gg-icon name="field" />
          <div><strong>Tu lugar en la cancha</strong><span>Elige local, fecha y hora.</span></div>
          <span aria-hidden="true">↗</span>
        </div>
      </div>
    </section>
    <div class="club-ribbon" aria-hidden="true">
      <span>RESERVA.</span><span>REÚNE.</span><span>JUEGA.</span><span>REPITE.</span
      ><span class="ribbon-ball">✳</span>
    </div>
    <div class="home-section-title">
      <div>
        <span class="eyebrow">A UN TOQUE DEL PARTIDO</span>
        <h2>Tu juego, organizado.</h2>
      </div>
      <span class="section-index">01 / 02</span>
    </div>
    <div class="home-quick-links">
      <a routerLink="/reservas"
        ><span class="quick-icon"><gg-icon name="calendar" /></span><strong>Mis reservas</strong
        ><span>Tu agenda. Tus partidos. Todo aquí.</span><gg-icon name="arrow"
      /></a>
      <a routerLink="/perfil"
        ><span class="quick-icon"><gg-icon name="user" /></span><strong>Tu espacio</strong
        ><span>Un perfil listo para salir a jugar.</span><gg-icon name="arrow"
      /></a>
    </div>
  </div>`,
})
export class CustomerHome {
  private readonly auth = inject(AuthService);
  readonly name = computed(() => this.auth.user()?.displayName?.trim().split(' ')[0] || 'equipo');
}
