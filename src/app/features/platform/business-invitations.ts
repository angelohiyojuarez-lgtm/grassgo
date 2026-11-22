import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import {
  BusinessInvitation,
  PlatformOnboardingService,
  onboardingError,
} from '../../core/services/platform-onboarding.service';

@Component({
  selector: 'gg-business-invitations',
  imports: [RouterLink],
  templateUrl: './business-invitations.html',
  styleUrl: './business-invitations.css',
})
export class BusinessInvitations implements OnInit {
  readonly auth = inject(AuthService);
  private readonly service = inject(PlatformOnboardingService);
  readonly invitations = signal<BusinessInvitation[]>([]);
  readonly loading = signal(true);
  readonly busy = signal('');
  readonly error = signal('');
  readonly message = signal('');
  ngOnInit(): void {
    void this.refresh();
  }
  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.invitations.set(await this.service.invitations());
    } catch (error) {
      this.error.set(onboardingError(error));
    } finally {
      this.loading.set(false);
    }
  }
  async accept(invitation: BusinessInvitation): Promise<void> {
    if (this.busy()) return;
    this.busy.set(invitation.id);
    this.error.set('');
    this.message.set('');
    try {
      await this.service.accept(invitation.id);
      this.message.set(
        `Ya administras ${invitation.establishmentName}. Entra a Mi local para completar su información.`,
      );
      await this.refresh();
    } catch (error) {
      this.error.set(onboardingError(error));
    } finally {
      this.busy.set('');
    }
  }
  async verifyEmail(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('verification');
    this.error.set('');
    this.message.set('');
    try {
      await this.auth.verifyEmail();
      this.message.set(
        'Te enviamos el enlace de verificación. Abre tu correo y, al terminar, vuelve y acepta la invitación.',
      );
    } catch (error) {
      this.error.set(onboardingError(error));
    } finally {
      this.busy.set('');
    }
  }
}
