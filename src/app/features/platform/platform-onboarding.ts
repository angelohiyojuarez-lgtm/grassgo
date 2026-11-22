import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  PlatformOnboardingService,
  advanceInputCents,
  onboardingError,
} from '../../core/services/platform-onboarding.service';
import {
  CourtDraft,
  PlatformCourtFields,
  emptyCourtDraft,
  readCourtDraft,
} from './platform-court-editor';

@Component({
  selector: 'gg-platform-onboarding',
  imports: [FormsModule, RouterLink, PlatformCourtFields],
  templateUrl: './platform-onboarding.html',
  styleUrl: './platform-onboarding.css',
})
export class PlatformOnboarding {
  private readonly service = inject(PlatformOnboardingService);
  private readonly router = inject(Router);
  private readonly requestId = crypto.randomUUID();
  readonly step = signal(1);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly registrationStarted = signal(false);
  name = '';
  location = '';
  ownerEmail = '';
  advance = '';
  readonly courts = signal<CourtDraft[]>([emptyCourtDraft('principal')]);
  readonly maxCourts = 20;

  next(): void {
    this.error.set('');
    if (
      this.name.trim().length < 2 ||
      this.location.trim().length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.ownerEmail.trim()) ||
      advanceInputCents(this.advance) === null
    ) {
      this.error.set('Completa el nombre, la ubicación, el correo del dueño y el adelanto real.');
      return;
    }
    this.step.set(2);
  }
  back(): void {
    if (!this.busy() && !this.registrationStarted()) {
      this.step.set(1);
      this.error.set('');
    }
  }
  addCourt(): void {
    if (this.busy() || this.registrationStarted() || this.courts().length >= this.maxCourts) return;
    this.courts.update((courts) => [...courts, emptyCourtDraft(crypto.randomUUID())]);
  }
  removeCourt(id: string): void {
    if (
      this.busy() ||
      this.registrationStarted() ||
      id === 'principal' ||
      this.courts().length <= 1
    )
      return;
    this.courts.update((courts) => courts.filter((court) => court.id !== id));
  }
  async save(): Promise<void> {
    if (this.busy()) return;
    const advanceCents = advanceInputCents(this.advance);
    if (advanceCents === null) {
      this.error.set('Indica el adelanto real del negocio.');
      return;
    }
    const courts = this.courts().map((court) => readCourtDraft(court, advanceCents));
    const invalid = courts.findIndex((court) => court === null);
    if (invalid !== -1 || courts.length < 1 || courts.length > this.maxCourts) {
      this.error.set(
        `Revisa la cancha ${invalid + 1}: completa su nombre, deporte, superficie, precios y hora de noche. Los precios no pueden ser menores que el adelanto.`,
      );
      return;
    }
    this.busy.set(true);
    this.registrationStarted.set(true);
    this.error.set('');
    try {
      const result = await this.service.create({
        requestId: this.requestId,
        name: this.name,
        location: this.location,
        ownerEmail: this.ownerEmail,
        courts: courts.filter((court) => court !== null),
        advanceCents,
      });
      await this.router.navigate(['/superadmin/negocios'], { queryParams: { creado: result.id } });
    } catch (error) {
      // Conserva el intento y las canchas para reanudar un registro parcial.
      this.error.set(onboardingError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
