import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';

type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly selected = signal<Theme>('light');
  readonly theme = this.selected.asReadonly();

  constructor() {
    let saved: string | null = null;
    try {
      saved = this.document.defaultView?.localStorage.getItem('grassgo-theme') ?? null;
    } catch {
      // La apariencia sigue funcionando si el navegador bloquea el almacenamiento.
    }
    this.apply(saved === 'dark' ? 'dark' : 'light');
  }

  toggle(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.apply(next);
    try {
      this.document.defaultView?.localStorage.setItem('grassgo-theme', next);
    } catch {
      // No impedir el cambio de tema en navegación privada o sin almacenamiento.
    }
  }

  private apply(theme: Theme): void {
    this.selected.set(theme);
    this.document.documentElement.dataset['theme'] = theme;
    this.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#ffffff' : '#080f0d');
  }
}
