import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessEditor } from './business-editor';
import { BookingService } from '../../core/services/booking.service';
import { BusinessMediaService } from '../../core/services/business-media.service';

describe('Portada y galería del establecimiento', () => {
  let editor: BusinessEditor;
  const revoke = vi.fn();
  beforeEach(() => {
    const NativeURL = URL;
    let count = 0;
    vi.stubGlobal(
      'URL',
      class extends NativeURL {
        static override createObjectURL = () => `blob:foto-${++count}`;
        static override revokeObjectURL = revoke;
      },
    );
    revoke.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) },
          },
        },
        { provide: BookingService, useValue: { call: vi.fn() } },
        { provide: BusinessMediaService, useValue: { read: vi.fn(), upload: vi.fn() } },
      ],
    });
    editor = TestBed.runInInjectionContext(() => new BusinessEditor());
  });
  afterEach(() => {
    editor.ngOnDestroy();
    vi.unstubAllGlobals();
  });
  const selection = (files: File[]): Event => {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: files });
    return { target: input } as unknown as Event;
  };
  const photo = (name: string) => new File(['photo'], name, { type: 'image/png' });
  it('elegir portada cambia el orden y marca el borrador pendiente de guardar', () => {
    editor.chooseBusinessImages(selection([photo('fachada.png'), photo('panoramica.png')]));
    editor.saved.set(true);
    editor.makeBusinessCover(1);
    expect(editor.establishmentImages().map((image) => image.file?.name)).toEqual([
      'panoramica.png',
      'fachada.png',
    ]);
    expect(editor.saved()).toBe(false);
    editor.removeBusinessImage(0);
    expect(editor.establishmentImages()[0].file?.name).toBe('fachada.png');
    expect(revoke).toHaveBeenCalledWith('blob:foto-2');
  });
  it('no usa las fotos de la cancha como portada del local', () => {
    editor.config.courts[0].images = ['business-media/local/cancha'];
    expect(editor.missing()).toContain('Foto de portada del establecimiento.');
    editor.chooseBusinessImages(selection([photo('local.png')]));
    expect(editor.missing()).not.toContain('Foto de portada del establecimiento.');
    expect(editor.config.courts[0].images).toEqual(['business-media/local/cancha']);
  });
  it('rechaza formatos inválidos y más de cinco fotos sin alterar la selección', () => {
    editor.chooseBusinessImages(
      selection([new File(['svg'], 'imagen.svg', { type: 'image/svg+xml' })]),
    );
    expect(editor.establishmentImages()).toHaveLength(0);
    editor.chooseBusinessImages(selection(Array.from({ length: 5 }, (_, i) => photo(`${i}.png`))));
    editor.chooseBusinessImages(selection([photo('extra.png')]));
    expect(editor.establishmentImages()).toHaveLength(5);
    expect(editor.error()).toContain('hasta 5 fotos');
  });
  it('reabre un borrador anterior sin perder sus datos aunque todavía no tenga fotos del local', async () => {
    const { images, ...previous } = editor.config;
    previous.name = 'Negocio existente';
    previous.reference = 'Referencia guardada';
    previous.courts[0].name = 'Cancha conservada';
    vi.mocked(TestBed.inject(BookingService).call).mockResolvedValue({
      id: 'existente',
      name: previous.name,
      location: 'Talavera',
      status: 'draft',
      revision: 3,
      configuration: previous,
    });
    editor.businessId.set('existente');
    await editor.ngOnInit();
    expect(editor.config.images).toEqual([]);
    expect(editor.config.reference).toBe('Referencia guardada');
    expect(editor.config.courts[0].name).toBe('Cancha conservada');
    expect(editor.revision()).toBe(3);
    expect(editor.saved()).toBe(true);
  });
});
