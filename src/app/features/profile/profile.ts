import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AccessService } from '../../core/auth/access.service';
import { authErrorMessage } from '../../core/auth/auth-errors';
import { ProfileService } from '../../core/services/profile.service';
import { EstablishmentMembership } from '../../core/models/domain';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'gg-profile',
  imports: [FormsModule, RouterLink, Icon],
  templateUrl: './profile.html',
})
export class Profile implements OnInit {
  readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);
  readonly accessNotice = inject(ActivatedRoute).snapshot.queryParamMap.get('access');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly sending = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly permissionsError = signal(false);
  readonly memberships = signal<EstablishmentMembership[]>([]);
  readonly superadmin = signal(false);
  readonly initial = computed(() =>
    (this.auth.user()?.displayName || this.auth.user()?.email || 'G').slice(0, 1).toUpperCase(),
  );
  name = '';
  phone = '';
  private profileLoaded = false;

  async ngOnInit(): Promise<void> {
    const user = this.auth.user();
    if (!user) return;
    this.name = user.displayName || '';
    const permissions = await Promise.allSettled([
      this.access.memberships(),
      this.access.isSuperadmin(),
    ]);
    if (permissions[0].status === 'fulfilled') this.memberships.set(permissions[0].value);
    else this.permissionsError.set(true);
    if (permissions[1].status === 'fulfilled') this.superadmin.set(permissions[1].value);
    else this.permissionsError.set(true);
  }
  onInformationToggle(event: Event): void {
    if ((event.target as HTMLDetailsElement).open && !this.profileLoaded && !this.loading()) {
      void this.loadProfile();
    }
  }
  async loadProfile(): Promise<void> {
    const user = this.auth.user();
    if (!user) return;
    this.error.set('');
    this.loading.set(true);
    try {
      const profile = await this.profiles.get(user.uid);
      if (profile) {
        this.name = profile.displayName;
        this.phone = profile.phone;
      }
      this.profileLoaded = true;
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
  async save(form: NgForm): Promise<void> {
    this.message.set('');
    this.error.set('');
    if (form.invalid || this.name.trim().length < 2) {
      form.control.markAllAsTouched();
      this.error.set('Revisa tu nombre y teléfono antes de guardar.');
      return;
    }
    const user = this.auth.user();
    if (!user) return;
    this.busy.set(true);
    try {
      await this.profiles.save(user.uid, this.name, this.phone);
      this.message.set('Tu perfil se guardó correctamente.');
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  async sendVerification(): Promise<void> {
    this.sending.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await this.auth.verifyEmail();
      this.message.set(
        'Enviamos el enlace de verificación. Revisa tu correo y vuelve a ingresar después de verificarlo.',
      );
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.sending.set(false);
    }
  }
  async logout(): Promise<void> {
    this.busy.set(true);
    try {
      await this.auth.logout();
      await this.router.navigateByUrl('/ingresar');
    } catch (error) {
      this.error.set(authErrorMessage(error));
      this.busy.set(false);
    }
  }
}
