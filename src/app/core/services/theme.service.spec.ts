import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeService } from './theme.service';

describe('Preferencia de apariencia', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    localStorage.removeItem('grassgo-theme');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('grassgo-theme');
    delete document.documentElement.dataset['theme'];
  });
  it('abre en claro cuando no hay una elección anterior', () => {
    expect(TestBed.inject(ThemeService).theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
  it('recupera el tema claro al volver a abrir la aplicación', () => {
    localStorage.setItem('grassgo-theme', 'light');
    expect(TestBed.inject(ThemeService).theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
  it('respeta el tema oscuro elegido por el usuario', () => {
    localStorage.setItem('grassgo-theme', 'dark');
    expect(TestBed.inject(ThemeService).theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
  it('alterna los temas y conserva la elección', () => {
    const theme = TestBed.inject(ThemeService);
    theme.toggle();
    expect(localStorage.getItem('grassgo-theme')).toBe('dark');
    theme.toggle();
    expect(localStorage.getItem('grassgo-theme')).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
  it('mantiene el cambio operativo cuando el navegador bloquea el almacenamiento', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Bloqueado');
    });
    const theme = TestBed.inject(ThemeService);
    expect(theme.theme()).toBe('light');
    expect(() => theme.toggle()).not.toThrow();
    expect(theme.theme()).toBe('dark');
  });
});
