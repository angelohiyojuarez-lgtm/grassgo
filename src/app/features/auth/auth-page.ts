import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { authErrorMessage } from '../../core/auth/auth-errors';
import { Icon } from '../../shared/icon';
import { AccessService } from '../../core/auth/access.service';

@Component({
  selector: 'gg-auth-page',
  imports: [FormsModule, RouterLink, Icon],
  templateUrl: './auth-page.html',
})
export class AuthPage {
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly access = inject(AccessService);
  private readonly data = toSignal(this.route.data, { initialValue: this.route.snapshot.data });
  readonly mode = computed(() => this.data()['mode'] as 'login' | 'register' | 'reset');
  readonly portal = computed(() => (this.data()['portal'] as string) || 'client');
  readonly loginPath = computed(() =>
    this.portal() === 'superadmin'
      ? '/superadmin/ingresar'
      : this.portal() === 'admin'
        ? '/admin/ingresar'
        : '/ingresar',
  );
  readonly resetPath = computed(() =>
    this.portal() === 'superadmin' ? '/superadmin/recuperar' : '/recuperar',
  );
  readonly portalName = computed(() =>
    this.portal() === 'admin'
      ? 'Administración del local'
      : this.portal() === 'superadmin'
        ? 'Superadministración'
        : 'Tu próxima pichanga empieza aquí',
  );
  readonly denied = this.route.snapshot.queryParamMap.get('access');
  readonly waves = Array.from(
    { length: 22 },
    (_, i) =>
      `M -180 ${270 + i * 9} C 140 ${30 + i * 9}, 240 ${600 + i * 4}, 620 ${330 + i * 7} S 1080 ${-40 + i * 7}, 1480 ${130 + i * 9}`,
  );
  readonly busy = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly visible = signal(false);
  name = '';
  email = '';
  password = '';

  async submit(form: NgForm): Promise<void> {
    this.error.set('');
    this.success.set('');
    if (form.invalid || (this.mode() === 'register' && this.name.trim().length < 2)) {
      form.control.markAllAsTouched();
      this.error.set('Revisa los campos marcados para continuar.');
      return;
    }
    this.busy.set(true);
    const mode = this.mode();
    try {
      if (mode === 'reset') {
        await this.auth.resetPassword(this.email);
        this.success.set(
          'Si existe una cuenta con este correo, recibirás las instrucciones para recuperar tu contraseña. Revisa también la carpeta de spam.',
        );
      } else {
        if (mode === 'register') await this.auth.register(this.name, this.email, this.password);
        else await this.auth.login(this.email, this.password);
        await this.continue();
      }
    } catch (error) {
      if (mode === 'reset' && (error as { code?: string })?.code === 'auth/user-not-found') {
        this.success.set(
          'Si existe una cuenta con este correo, recibirás las instrucciones para recuperar tu contraseña.',
        );
      } else if (mode === 'register' && this.auth.user()) {
        this.error.set(
          'Tu cuenta se creó, pero no pudimos guardar tu nombre. Puedes completar tu perfil desde Mi cuenta.',
        );
      } else this.error.set(authErrorMessage(error));
    } finally {
      this.password = '';
      this.busy.set(false);
    }
  }
  async continue(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      if (this.portal() === 'admin' && !(await this.access.memberships()).length) {
        this.error.set(
          'Esta cuenta no tiene un establecimiento asignado. Solicita acceso al responsable de GrassGo.',
        );
        return;
      }
      if (this.portal() === 'superadmin' && !(await this.access.isSuperadmin())) {
        this.error.set('Esta cuenta no tiene permisos de superadministración.');
        return;
      }
      const next = this.route.snapshot.queryParamMap.get('next');
      const prefix =
        this.portal() === 'admin'
          ? '/admin/inicio'
          : this.portal() === 'superadmin'
            ? '/superadmin/inicio'
            : '/inicio';
      const allowed =
        this.portal() === 'client'
          ? /^\/(inicio|perfil|reservas|sedes|reservar|invitaciones)(\/|\?|$)/
          : this.portal() === 'admin'
            ? /^\/admin\/inicio(\?|$)/
            : /^\/superadmin\/(inicio|negocios(?:\/nuevo|\/[a-zA-Z0-9-]{1,80}\/configurar)?|actividad|configuracion)(\?|$)/;
      await this.router.navigateByUrl(next && allowed.test(next) ? next : prefix);
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  async switchAccount(): Promise<void> {
    this.busy.set(true);
    try {
      await this.auth.logout();
      this.error.set('');
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
