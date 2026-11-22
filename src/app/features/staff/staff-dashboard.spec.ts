import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { AccessService } from '../../core/auth/access.service';
import { FirebaseService } from '../../core/firebase/firebase.service';
import { BookingService } from '../../core/services/booking.service';
import { Reservation } from '../../core/models/booking';
import { StaffDashboard } from './staff-dashboard';
import { AdminLocalSchedule } from './admin-local-schedule';
import { AdminLocalBusiness } from './admin-local-business';
import { AdminLocalPricing } from './admin-local-pricing';

const NativeURL = URL;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const overview = (name = 'Grass El Puma', reservations: Reservation[] = []) => ({
  engine: 'direct' as const,
  name,
  reservations,
  courts: [],
});
const reservation = (id = 'solicitud-1'): Reservation => ({
  id,
  engine: 'direct',
  establishmentId: 'el-puma',
  establishmentName: 'Grass El Puma',
  courtId: 'principal',
  courtName: 'Cancha principal',
  clientUid: 'cliente',
  date: '2030-01-20',
  hour: 20,
  totalCents: 4000,
  advanceCents: 1000,
  status: 'pending_verification',
  paymentStatus: 'submitted',
  expiresAt: Date.now() + 10 * 60000,
  startsAt: Date.now() + 24 * 3600000,
  proofPath: 'direct-proofs/' + id,
  demo: true,
});

