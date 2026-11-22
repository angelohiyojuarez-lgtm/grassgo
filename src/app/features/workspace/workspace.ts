import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Icon } from '../../shared/icon';
@Component({
  selector: 'gg-workspace',
  imports: [RouterLink, Icon],
  template: `<div class="page">
    <section class="empty-state panel">
      <span class="empty-icon"
        ><gg-icon
          [name]="
            area === 'reservations' ? 'calendar' : area === 'notfound' ? 'search' : 'shield'
          " /></span
      ><span class="eyebrow">{{
        area === 'notfound' ? 'SIGAMOS EN EL JUEGO' : 'CONSTRUYENDO GRASSGO CONTIGO'
      }}</span>
      <h1>
        {{
          area === 'reservations'
            ? 'Tus próximos partidos, aquí.'
            : area === 'notfound'
              ? 'Esta página salió de la cancha.'
              : area === 'admin'
                ? 'Tu establecimiento, en un solo lugar.'
                : 'El espacio de GrassGo.'
        }}
      </h1>
      <p>
        {{
          area === 'reservations'
            ? 'Todavía no habilitamos las reservas online. Cuando estén disponibles, aquí podrás consultar tus solicitudes y su estado.'
            : area === 'notfound'
              ? 'No encontramos esta dirección. Puedes volver al inicio y seguir explorando.'
              : 'Tu acceso ha sido comprobado. La gestión de establecimientos se incorporará en la siguiente entrega.'
        }}
      </p>
      <a class="button button-primary" [routerLink]="area === 'notfound' ? '/' : '/sedes'"
        >{{ area === 'notfound' ? 'Volver al inicio' : 'Explorar canchas' }}<gg-icon name="arrow"
      /></a>
    </section>
  </div>`,
})
export class Workspace {
  readonly area = inject(ActivatedRoute).snapshot.data['area'];
}
