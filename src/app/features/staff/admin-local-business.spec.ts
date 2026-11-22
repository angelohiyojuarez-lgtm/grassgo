import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLocalBusiness, PAYMENT_QR_PREPARER } from './admin-local-business';
import { EstablishmentBusinessService } from '../../core/services/establishment-business.service';
import { BusinessMediaService } from '../../core/services/business-media.service';
import {
  AdminBusinessData,
  BusinessContact,
  BusinessPayment,
  PreparedPaymentQr,
} from '../../core/models/establishment-business';
const preparePaymentQr = vi.fn();

const qr = (id = 'foto-qr'): PreparedPaymentQr => ({
  id,
  imageData: 'data:image/jpeg;base64,/9j/AAAA',
  contentType: 'image/jpeg',
  width: 500,
  height: 500,
  sha256: 'a'.repeat(64),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('Datos y QR del administrador del local', () => {
  let data: AdminBusinessData;
  let service: {
    load: ReturnType<typeof vi.fn>;
    saveContact: ReturnType<typeof vi.fn>;
    savePayment: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.mocked(preparePaymentQr).mockReset().mockResolvedValue(qr());
    data = {
      name: 'Local de prueba',
      contact: {
        phone: '999111222',
        reference: 'Frente a la plaza',
        description: 'Local deportivo',
        revision: 1,
      },
      payment: {
        methods: ['Yape'],
        recipient: 'Titular del negocio',
        phone: '999333444',
        qr: 'payment-qrs/local-prueba/qr-guardado',
        revision: 2,
      },
    };
    service = {
      load: vi.fn(async () => structuredClone(data)),
      saveContact: vi.fn(async (_id: string, value: BusinessContact) => {
        data.contact = { ...value, revision: value.revision + 1 };
        return structuredClone(data.contact);
      }),
      savePayment: vi.fn(async (_id: string, value: BusinessPayment) => {
        data.payment = { ...value, methods: [...value.methods], revision: value.revision + 1 };
        return structuredClone(data.payment);
      }),
    };
    TestBed.configureTestingModule({
      imports: [AdminLocalBusiness],
      providers: [
        { provide: EstablishmentBusinessService, useValue: service },
        { provide: PAYMENT_QR_PREPARER, useValue: preparePaymentQr },
        { provide: BusinessMediaService, useValue: { read: vi.fn(async () => qr().imageData) } },
      ],
    });
  });
  async function setup(): Promise<ComponentFixture<AdminLocalBusiness>> {
    const fixture = TestBed.createComponent(AdminLocalBusiness);
    fixture.componentRef.setInput('establishmentId', 'local-prueba');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  const photo = () => new File(['foto'], 'qr.jpg', { type: 'image/jpeg' });

  it('carga los datos sin publicar cambios ni afirmar que un comprobante verifica un pago', async () => {
    const fixture = await setup(),
      component = fixture.componentInstance;
    expect(component.contact.phone).toBe('999111222');
    expect(component.payment.phone).toBe('999333444');
    expect(component.hasUnsavedChanges()).toBe(false);
    expect(component.paymentReviewed).toBe(false);
    expect(service.saveContact).not.toHaveBeenCalled();
    expect(service.savePayment).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Tú revisas que el dinero haya ingresado');
    expect(fixture.nativeElement.textContent).toContain(
      'Guardar estos datos no activa las reservas',
    );
  });
  it('ofrece campos vacíos sin inventar datos del negocio o copiar el celular al pago', async () => {
    data.contact = { phone: '', description: '', reference: '', revision: 0 };
    data.payment = { methods: [], recipient: '', phone: '', qr: '', revision: 0 };
    const fixture = await setup(),
      component = fixture.componentInstance;
    component.contact.phone = '999222111';
    await component.saveContact();
    expect(component.payment.phone).toBe('');
    expect(component.payment.recipient).toBe('');
    expect(component.payment.methods).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Subir foto de mi QR');
  });
  it('guarda contacto y conserva el borrador de pago y su foto pendiente', async () => {
    const component = (await setup()).componentInstance;
    component.contact.phone = ' 999000111 ';
    component.contact.reference = '  Al lado del colegio  ';
    component.payment.recipient = 'Nuevo titular';
    await component.chooseQr(photo());
    await component.saveContact();
    expect(service.saveContact).toHaveBeenCalledExactlyOnceWith('local-prueba', {
      phone: '999000111',
      reference: 'Al lado del colegio',
      description: 'Local deportivo',
      revision: 1,
    });
    expect(component.contact.revision).toBe(2);
    expect(component.payment.recipient).toBe('Nuevo titular');
    expect(component.stagedQr()?.id).toBe('foto-qr');
    expect(component.hasUnsavedChanges()).toBe(true);
    expect(service.savePayment).not.toHaveBeenCalled();
  });
  it.each([
    { phone: 'hola' },
    { phone: '1'.repeat(21) },
    { description: 'x'.repeat(1001) },
    { reference: 'x'.repeat(301) },
  ])('no envía campos de contacto inválidos: %o', async (fields) => {
    const component = (await setup()).componentInstance;
    Object.assign(component.contact, fields);
    await component.saveContact();
    expect(service.saveContact).not.toHaveBeenCalled();
    expect(component.contactError()).toContain('Revisa el celular');
  });
  it('prepara y muestra la foto sin guardarla hasta revisar y enviar el formulario', async () => {
    const fixture = await setup(),
      component = fixture.componentInstance;
    await component.chooseQr(photo());
    fixture.detectChanges();
    expect(preparePaymentQr).toHaveBeenCalledOnce();
    expect(
      fixture.nativeElement
        .querySelector('img[alt="Vista previa de tu nuevo QR de pago"]')
        ?.getAttribute('src'),
    ).toBe(qr().imageData);
    expect(fixture.nativeElement.textContent).toContain('todavía no está guardada');
    expect(service.savePayment).not.toHaveBeenCalled();
    await component.savePayment();
    expect(service.savePayment).not.toHaveBeenCalled();
    expect(component.paymentError()).toContain('casilla de revisión');
    component.reviewPayment(true);
    component.contact.description = 'Borrador del otro formulario';
    await component.savePayment();
    expect(service.savePayment).toHaveBeenCalledExactlyOnceWith(
      'local-prueba',
      { ...data.payment, revision: 2 },
      qr(),
    );
    expect(component.payment.qr).toBe('payment-qrs/local-prueba/foto-qr');
    expect(component.payment.revision).toBe(3);
    expect(component.stagedQr()).toBeNull();
    expect(component.paymentReviewed).toBe(false);
    expect(component.contact.description).toBe('Borrador del otro formulario');
    expect(component.hasUnsavedChanges()).toBe(true);
  });
  it('editar cualquier dato del pago invalida la revisión aunque el QR guardado no cambie', async () => {
    const component = (await setup()).componentInstance;
    component.reviewPayment(true);
    component.payment.phone = '999222111';
    await component.savePayment();
    expect(service.savePayment).not.toHaveBeenCalled();
    expect(component.paymentReviewed).toBe(false);
    component.reviewPayment(true);
    component.toggleMethod('Plin');
    expect(component.payment.methods).toEqual(['Yape', 'Plin']);
    expect(component.paymentReviewed).toBe(false);
    await component.savePayment();
    expect(service.savePayment).not.toHaveBeenCalled();
  });
  it('no permite guardar un QR legado sin subir nuevamente su imagen', async () => {
    data.payment.qr = '/assets/demo-payment-qr.svg';
    const fixture = await setup(),
      component = fixture.componentInstance;
    expect(component.legacyQr()).toBe(true);
    component.reviewPayment(true);
    await component.savePayment();
    expect(component.paymentError()).toContain('Primero sube una foto');
    expect(service.savePayment).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('vuelve a subir la foto');
  });
  it.each([
    { methods: [] },
    { methods: ['Yape', 'Yape'] },
    { methods: ['Tarjeta'] },
    { recipient: 'x' },
    { recipient: 'x'.repeat(101) },
    { phone: '123' },
    { phone: 'nueve dígitos' },
  ])('valida el destinatario y los métodos antes de enviar: %o', async (fields) => {
    const component = (await setup()).componentInstance;
    Object.assign(component.payment, fields);
    component.reviewPayment(true);
    await component.savePayment();
    expect(service.savePayment).not.toHaveBeenCalled();
    expect(component.paymentError()).toContain('Elige Yape o Plin');
  });
  it('una foto inválida retira la selección nueva y conserva el QR ya guardado', async () => {
    const component = (await setup()).componentInstance;
    await component.chooseQr(photo());
    component.reviewPayment(true);
    vi.mocked(preparePaymentQr).mockRejectedValueOnce({
      code: 'functions/invalid-argument',
      message: 'Elige una foto JPG válida.',
    });
    await component.chooseQr(photo());
    expect(component.stagedQr()).toBeNull();
    expect(component.payment.qr).toBe('payment-qrs/local-prueba/qr-guardado');
    expect(component.paymentReviewed).toBe(false);
    expect(component.paymentError()).toBe('Elige una foto JPG válida.');
    expect(component.isSaving()).toBe(false);
  });
  it('procesar una foto protege la salida y no permite guardar antes de tener la vista previa', async () => {
    const component = (await setup()).componentInstance;
    const preparing = deferred<PreparedPaymentQr>();
    vi.mocked(preparePaymentQr).mockReturnValueOnce(preparing.promise);
    const pending = component.chooseQr(photo());
    expect(component.isSaving()).toBe(true);
    expect(component.hasUnsavedChanges()).toBe(true);
    const event = new Event('beforeunload', { cancelable: true });
    component.beforeUnload(event);
    expect(event.defaultPrevented).toBe(true);
    await component.savePayment();
    await component.saveContact();
    expect(service.savePayment).not.toHaveBeenCalled();
    expect(service.saveContact).not.toHaveBeenCalled();
    preparing.resolve(qr());
    await pending;
    expect(component.processing()).toBe(false);
  });
  it('la preparación anterior no reemplaza una foto más reciente', async () => {
    const component = (await setup()).componentInstance;
    const first = deferred<PreparedPaymentQr>(),
      second = deferred<PreparedPaymentQr>();
    vi.mocked(preparePaymentQr)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const old = component.chooseQr(photo()),
      current = component.chooseQr(photo());
    first.resolve(qr('foto-anterior'));
    await old;
    expect(component.stagedQr()).toBeNull();
    expect(component.processing()).toBe(true);
    second.resolve(qr('foto-actual'));
    await current;
    expect(component.stagedQr()?.id).toBe('foto-actual');
  });
  it('no asigna una foto ni datos cargados de un establecimiento anterior', async () => {
    const fixture = await setup(),
      component = fixture.componentInstance;
    const preparing = deferred<PreparedPaymentQr>();
    vi.mocked(preparePaymentQr).mockReturnValueOnce(preparing.promise);
    const previous = component.chooseQr(photo());
    const delayedLoad = deferred<AdminBusinessData>();
    service.load
      .mockReturnValueOnce(delayedLoad.promise)
      .mockResolvedValueOnce({ ...structuredClone(data), name: 'Tercer local' });
    fixture.componentRef.setInput('establishmentId', 'segundo-local');
    fixture.detectChanges();
    fixture.componentRef.setInput('establishmentId', 'tercer-local');
    fixture.detectChanges();
    preparing.resolve(qr('foto-del-primer-local'));
    delayedLoad.resolve({ ...structuredClone(data), name: 'Segundo local' });
    await previous;
    await fixture.whenStable();
    expect(component.name()).toBe('Tercer local');
    expect(component.stagedQr()).toBeNull();
    expect(component.processing()).toBe(false);
    expect(component.hasUnsavedChanges()).toBe(false);
  });
  it('evita duplicar un guardado de pago y conserva el borrador si falla', async () => {
    const component = (await setup()).componentInstance;
    await component.chooseQr(photo());
    component.reviewPayment(true);
    const saving = deferred<BusinessPayment>();
    service.savePayment.mockReturnValueOnce(saving.promise);
    const first = component.savePayment();
    await component.savePayment();
    expect(service.savePayment).toHaveBeenCalledOnce();
    expect(component.isSaving()).toBe(true);
    saving.reject({
      code: 'functions/aborted',
      message: 'Otra persona actualizó los datos de pago.',
    });
    await first;
    expect(component.paymentError()).toBe('Otra persona actualizó los datos de pago.');
    expect(component.stagedQr()?.id).toBe('foto-qr');
    expect(component.hasUnsavedChanges()).toBe(true);
    expect(component.isSaving()).toBe(false);
  });
  it('reconsultar datos requiere descartar explícitamente solo el formulario elegido', async () => {
    const component = (await setup()).componentInstance;
    component.contact.reference = 'Borrador de referencia';
    component.payment.recipient = 'Borrador de titular';
    service.load.mockClear();
    component.requestReload('payment');
    expect(component.pendingReload()).toBe('payment');
    expect(service.load).not.toHaveBeenCalled();
    component.pendingReload.set(null);
    expect(component.payment.recipient).toBe('Borrador de titular');
    component.requestReload('payment');
    component.confirmReload();
    await vi.waitFor(() => expect(component.busy()).toBe(false));
    expect(component.payment.recipient).toBe('Titular del negocio');
    expect(component.contact.reference).toBe('Borrador de referencia');
    expect(component.pendingReload()).toBeNull();
    expect(component.hasUnsavedChanges()).toBe(true);
  });
  it('mantiene los cambios al fallar la consulta de una sección', async () => {
    const component = (await setup()).componentInstance;
    component.contact.description = 'Mi borrador';
    component.payment.recipient = 'Mi nuevo titular';
    service.load.mockRejectedValueOnce({ code: 'functions/unavailable' });
    component.requestReload('contact');
    component.confirmReload();
    await vi.waitFor(() => expect(component.busy()).toBe(false));
    expect(component.contact.description).toBe('Mi borrador');
    expect(component.payment.recipient).toBe('Mi nuevo titular');
    expect(component.contactError()).toContain('Tus cambios siguen aquí');
    expect(component.pendingReload()).toBe('contact');
  });
  it('cargar un local sin acceso muestra un error claro y ninguna acción falsa de guardar', async () => {
    service.load.mockRejectedValueOnce({ code: 'functions/permission-denied' });
    const fixture = await setup(),
      component = fixture.componentInstance;
    expect(component.loadError()).toContain('No tienes permiso');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Volver a consultar');
  });
});
