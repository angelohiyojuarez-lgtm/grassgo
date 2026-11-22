import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import { KioskProduct } from '../../core/models/kiosk';
import { KioskService } from '../../core/services/kiosk.service';
import { ProductPhotoService } from '../../core/services/product-photo';
import { AdminKiosk } from './admin-kiosk';

const photo = { prepare: vi.fn() };
const JPEG_A = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(80);
const JPEG_B = 'data:image/jpeg;base64,/9j/' + 'B'.repeat(80);
const selectedFile = () =>
  ({
    files: [new File(['foto de prueba'], 'foto.jpg', { type: 'image/jpeg' })],
    value: 'archivo-seleccionado',
  }) as unknown as HTMLInputElement;

it('permite foto opcional, cambiar o quitar sin afectar importes y descarta preparaciones tardías al cambiar de formulario o salir', async () => {
  const saveProduct = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      { provide: KioskService, useValue: { saveProduct } },
      { provide: ProductPhotoService, useValue: photo },
    ],
  });
  const page = TestBed.runInInjectionContext(() => new AdminKiosk());
  Object.defineProperty(page, 'establishmentId', { value: () => 'local' });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const product: KioskProduct = {
    id: crypto.randomUUID(),
    name: 'Producto existente',
    category: '',
    priceCents: 450,
    costCents: 300,
    stock: 5,
    active: true,
    revision: 2,
    createdAt: 1,
    createdBy: 'admin',
    updatedAt: 1,
    updatedBy: 'admin',
    lastMovementId: crypto.randomUUID(),
    photo: JPEG_A,
  };
  try {
    page.openProduct();
    Object.assign(page.productDraft(), {
      name: 'Producto sin foto',
      price: '4.50',
      initialStock: 5,
    });
    await page.saveProduct();
    expect(saveProduct).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({ photo: null, priceCents: 450, costCents: null }),
    );
    page.openProduct(product);
    expect(page.productDraft().photo).toBe(JPEG_A);
    expect(page.hasUnsavedChanges()).toBe(false);
    page.removePhoto();
    expect(page.productDraft().photo).toBeNull();
    expect(page.hasUnsavedChanges()).toBe(true);
    expect(product.photo).toBe(JPEG_A);
    page.openProduct(product);
    photo.prepare.mockResolvedValueOnce(JPEG_B);
    const input = selectedFile();
    await page.selectPhoto(input);
    expect(input.value).toBe('');
    expect(page.productDraft().photo).toBe(JPEG_B);
    expect(page.hasUnsavedChanges()).toBe(true);
    await page.saveProduct();
    expect(saveProduct).toHaveBeenLastCalledWith(
      'local',
      expect.objectContaining({ photo: JPEG_B, priceCents: 450, costCents: 300 }),
    );
    page.openProduct(product);
    photo.prepare.mockRejectedValueOnce(new Error('No se pudo leer la foto.'));
    await page.selectPhoto(selectedFile());
    expect(page.photoError()).toContain('No se pudo leer');
    expect(page.productDraft().photo).toBe(JPEG_A);
    let complete!: (value: string) => void;
    photo.prepare.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = page.selectPhoto(selectedFile());
    expect(page.isSaving()).toBe(true);
    await page.saveProduct();
    expect(saveProduct).toHaveBeenCalledTimes(2);
    page.openProduct();
    complete(JPEG_B);
    await pending;
    expect(page.productDraft().photo).toBeNull();
    expect(page.isSaving()).toBe(false);
    page.openProduct(product);
    photo.prepare.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    const afterExit = page.selectPhoto(selectedFile());
    page.ngOnDestroy();
    complete(JPEG_B);
    await afterExit;
    expect(page.productDraft().photo).toBe(JPEG_A);
    expect(page.photoPreparing()).toBe(false);
  } finally {
    confirm.mockRestore();
    TestBed.resetTestingModule();
  }
});
