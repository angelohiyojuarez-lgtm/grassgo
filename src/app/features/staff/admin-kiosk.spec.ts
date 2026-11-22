import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import { KioskProduct } from '../../core/models/kiosk';
import { KioskService } from '../../core/services/kiosk.service';
import { AdminKiosk } from './admin-kiosk';

it('guía producto, venta y reposición con importes reales, pago recibido, stock válido y reintentos sin cambiar la operación', async () => {
  const saveProduct = vi.fn().mockResolvedValue(undefined);
  const sell = vi.fn().mockResolvedValue(undefined);
  const restock = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [{ provide: KioskService, useValue: { saveProduct, sell, restock } }],
  });
  const page = TestBed.runInInjectionContext(() => new AdminKiosk());
  Object.defineProperty(page, 'establishmentId', { value: () => 'local' });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const product: KioskProduct = {
    id: crypto.randomUUID(),
    name: 'Producto de prueba',
    category: '',
    priceCents: 350,
    costCents: 200,
    stock: 4,
    active: true,
    revision: 1,
    createdAt: 1,
    createdBy: 'admin',
    updatedAt: 1,
    updatedBy: 'admin',
    lastMovementId: crypto.randomUUID(),
  };
  try {
    page.openProduct();
    expect(page.productDraft()).toMatchObject({ price: '', cost: '', initialStock: null });
    await page.saveProduct();
    expect(saveProduct).not.toHaveBeenCalled();
    Object.assign(page.productDraft(), { name: 'Agua elegida', price: '3,50', initialStock: 4 });
    expect(page.hasUnsavedChanges()).toBe(true);
    await page.saveProduct();
    expect(saveProduct).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({
        priceCents: 350,
        costCents: null,
        initialStock: 4,
        name: 'Agua elegida',
        expectedRevision: 0,
      }),
    );
    expect(page.form()).toBeNull();
    page.products.set([product, { ...product, id: crypto.randomUUID(), active: false }]);
    expect(page.shownProducts()).toHaveLength(1);
    page.openAction(product, 'sale');
    expect(page.saleTotal()).toBe(350);
    expect(page.saleProfit()).toBe(150);
    await page.saveAction();
    expect(sell).not.toHaveBeenCalled();
    page.paymentMethod.set('yape');
    page.paymentReceived.set(true);
    page.quantity.set(5);
    await page.saveAction();
    expect(sell).not.toHaveBeenCalled();
    page.quantity.set(2);
    sell.mockRejectedValueOnce(Object.assign(new Error('Sin conexión'), { code: 'unavailable' }));
    await page.saveAction();
    const attempted = sell.mock.calls[0][1];
    expect(page.locked()).toBe(true);
    page.stepQuantity(1);
    expect(page.quantity()).toBe(2);
    expect(page.isSaving()).toBe(false);
    expect(page.hasUnsavedChanges()).toBe(true);
    await page.saveAction();
    expect(sell.mock.calls[1][1]).toEqual(attempted);
    expect(attempted).toMatchObject({
      productId: product.id,
      expectedRevision: 1,
      quantity: 2,
      paymentMethod: 'yape',
      paymentReceived: true,
    });
    expect(page.hasUnsavedChanges()).toBe(false);
    page.openAction({ ...product, costCents: null }, 'sale');
    expect(page.saleProfit()).toBeNull();
    page.closeForm();
    page.openAction(product, 'restock');
    page.quantity.set(1.5);
    await page.saveAction();
    expect(restock).not.toHaveBeenCalled();
    page.quantity.set(3);
    await page.saveAction();
    expect(restock).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({ quantity: 3, expectedRevision: 1 }),
    );
    page.openAction(product, 'sale');
    page.paymentMethod.set('cash');
    page.paymentReceived.set(true);
    sell.mockRejectedValueOnce(
      Object.assign(new Error('El precio cambió'), { code: 'functions/aborted' }),
    );
    await page.saveAction();
    expect(page.form()).toBeNull();
    expect(page.error()).toContain('Vuelve a seleccionar el producto');
    page.openAction({ ...product, stock: 0 }, 'sale');
    expect(page.form()).toBeNull();
  } finally {
    confirm.mockRestore();
    TestBed.resetTestingModule();
  }
});
