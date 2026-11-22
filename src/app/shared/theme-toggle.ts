import { Component, inject } from '@angular/core';
import { ThemeService } from '../core/services/theme.service';

@Component({
  selector: 'gg-theme-toggle',
  template: `
    <button
      class="theme-toggle"
      type="button"
      (click)="theme.toggle()"
      [attr.aria-label]="theme.theme() === 'dark' ? 'Activar tema claro' : 'Activar tema oscuro'"
      [title]="theme.theme() === 'dark' ? 'Activar tema claro' : 'Activar tema oscuro'"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        @if (theme.theme() === 'dark') {
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
        } @else {
          <path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z" />
        }
      </svg>
    </button>
  `,
})
export class ThemeToggle {
  readonly theme = inject(ThemeService);
}