describe('Uso sencillo del panel del establecimiento', () => {
  let panel: StaffDashboard;
  const call = vi.fn(),
    readProof = vi.fn(),
    memberships = vi.fn(),
    createUrl = vi.fn(),
    revokeUrl = vi.fn();

  beforeEach(() => {
    call
      .mockReset()
      .mockImplementation(async (name: string) =>
        name === 'reviewPayment' ? { success: true } : overview(),
      );
    readProof.mockReset().mockResolvedValue(new Blob(['imagen'], { type: 'image/jpeg' }));
    memberships
      .mockReset()
      .mockResolvedValue([
        { establishmentId: 'el-puma', name: 'Grass El Puma', role: 'admin', status: 'active' },
      ]);
    createUrl.mockReset().mockReturnValue('blob:comprobante-actual');
    revokeUrl.mockReset();
    vi.stubGlobal(
      'URL',
      class extends NativeURL {
        static override createObjectURL = createUrl;
        static override revokeObjectURL = revokeUrl;
      },
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { logout: vi.fn(), user: () => ({ uid: 'admin' }) } },
        { provide: AccessService, useValue: { memberships } },
        { provide: FirebaseService, useValue: {} },
        { provide: BookingService, useValue: { call, readProof } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { portal: 'admin' } } } },
      ],
    });
    panel = TestBed.runInInjectionContext(() => new StaffDashboard());
  });
  afterEach(() => {
    panel.ngOnDestroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('abre la agenda del establecimiento asignado y conserva la fecha elegida', async () => {
    panel.date.set('2030-01-20');
    await panel.initialize();
    expect(panel.selected()).toBe('el-puma');
    expect(call).toHaveBeenCalledExactlyOnceWith('adminOverview', {
      establishmentId: 'el-puma',
      date: '2030-01-20',
    });
    expect(panel.overview()?.name).toBe('Grass El Puma');
  });

  it('Mi local conserva el motor directo al cargar y cambiar de pestaña', async () => {
    await panel.initialize();
    expect(panel.isDirectLocal()).toBe(true);
    const opening = panel.setTab('configuracion');
    expect(panel.isDirectLocal()).toBe(true);
    await opening;
    expect(panel.tab()).toBe('configuracion');
  });

  it('cancelar la salida conserva el horario editado y no consulta otra pestaña', async () => {
    await panel.initialize();
    panel.tab.set('configuracion');
    panel.localSchedule = {
      hasUnsavedChanges: () => true,
      isSaving: () => false,
    } as AdminLocalSchedule;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    call.mockClear();
    await panel.setTab('reservas');
    expect(panel.tab()).toBe('configuracion');
    expect(call).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    expect(panel.canLeavePage()).toBe(false);
  });

  it('impide cambiar de establecimiento durante un guardado y rechaza locales ajenos', async () => {
    await panel.initialize();
    panel.memberships.set([
      ...panel.memberships(),
      {
        establishmentId: 'segundo',
        name: 'Otro local',
        role: 'admin',
        status: 'active',
      },
    ]);
    panel.tab.set('configuracion');
    panel.localSchedule = {
      hasUnsavedChanges: () => true,
      isSaving: () => true,
    } as AdminLocalSchedule;
    call.mockClear();
    await panel.selectEstablishment('segundo');
    expect(panel.selected()).toBe('el-puma');
    expect(panel.canLeavePage()).toBe(false);
    panel.localSchedule = undefined;
    await panel.selectEstablishment('local-ajeno');
    expect(panel.selected()).toBe('el-puma');
    expect(call).not.toHaveBeenCalled();
  });

  it('permite elegir Datos y QR o Horarios sin perder cambios pendientes', () => {
    panel.tab.set('configuracion');
    expect(panel.localSection()).toBe('datos');
    panel.localBusiness = {
      hasUnsavedChanges: () => true,
      isSaving: () => false,
    } as AdminLocalBusiness;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    panel.setLocalSection('horarios');
    expect(panel.localSection()).toBe('datos');
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockReturnValue(true);
    panel.setLocalSection('horarios');
    expect(panel.localSection()).toBe('horarios');
  });

  it('el selector muestra el mismo establecimiento que se está administrando', async () => {
    await panel.initialize();
    panel.memberships.set([
      ...panel.memberships(),
      {
        establishmentId: 'segundo',
        name: 'Otro local',
        role: 'admin',
        status: 'active',
      },
    ]);
    const control = document.createElement('select');
    for (const id of ['el-puma', 'segundo']) {
      const option = document.createElement('option');
      option.value = id;
      control.add(option);
    }
    vi.spyOn(panel, 'initialize').mockResolvedValue();
    control.value = 'segundo';
    await panel.selectEstablishment('segundo', control);
    expect(panel.selected()).toBe('segundo');
    expect(control.value).toBe('segundo');
  });

  it('no cambia de apartado ni abandona el panel mientras prepara o guarda el QR', () => {
    panel.tab.set('configuracion');
    panel.localBusiness = {
      hasUnsavedChanges: () => true,
      isSaving: () => true,
    } as AdminLocalBusiness;
    const confirm = vi.spyOn(window, 'confirm');
    panel.setLocalSection('horarios');
    expect(panel.settingsSaving()).toBe(true);
    expect(panel.localSection()).toBe('datos');
    expect(panel.canLeavePage()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('protege los precios pendientes al cambiar de apartado', () => {
    panel.tab.set('configuracion');
    panel.localSection.set('precios');
    panel.localPricing = {
      hasUnsavedChanges: () => true,
      isSaving: () => false,
    } as AdminLocalPricing;
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    panel.setLocalSection('datos');
    expect(panel.localSection()).toBe('precios');
    expect(panel.canLeavePage()).toBe(false);
  });

  it('distingue comprobante recibido, pago validado y rechazo manual', () => {
    expect(panel.paymentLabel(reservation())).toBe('Por validar');
    expect(
      panel.paymentLabel({ ...reservation(), status: 'confirmed', paymentStatus: 'verified' }),
    ).toBe('Validado');
    expect(
      panel.paymentLabel({ ...reservation(), status: 'rejected', paymentStatus: 'unpaid' }),
    ).toBe('No validado');
    expect(
      panel.paymentLabel({ ...reservation(), status: 'pending_payment', paymentStatus: 'unpaid' }),
    ).toBe('Pendiente de comprobante');
  });

  it('ofrece inicio real directo solo para una confirmada de hoy cuya hora llegó', () => {
    const game = {
      ...reservation(),
      date: panel.today(),
      startsAt: Date.now() - 60000,
      status: 'confirmed' as const,
      paymentStatus: 'verified' as const,
    };
    expect(panel.canStart(game)).toBe(true);
    expect(panel.canStart({ ...game, startsAt: Date.now() + 60000 })).toBe(false);
    expect(panel.canStart({ ...game, date: panel.tomorrow() })).toBe(false);
    expect(panel.canStart({ ...game, paymentStatus: 'unpaid' })).toBe(false);
    expect(panel.canStart({ ...game, serviceStatus: 'completed' })).toBe(false);
  });

  it('un partido en juego impide iniciar otro de la misma cancha', () => {
    const game = {
      ...reservation(),
      date: panel.today(),
      startsAt: Date.now() - 60000,
      status: 'confirmed' as const,
      paymentStatus: 'verified' as const,
    };
    panel.overview.set({
      ...overview(),
      courts: [
        {
          id: 'principal',
          name: 'Principal',
          dayPriceCents: 3000,
          nightPriceCents: 4000,
          runtime: {
            reservationId: 'otro',
            actualStartAt: Date.now(),
            estimatedEndAt: Date.now() + 3600000,
          },
        },
      ],
    });
    expect(panel.canStart(game)).toBe(false);
    panel.openSession(game, 'start');
    expect(panel.actionPrompt()).toBeNull();
  });

  it('muestra finalizado exactamente al cumplirse una hora desde el inicio real', () => {
    const start = Date.now() - 3600000;
    const game = {
      ...reservation(),
      status: 'confirmed' as const,
      paymentStatus: 'verified' as const,
      serviceStatus: 'running' as const,
      actualStartAt: start,
    };
    panel.overview.set(overview('Local', [game]));
    panel.currentTime.set(start + 3600000 - 1);
    expect(panel.serviceState(game)).toBe('running');
    expect(panel.count('running')).toBe(1);
    panel.currentTime.set(start + 3600000);
    expect(panel.serviceLabel(game)).toBe('Finalizado');
    expect(panel.count('running')).toBe(0);
    expect(panel.count('completed')).toBe(1);
    expect(panel.endOfGame(game)).toBe(start + 3600000);
  });

  it('deja de bloquear el siguiente inicio cuando vence el partido anterior', () => {
    const now = Date.now();
    const game = {
      ...reservation(),
      status: 'confirmed' as const,
      paymentStatus: 'verified' as const,
      date: panel.today(),
      startsAt: now - 60000,
    };
    panel.overview.set({
      ...overview(),
      courts: [
        {
          id: 'principal',
          name: 'Cancha',
          dayPriceCents: 3000,
          nightPriceCents: 4000,
          runtime: { reservationId: 'anterior', actualStartAt: now - 3600000, estimatedEndAt: now },
        },
      ],
    });
    panel.currentTime.set(now - 1);
    expect(panel.canStart(game)).toBe(false);
    panel.currentTime.set(now);
    expect(panel.canStart(game)).toBe(true);
  });

  it('registra el inicio confirmado sin enviar un reloj del navegador', async () => {
    const game = {
      ...reservation(),
      date: panel.today(),
      startsAt: Date.now() - 60000,
      status: 'confirmed' as const,
      paymentStatus: 'verified' as const,
    };
    panel.openSession(game, 'start');
    expect(document.body.style.overflow).toBe('hidden');
    await panel.sessionAction();
    expect(call).toHaveBeenCalledWith('recordSession', { reservationId: game.id, action: 'start' });
    expect(panel.actionPrompt()).toBeNull();
    expect(panel.message()).toContain('Inicio registrado');
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('un error al registrar no cierra el cuadro y permite reintentar', async () => {
    const game = {
      ...reservation(),
      date: panel.today(),
      startsAt: Date.now() - 60000,
      status: 'confirmed' as const,
      paymentStatus: 'verified' as const,
    };
    panel.openSession(game, 'start');
    call.mockRejectedValueOnce({
      code: 'functions/failed-precondition',
      message: 'Otro partido sigue en juego.',
    });
    await panel.sessionAction();
    expect(panel.sessionError()).toBeTruthy();
    expect(panel.actionPrompt()?.reservation.id).toBe(game.id);
    expect(panel.busy()).toBe(false);
    panel.closeSession();
  });

  it('al abrir Comprobantes consulta pendientes de todas las fechas y elimina filtros anteriores', async () => {
    await panel.initialize();
    call.mockClear();
    panel.date.set('2030-01-01');
    panel.courtFilter.set('otra-cancha');
    panel.stateFilter.set('confirmed');
    const opening = panel.setTab('pagos');
    expect(panel.overview()).toBeNull();
    await opening;
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    expect(call).toHaveBeenCalledExactlyOnceWith('adminPendingProofs', {
      establishmentId: 'el-puma',
    });
    expect(panel.courtFilter()).toBe('');
    expect(panel.stateFilter()).toBe('');
  });

  it('la actualización de Comprobantes no vuelve a filtrar por la fecha de la agenda', async () => {
    await panel.initialize();
    call.mockClear();
    panel.tab.set('pagos');
    panel.date.set('2030-01-01');
    await panel.refresh();
    expect(call).toHaveBeenCalledExactlyOnceWith('adminPendingProofs', {
      establishmentId: 'el-puma',
    });
  });

  it('una respuesta tardía de Agenda no reemplaza la bandeja de comprobantes recién abierta', async () => {
    const oldAgenda = deferred<ReturnType<typeof overview>>();
    const item = reservation();
    call
      .mockImplementationOnce(() => oldAgenda.promise)
      .mockImplementation(async (name: string) =>
        name === 'adminPendingProofs' ? overview('Pendientes actuales', [item]) : overview(),
      );
    const opening = panel.initialize();
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('adminOverview', expect.anything()));
    await panel.setTab('pagos');
    await vi.waitFor(() => expect(panel.overview()?.name).toBe('Pendientes actuales'));
    oldAgenda.resolve(overview('Respuesta antigua'));
    await opening;
    expect(panel.overview()?.name).toBe('Pendientes actuales');
    expect(panel.overview()?.reservations).toEqual([item]);
  });

  it('una consulta de otro establecimiento no reemplaza los datos del local seleccionado', async () => {
    const oldTenant = deferred<ReturnType<typeof overview>>();
    await panel.initialize();
    call.mockClear();
    call.mockReturnValueOnce(oldTenant.promise);
    const refreshing = panel.refresh();
    expect(call).toHaveBeenCalledOnce();
    panel.selected.set('otro-local');
    panel.overview.set(overview('Otro local'));
    oldTenant.resolve(overview('Grass El Puma'));
    await refreshing;
    expect(panel.overview()?.name).toBe('Otro local');
  });

  it('rechaza una fecha malformada sin borrar la selección ni consultar otra agenda', async () => {
    panel.date.set('2030-01-20');
    await panel.selectDate('../otra-fecha');
    expect(panel.date()).toBe('2030-01-20');
    expect(call).not.toHaveBeenCalled();
  });

  it('al elegir otra fecha consulta únicamente la agenda de ese día', async () => {
    await panel.selectDate('2030-01-21');
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    expect(panel.date()).toBe('2030-01-21');
    expect(call).toHaveBeenCalledExactlyOnceWith('adminOverview', {
      establishmentId: 'el-puma',
      date: '2030-01-21',
    });
  });

  it('no confirma con una foto sin revisar, aunque se intente activar la casilla manualmente', async () => {
    const item = reservation();
    panel.review.set(item);
    panel.verified = true;
    await panel.confirmPayment();
    panel.proofUrl.set('blob:comprobante-actual');
    panel.proofLoading.set(true);
    await panel.confirmPayment();
    expect(call).not.toHaveBeenCalled();
    panel.proofLoading.set(false);
    panel.verified = false;
    await panel.confirmPayment();
    expect(call).not.toHaveBeenCalled();
  });

  it('una foto cargada no confirma automáticamente; exige declarar el ingreso real del adelanto', async () => {
    const item = reservation();
    await panel.openReview(item);
    await panel.confirmPayment();
    expect(call).not.toHaveBeenCalled();
    panel.verified = true;
    await panel.confirmPayment();
    expect(call).toHaveBeenCalledWith('reviewPayment', {
      reservationId: item.id,
      action: 'confirm',
      paymentVerified: true,
      amountCents: 1000,
    });
    expect(panel.review()).toBeNull();
    expect(panel.message()).toContain('confirmada');
  });

  it('no envía confirmación de una solicitud vencida aunque se haya marcado la casilla', async () => {
    panel.review.set({ ...reservation(), expiresAt: Date.now() - 1 });
    panel.proofUrl.set('blob:comprobante-actual');
    panel.verified = true;
    await panel.confirmPayment();
    expect(call).not.toHaveBeenCalled();
  });

  it('un error al cargar la foto permanece dentro de la revisión y bloquea la confirmación', async () => {
    const item = reservation();
    readProof.mockRejectedValueOnce(Error('sin conexión'));
    await panel.openReview(item);
    expect(panel.review()?.id).toBe(item.id);
    expect(panel.reviewError()).not.toBe('');
    expect(panel.proofUrl()).toBe('');
    panel.verified = true;
    await panel.confirmPayment();
    expect(call).not.toHaveBeenCalled();
  });

  it('rechazar requiere el segundo paso explícito y no se ejecuta con el primer clic', async () => {
    const item = reservation();
    await panel.openReview(item);
    await panel.rejectPayment();
    expect(call).not.toHaveBeenCalled();
    panel.rejecting.set(true);
    await panel.rejectPayment();
    expect(call).toHaveBeenCalledWith('reviewPayment', {
      reservationId: item.id,
      action: 'reject',
    });
    expect(panel.review()).toBeNull();
    expect(panel.message()).toContain('rechazada');
  });
  it('Escape permite volver a la agenda sin cancelar una operación que se está guardando', async () => {
    const originalOverflow = document.body.style.overflow;
    await panel.openReview(reservation());
    expect(document.body.style.overflow).toBe('hidden');
    panel.busy.set(true);
    panel.closeDialogWithEscape(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.review()).not.toBeNull();
    panel.busy.set(false);
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    panel.closeDialogWithEscape(event);
    expect(panel.review()).toBeNull();
    expect(document.body.style.overflow).toBe(originalOverflow);
    expect(event.defaultPrevented).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it('si falla la confirmación conserva el comprobante abierto y explica el error en el diálogo', async () => {
    const item = reservation();
    await panel.openReview(item);
    panel.verified = true;
    call.mockRejectedValueOnce(
      Object.assign(Error('La retención del horario venció.'), {
        code: 'functions/failed-precondition',
      }),
    );
    await panel.confirmPayment();
    expect(panel.review()?.id).toBe(item.id);
    expect(panel.proofUrl()).toBe('blob:comprobante-actual');
    expect(panel.reviewError()).toContain('venció');
    expect(panel.busy()).toBe(false);
  });

  it('al cerrar una revisión limpia la verificación y el rechazo pendiente de la solicitud anterior', async () => {
    await panel.openReview(reservation());
    panel.rejecting.set(true);
    panel.verified = true;
    panel.reviewError.set('Error anterior');
    panel.closeReview();
    expect(panel.review()).toBeNull();
    expect(panel.rejecting()).toBe(false);
    expect(panel.reviewError()).toBe('');
    expect(panel.verified).toBe(false);
    expect(revokeUrl).toHaveBeenCalledWith('blob:comprobante-actual');
  });

  it('una descarga anterior no cambia la foto ni el indicador de carga de otra revisión', async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    readProof.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldReview = panel.openReview(reservation('primera'));
    const currentReview = panel.openReview(reservation('segunda'));
    first.resolve(new Blob(['imagen anterior'], { type: 'image/jpeg' }));
    await oldReview;
    expect(panel.review()?.id).toBe('segunda');
    expect(panel.proofUrl()).toBe('');
    expect(panel.proofLoading()).toBe(true);
    second.resolve(new Blob(['imagen actual'], { type: 'image/jpeg' }));
    await currentReview;
    expect(panel.proofUrl()).toBe('blob:comprobante-actual');
    expect(panel.proofLoading()).toBe(false);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it('reintentar la foto mantiene la solicitud actual y vuelve a exigir la verificación humana', async () => {
    const item = reservation();
    readProof.mockRejectedValueOnce(Error('sin conexión'));
    await panel.openReview(item);
    panel.verified = true;
    await panel.proofReload();
    expect(readProof).toHaveBeenNthCalledWith(2, item.proofPath);
    expect(panel.review()?.id).toBe(item.id);
    expect(panel.reviewError()).toBe('');
    expect(panel.proofUrl()).toBe('blob:comprobante-actual');
    expect(panel.verified).toBe(false);
  });
});
