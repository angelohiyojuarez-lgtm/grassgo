import { Component, computed, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from './core/auth/auth.service';
import { Icon } from './shared/icon';
import { ThemeToggle } from './shared/theme-toggle';
import { NotificationCenter } from './shared/notification-center';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, ThemeToggle, NotificationCenter],
  templateUrl: './app.html',
})
export class App {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: '/' },
  );
  readonly accessPage = computed(() =>
    /^(\/|\/ingresar|\/registro|\/recuperar|\/admin\/ingresar|\/superadmin\/(ingresar|recuperar))(\?|$)/.test(
      this.url(),
    ),
  );
  readonly staffPage = computed(() => /^\/(admin|superadmin)\//.test(this.url()));
  readonly platformPage = computed(() => this.url().startsWith('/superadmin/'));
  readonly skipTarget = computed(() => `${this.url().split('#')[0]}#contenido`);
  readonly staffHome = computed(() =>
    this.url().startsWith('/superadmin/') ? '/superadmin/inicio' : '/admin/inicio',
  );
  constructor() {
    effect(() => {
      if (!this.auth.loading() && !this.auth.user() && !this.accessPage()) {
        const url = this.url();
        const login = url.startsWith('/superadmin/')
          ? '/superadmin/ingresar'
          : url.startsWith('/admin/')
            ? '/admin/ingresar'
            : '/ingresar';
        void this.router.navigate([login], { queryParams: { next: url } });
      }
    });
  }
}
