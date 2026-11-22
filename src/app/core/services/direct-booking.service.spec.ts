import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseService } from '../firebase/firebase.service';
import { DirectBookingService, directReservation, directStart } from './direct-booking.service';

const sdk = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  transaction: vi.fn(),
  transactionGet: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  where: vi.fn((...values: unknown[]) => ({ where: values })),
  orderBy: vi.fn((...values: unknown[]) => ({ orderBy: values })),
  limit: vi.fn((value: number) => ({ limit: value })),
  decode: vi.fn(),
  digest: vi.fn(),
  encode: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (path: string, ...filters: unknown[]) => ({ path, filters }),
  where: sdk.where,
  orderBy: sdk.orderBy,
  limit: sdk.limit,
  getDocFromServer: sdk.getDoc,
  getDocsFromServer: sdk.getDocs,
  runTransaction: sdk.transaction,
  serverTimestamp: () => {
    const instant = Date.now();
    return {
      seconds: Math.floor(instant / 1000),
      nanoseconds: (instant % 1000) * 1000000,
      toMillis: () => instant,
    };
  },
  Timestamp: class {
    constructor(
      readonly seconds: number,
      readonly nanoseconds: number,
    ) {}
    toMillis(): number {
      return this.seconds * 1000 + this.nanoseconds / 1000000;
    }
    static fromMillis(instant: number) {
      return new this(Math.floor(instant / 1000), (instant % 1000) * 1000000);
    }
  },
}));
const OriginalURL = URL;

const NOW = Date.parse('2026-11-19T16:00:00Z');
const stamp = (instant: number) => ({
  seconds: Math.floor(instant / 1000),
  nanoseconds: (instant % 1000) * 1000000,
  toMillis: () => instant,
});
const payment = {
  mode: 'live',
  methods: ['Yape'],
  recipient: 'Titular autorizado',
  phone: '999999999',
  qr: '',
};
const venue = () => ({
  status: 'published',
  name: 'Local publicado',
  advanceCents: 1000,
  booking: { engine: 'direct', enabled: true, holdMinutes: 15, payment },
});
const court = () => ({
  status: 'active',
  name: 'Cancha uno',
  openHour: 8,
  closeHour: 12,
  openDays: [],
  dayPriceCents: 3000,
  nightPriceCents: 4000,
  nightStartsAt: 10,
});
const request = () => ({
  clientUid: 'cliente',
  establishmentId: 'local',
  establishmentName: 'Local publicado',
  courtId: 'cancha',
  courtName: 'Cancha uno',
  date: '2026-11-20',
  hour: 10,
  startsAt: stamp(directStart('2026-11-20', 10)),
  endsAt: stamp(directStart('2026-11-20', 11)),
  createdAt: stamp(NOW),
  totalCents: 4000,
  advanceCents: 1000,
  status: 'pending_payment',
  paymentStatus: 'unpaid',
  paymentSnapshot: payment,
});

describe('Reservas directas del cliente', () => {
  let service: DirectBookingService;
  let records: Map<string, Record<string, unknown>>;
  const auth: { currentUser: { uid: string } | null } = { currentUser: null };
  const getDb = vi.fn();
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1),
    exists: () => records.has(path),
    data: () => records.get(path),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    auth.currentUser = { uid: 'cliente' };
    getDb.mockResolvedValue({});
    records = new Map<string, Record<string, unknown>>([
      ['catalog/local', venue()],
      ['catalog/local/courts/cancha', court()],
    ]);
    sdk.getDoc.mockImplementation(async (path: string) => snapshot(path));
    sdk.transactionGet.mockImplementation(async (path: string) => snapshot(path));
    sdk.getDocs.mockImplementation(async (value: string | { path: string }) => {
      const prefix = typeof value === 'string' ? value : value.path;
      return {
        docs: [...records.keys()]
          .filter(
            (path) => path.startsWith(prefix + '/') && !path.slice(prefix.length + 1).includes('/'),
          )
          .map(snapshot),
      };
    });
    sdk.decode.mockResolvedValue(undefined);
    sdk.digest.mockResolvedValue(new Uint8Array(32).fill(1).buffer);
    sdk.encode.mockReturnValue('data:image/jpeg;base64,/9j/AAAA');
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static override createObjectURL = vi.fn(() => 'blob:foto');
        static override revokeObjectURL = vi.fn();
      },
    );
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        naturalWidth = 600;
        naturalHeight = 400;
        decode = sdk.decode;
      },
    );
    vi.stubGlobal('crypto', { subtle: { digest: sdk.digest } });
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }),
      toDataURL: sdk.encode,
    } as unknown as HTMLElement);
    sdk.transaction.mockImplementation(
      async (_db: unknown, run: (tx: unknown) => Promise<void>) => {
        const writes: (() => void)[] = [];
        await run({
          get: sdk.transactionGet,
          set: (path: string, data: Record<string, unknown>) => {
            sdk.set(path, data);
            writes.push(() => {
              records.set(path, data);
            });
          },
          update: (path: string, data: Record<string, unknown>) => {
            sdk.update(path, data);
            writes.push(() => {
              records.set(path, { ...records.get(path), ...data });
            });
          },
        });
        writes.forEach((write) => write());
      },
    );
    TestBed.configureTestingModule({
      providers: [{ provide: FirebaseService, useValue: { auth, getDb } }],
    });
    service = TestBed.inject(DirectBookingService);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('exige una sesión Firebase antes de consultar o subir datos privados', async () => {
    auth.currentUser = null;
    const own = directReservation('solicitud', request());
    await expect(service.mine()).rejects.toMatchObject({ code: 'functions/unauthenticated' });
    await expect(service.availability('local', 'cancha', '2026-11-20')).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    await expect(
      service.submitProof(own, new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ code: 'functions/unauthenticated' });
    expect(getDb).not.toHaveBeenCalled();
    expect(sdk.decode).not.toHaveBeenCalled();
  });

  it('consulta el historial con el UID de la sesión, orden y límite explícitos', async () => {
    records.set('direct_requests/propia', request());
    const result = await service.mine();
    expect(sdk.where).toHaveBeenCalledWith('clientUid', '==', 'cliente');
    expect(sdk.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(sdk.limit).toHaveBeenCalledWith(100);
    expect(result[0].id).toBe('propia');
    expect(result[0].paymentStatus).toBe('unpaid');
  });

  it('solo ofrece horarios libres y no expone los datos de los bloqueos', async () => {
    const base = 'direct_slots/local/courts/cancha/days/2026-11-20/hours/';
    records.set(base + '8', {
      status: 'confirmed',
      lockedAt: stamp(NOW - 3600000),
      reservationId: 'ajena-a',
    });
    records.set(base + '9', {
      status: 'held',
      lockedAt: stamp(NOW - 60000),
      reservationId: 'ajena-b',
    });
    records.set(base + '10', {
      status: 'held',
      lockedAt: stamp(NOW - 16 * 60000),
      reservationId: 'vencida',
    });
    records.set(base + '11', {
      status: 'released',
      lockedAt: stamp(NOW),
      reservationId: 'rechazada',
    });
    const result = await service.availability('local', 'cancha', '2026-11-20');
    expect(result.slots.map((slot) => slot.available)).toEqual([false, false, true, true]);
    expect(result.paymentQr).toBe('');
    expect(result.paymentMode).toBe('live');
    expect(JSON.stringify(result)).not.toMatch(/ajena-a|ajena-b|vencida|rechazada/);
  });

  it('no inventa disponibilidad cuando falla el servidor o el local está sin configurar', async () => {
    sdk.getDoc.mockRejectedValueOnce(Object.assign(Error('sin conexión'), { code: 'unavailable' }));
    await expect(service.availability('local', 'cancha', '2026-11-20')).rejects.toMatchObject({
      code: 'unavailable',
    });
    records.set('catalog/local', { ...venue(), booking: { enabled: false } });
    await expect(service.availability('local', 'cancha', '2026-11-20')).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });

  it('usa el horario global publicado aunque la cancha aún no tenga horas propias', async () => {
    records.set('catalog/local', {
      ...venue(),
      scheduleRevision: 1,
      days: [5],
      openHour: 12,
      closeHour: 15,
    });
    records.set('catalog/local/courts/cancha', { ...court(), openHour: null, closeHour: null });
    const result = await service.availability('local', 'cancha', '2026-11-20');
    expect(result.slots.map((slot) => slot.hour)).toEqual([12, 13, 14]);
    const created = await service.create('local', 'cancha', '2026-11-20', 14, 'horario-global');
    expect(created.hour).toBe(14);
    expect(created.totalCents).toBe(4000);
    expect(created.paymentStatus).toBe('unpaid');
    await expect(
      service.create('local', 'cancha', '2026-11-20', 10, 'fuera-horario'),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
  });

  it('trata una semana publicada sin días como cerrada y conserva el significado anterior de openDays vacío', async () => {
    expect((await service.availability('local', 'cancha', '2026-11-20')).slots).toHaveLength(4);
    records.set('catalog/local', {
      ...venue(),
      scheduleRevision: 2,
      days: [],
      openHour: 8,
      closeHour: 12,
    });
    const result = await service.availability('local', 'cancha', '2026-11-20');
    expect(result.slots).toEqual([]);
    expect(result.weeklyClosed).toBe(true);
    await expect(
      service.create('local', 'cancha', '2026-11-20', 10, 'semana-cerrada'),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect(sdk.set).not.toHaveBeenCalled();
  });

  it('muestra una fecha cerrada sin exponer el motivo y vuelve a comprobarla dentro de la transacción', async () => {
    const available = await service.availability('local', 'cancha', '2026-11-20');
    expect(available.slots[2].available).toBe(true);
    records.set('catalog/local/closures/2026-11-20', {
      establishmentId: 'local',
      date: '2026-11-20',
      closed: true,
      revision: 1,
    });
    const closed = await service.availability('local', 'cancha', '2026-11-20');
    expect(closed.closedDate).toBe(true);
    expect(closed.slots).toEqual([]);
    await expect(
      service.create('local', 'cancha', '2026-11-20', 10, 'cierre-reciente'),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect(sdk.transactionGet).toHaveBeenCalledWith('catalog/local/closures/2026-11-20');
    expect(sdk.set).not.toHaveBeenCalled();
    records.set('catalog/local/closures/2026-11-20', { closed: false, revision: 2 });
    const reopened = await service.create('local', 'cancha', '2026-11-20', 10, 'fecha-reabierta');
    expect(reopened.status).toBe('pending_payment');
    expect(reopened.paymentStatus).toBe('unpaid');
  });

  it('revalida cambios semanales recientes y no cambia solicitudes creadas antes del cierre', async () => {
    await service.availability('local', 'cancha', '2026-11-20');
    records.set('catalog/local', {
      ...venue(),
      scheduleRevision: 1,
      days: [6],
      openHour: 8,
      closeHour: 12,
    });
    await expect(
      service.create('local', 'cancha', '2026-11-20', 10, 'dia-retirado'),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    records.set('direct_requests/existente', {
      ...request(),
      status: 'confirmed',
      paymentStatus: 'verified',
    });
    records.set('catalog/local/closures/2026-11-20', { closed: true });
    const existing = records.get('direct_requests/existente');
    const retry = await service.create('local', 'cancha', '2026-11-20', 10, 'existente');
    expect(retry.status).toBe('confirmed');
    expect(records.get('direct_requests/existente')).toBe(existing);
    expect(sdk.set).not.toHaveBeenCalled();
  });

  it('no asume que está abierto si falla la lectura del cierre ni activa un local deshabilitado', async () => {
    sdk.getDoc.mockImplementation(async (path: string) => {
      if (path.includes('/closures/'))
        throw Object.assign(new Error('Sin servidor'), { code: 'unavailable' });
      return snapshot(path);
    });
    await expect(service.availability('local', 'cancha', '2026-11-20')).rejects.toMatchObject({
      code: 'unavailable',
    });
    records.set('catalog/local', {
      ...venue(),
      scheduleRevision: 1,
      days: [5],
      openHour: 8,
      closeHour: 12,
      booking: { ...venue().booking, enabled: false },
    });
    await expect(
      service.create('local', 'cancha', '2026-11-20', 10, 'sin-pagos'),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect(sdk.set).not.toHaveBeenCalled();
  });

  it('crea solicitud y bloqueo juntos con tarifa del catálogo y sin declarar un pago verificado', async () => {
    const result = await service.create('local', 'cancha', '2026-11-20', 10, 'solicitud');
    expect(sdk.set).toHaveBeenCalledTimes(3);
    expect(records.get('direct_requests/solicitud')).toMatchObject({
      clientUid: 'cliente',
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      totalCents: 4000,
      paymentSnapshot: { phone: '999999999', mode: 'live' },
    });
    expect(records.get('direct_slots/local/courts/cancha/days/2026-11-20/hours/10')).toMatchObject({
      reservationId: 'solicitud',
      status: 'held',
      reviewPending: false,
    });
    expect(result.engine).toBe('direct');
    expect(result.paymentStatus).toBe('unpaid');
    expect(records.get('direct_limits/cliente/days/2026-11-20')).toMatchObject({
      count: 1,
      lastRequestId: 'solicitud',
    });
  });

  it('reintenta la misma solicitud sin duplicarla y rechaza reutilizar una identidad o un horario ajenos', async () => {
    records.set('direct_requests/solicitud', request());
    await service.create('local', 'cancha', '2026-11-20', 10, 'solicitud');
    expect(sdk.set).not.toHaveBeenCalled();
    await expect(
      service.create('local', 'cancha', '2026-11-20', 11, 'solicitud'),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    auth.currentUser = { uid: 'otro-cliente' };
    await expect(
      service.create('local', 'cancha', '2026-11-20', 10, 'solicitud'),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(sdk.set).not.toHaveBeenCalled();
  });

  it('una solicitud concurrente que encuentra el bloqueo vigente no escribe otra reserva', async () => {
    records.set('direct_limits/cliente/days/2026-11-20', {
      count: 7,
      lastRequestId: 'anterior',
      updatedAt: stamp(NOW),
    });
    records.set('direct_slots/local/courts/cancha/days/2026-11-20/hours/10', {
      reservationId: 'solicitud-anterior',
      status: 'held',
      lockedAt: stamp(NOW),
    });
    await expect(
      service.create('local', 'cancha', '2026-11-20', 10, 'otra-solicitud'),
    ).rejects.toMatchObject({ code: 'functions/already-exists' });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(records.get('direct_limits/cliente/days/2026-11-20')?.['count']).toBe(7);
  });

  it('admite la solicitud número veinte y rechaza la siguiente sin crear reserva ni bloqueo', async () => {
    const counter = 'direct_limits/cliente/days/2026-11-20';
    records.set(counter, { count: 19, lastRequestId: 'anterior', updatedAt: stamp(NOW) });
    await service.create('local', 'cancha', '2026-11-20', 10, 'numero-veinte');
    expect(records.get(counter)?.['count']).toBe(20);
    expect(records.get(counter)?.['lastRequestId']).toBe('numero-veinte');
    sdk.set.mockClear();
    await expect(
      service.create('local', 'cancha', '2026-11-20', 11, 'numero-veintiuno'),
    ).rejects.toMatchObject({ code: 'functions/resource-exhausted' });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(records.has('direct_requests/numero-veintiuno')).toBe(false);
    expect(records.has('direct_slots/local/courts/cancha/days/2026-11-20/hours/11')).toBe(false);
    expect(records.get(counter)?.['count']).toBe(20);
  });

  it('reintentar una solicitud ya creada no incrementa ni consulta de nuevo el contador agotado', async () => {
    records.set('direct_requests/solicitud', request());
    records.set('direct_limits/cliente/days/2026-11-20', {
      count: 20,
      lastRequestId: 'otra',
      updatedAt: stamp(NOW),
    });
    await service.create('local', 'cancha', '2026-11-20', 10, 'solicitud');
    expect(sdk.transactionGet.mock.calls.map(([path]) => path)).toEqual([
      'direct_requests/solicitud',
    ]);
    expect(sdk.set).not.toHaveBeenCalled();
    expect(records.get('direct_limits/cliente/days/2026-11-20')?.['count']).toBe(20);
  });

  it('el contador pertenece al UID de la sesión y no consulta límites de otras cuentas', async () => {
    const otherCounter = 'direct_limits/otro-cliente/days/2026-11-20';
    records.set(otherCounter, { count: 20, lastRequestId: 'ajena', updatedAt: stamp(NOW) });
    await service.create('local', 'cancha', '2026-11-20', 10, 'solicitud');
    expect(sdk.transactionGet).toHaveBeenCalledWith('direct_limits/cliente/days/2026-11-20');
    expect(sdk.transactionGet).not.toHaveBeenCalledWith(otherCounter);
    expect(records.get(otherCounter)?.['count']).toBe(20);
    expect(records.get('direct_limits/cliente/days/2026-11-20')?.['count']).toBe(1);
  });

  it('rechaza un comprobante de otro usuario aunque el formulario se haya manipulado', async () => {
    const own = directReservation('solicitud', request());
    await expect(
      service.submitProof(
        { ...own, clientUid: 'otro' },
        new File(['foto'], 'foto.jpg', { type: 'image/jpeg' }),
      ),
    ).rejects.toMatchObject({ code: 'functions/permission-denied' });
    expect(sdk.decode).not.toHaveBeenCalled();
    records.set('direct_requests/solicitud', { ...request(), clientUid: 'otro' });
    await expect(
      service.submitProof(own, new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })),
    ).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it('subir una foto solo declara el comprobante pendiente y conserva sus datos privados', async () => {
    records.set('direct_requests/solicitud', request());
    const slotPath = 'direct_slots/local/courts/cancha/days/2026-11-20/hours/10';
    records.set(slotPath, {
      reservationId: 'solicitud',
      status: 'held',
      lockedAt: request().createdAt,
      reviewPending: false,
    });
    await service.submitProof(
      directReservation('solicitud', request()),
      new File(['foto'], 'foto.jpg', { type: 'image/jpeg' }),
    );
    expect(records.get('direct_requests/solicitud')).toMatchObject({
      status: 'pending_verification',
      paymentStatus: 'submitted',
    });
    expect(records.get('direct_proofs/solicitud')).toMatchObject({
      clientUid: 'cliente',
      establishmentId: 'local',
      reservationId: 'solicitud',
      contentType: 'image/jpeg',
    });
    expect(records.get('direct_requests/solicitud')).not.toHaveProperty('verifiedAdvanceCents');
    expect(records.get('direct_requests/solicitud')).not.toHaveProperty('imageData');
    expect(records.get(slotPath)).toMatchObject({
      reservationId: 'solicitud',
      status: 'held',
      reviewPending: true,
    });
  });

  it('reenviar la misma foto es idempotente y una foto diferente no reemplaza la anterior', async () => {
    records.set('direct_requests/solicitud', {
      ...request(),
      status: 'pending_verification',
      paymentStatus: 'submitted',
    });
    records.set('direct_proofs/solicitud', { sha256: '01'.repeat(32) });
    const item = directReservation('solicitud', request());
    await service.submitProof(item, new File(['foto'], 'foto.jpg', { type: 'image/jpeg' }));
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
    sdk.digest.mockResolvedValueOnce(new Uint8Array(32).fill(2).buffer);
    await expect(
      service.submitProof(item, new File(['otra'], 'otra.jpg', { type: 'image/jpeg' })),
    ).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
  });

  it('no admite subir después del vencimiento ni confirmar sin verificar importe e ingreso real', async () => {
    records.set('direct_requests/solicitud', { ...request(), createdAt: stamp(NOW - 16 * 60000) });
    await expect(
      service.submitProof(
        directReservation('solicitud', request()),
        new File(['foto'], 'foto.jpg', { type: 'image/jpeg' }),
      ),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    records.set('direct_requests/solicitud', {
      ...request(),
      status: 'pending_verification',
      paymentStatus: 'submitted',
    });
    await expect(
      service.reviewPayment({ reservationId: 'solicitud', action: 'confirm', amountCents: 1000 }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    await expect(
      service.reviewPayment({
        reservationId: 'solicitud',
        action: 'confirm',
        paymentVerified: true,
        amountCents: 500,
      }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });
  it('la bandeja administrativa exige sesión e identificador válidos antes de consultar datos', async () => {
    auth.currentUser = null;
    await expect(service.adminPendingProofs('local')).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    auth.currentUser = { uid: 'admin' };
    await expect(service.adminPendingProofs('../otro-local')).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    expect(getDb).not.toHaveBeenCalled();
    expect(sdk.getDoc).not.toHaveBeenCalled();
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });

  it('consulta comprobantes del tenant y plazo de creación, sin restringir la fecha del partido', async () => {
    auth.currentUser = { uid: 'admin' };
    records.set('establishments/local', { name: 'Local publicado' });
    records.set('establishments/local/courts/cancha', court());
    const awaiting = { ...request(), status: 'pending_verification', paymentStatus: 'submitted' };
    records.set('direct_requests/vence-primero', {
      ...awaiting,
      createdAt: stamp(NOW - 12 * 60000),
    });
    records.set('direct_requests/otra-fecha', {
      ...awaiting,
      date: '2026-12-02',
      startsAt: stamp(directStart('2026-12-02', 10)),
      endsAt: stamp(directStart('2026-12-02', 11)),
      createdAt: stamp(NOW - 2 * 60000),
      imageData: 'dato no permitido en el resultado',
    });
    records.set('direct_requests/vencio-plazo', {
      ...awaiting,
      createdAt: stamp(NOW - 16 * 60000),
    });
    records.set('direct_requests/partido-iniciado', {
      ...awaiting,
      startsAt: stamp(NOW - 60000),
    });
    records.set('direct_requests/confirmada', { ...awaiting, status: 'confirmed' });

    const result = await service.adminPendingProofs('local');

    expect(sdk.where).toHaveBeenCalledWith('establishmentId', '==', 'local');
    expect(sdk.where).toHaveBeenCalledWith('status', '==', 'pending_verification');
    expect(sdk.where.mock.calls.some(([field]) => field === 'date')).toBe(false);
    const cutoff = sdk.where.mock.calls.find(([field]) => field === 'createdAt');
    expect(cutoff?.[1]).toBe('>');
    expect((cutoff?.[2] as { toMillis(): number }).toMillis()).toBe(NOW - 15 * 60000);
    expect(sdk.orderBy).toHaveBeenCalledWith('createdAt', 'asc');
    expect(sdk.limit).toHaveBeenCalledWith(100);
    expect(result.reservations.map((item) => item.id)).toEqual(['vence-primero', 'otra-fecha']);
    expect(result.reservations[1].date).toBe('2026-12-02');
    expect(result.pendingLimitReached).toBe(false);
    expect(result.courts[0].id).toBe('cancha');
    expect(sdk.getDoc.mock.calls.map(([path]) => path)).toEqual(['establishments/local']);
    expect(JSON.stringify(result)).not.toContain('dato no permitido');
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it('una lectura privada denegada impide consultar solicitudes de otro establecimiento', async () => {
    const denied = Object.assign(Error('Acceso denegado'), { code: 'permission-denied' });
    sdk.getDoc.mockRejectedValueOnce(denied);
    await expect(service.adminPendingProofs('otro-local')).rejects.toBe(denied);
    expect(sdk.getDocs).not.toHaveBeenCalled();
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it('señala cuando la consulta alcanza cien comprobantes para informar el límite', async () => {
    records.set('establishments/local', { name: 'Local publicado' });
    for (let index = 0; index < 100; index++) {
      records.set('direct_requests/pendiente-' + index, {
        ...request(),
        status: 'pending_verification',
        paymentStatus: 'submitted',
      });
    }
    const result = await service.adminPendingProofs('local');
    expect(result.reservations).toHaveLength(100);
    expect(result.pendingLimitReached).toBe(true);
  });

  const prepareSession = (id = 'partido', hour = 10) => {
    records.set('establishments/local', {
      name: 'Local publicado',
      bookingEngine: 'direct',
      status: 'published',
    });
    records.set('establishments/local/courts/cancha', court());
    const data = {
      ...request(),
      date: '2026-11-19',
      hour,
      startsAt: stamp(directStart('2026-11-19', hour)),
      endsAt: stamp(directStart('2026-11-19', hour) + 3600000),
      status: 'confirmed',
      paymentStatus: 'verified',
      reviewedBy: 'admin',
      verifiedAdvanceCents: 1000,
    };
    records.set('direct_requests/' + id, data);
    records.set('direct_slots/local/courts/cancha/days/2026-11-19/hours/' + hour, {
      reservationId: id,
      status: 'confirmed',
      lockedAt: data.createdAt,
    });
    return data;
  };

  it('inicia con reloj servidor, cinco escrituras atómicas e historial sin cambiar el pago', async () => {
    auth.currentUser = { uid: 'admin' };
    const original = prepareSession();
    await service.recordSession({ reservationId: 'partido', action: 'start' });
    const item = records.get('direct_requests/partido')!;
    expect(item).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'verified',
      totalCents: original.totalCents,
      serviceStatus: 'running',
    });
    expect((item['actualStartAt'] as { toMillis(): number }).toMillis()).toBe(NOW);
    expect(item['startsAt']).toBe(original.startsAt);
    expect(sdk.update).toHaveBeenCalledTimes(2);
    expect(sdk.set).toHaveBeenCalledTimes(3);
    const canonical = records.get('establishments/local/courts/cancha/operations/current')!;
    const published = records.get('catalog/local/courts/cancha/operations/current')!;
    expect(canonical).toMatchObject({
      activeReservationId: 'partido',
      activeDate: '2026-11-19',
      revision: 1,
      updatedBy: 'admin',
    });
    expect(published).not.toHaveProperty('updatedBy');
    expect(published).not.toHaveProperty('estimatedEndAt');
    expect(
      records.get('establishments/local/courts/cancha/operations/current/history/1'),
    ).toMatchObject({
      kind: 'session',
      action: 'start',
      reservationId: 'partido',
      before: null,
      after: canonical,
    });
    sdk.set.mockClear();
    sdk.update.mockClear();
    await service.recordSession({ reservationId: 'partido', action: 'start' });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it('no empieza antes de su hora, sin verificación o cuando otro partido sigue en juego', async () => {
    auth.currentUser = { uid: 'admin' };
    prepareSession('futura', 12);
    await expect(
      service.recordSession({ reservationId: 'futura', action: 'start' }),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    prepareSession('sin-verificar');
    records.set('direct_requests/sin-verificar', {
      ...records.get('direct_requests/sin-verificar'),
      paymentStatus: 'submitted',
    });
    await expect(
      service.recordSession({ reservationId: 'sin-verificar', action: 'start' }),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    prepareSession('primero', 9);
    await service.recordSession({ reservationId: 'primero', action: 'start' });
    prepareSession('segundo', 10);
    await expect(
      service.recordSession({ reservationId: 'segundo', action: 'start' }),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect(records.get('direct_requests/segundo')).not.toHaveProperty('serviceStatus');
  });

  it('persiste al día siguiente el fin automático exacto, conserva inicio y no duplica finalización', async () => {
    auth.currentUser = { uid: 'admin' };
    prepareSession();
    await service.recordSession({ reservationId: 'partido', action: 'start' });
    const start = records.get('direct_requests/partido')!['actualStartAt'];
    vi.mocked(Date.now).mockReturnValue(NOW + 26 * 3600000);
    await service.recordSession({ reservationId: 'partido', action: 'finish' });
    const item = records.get('direct_requests/partido')!;
    expect(item).toMatchObject({
      serviceStatus: 'completed',
      status: 'confirmed',
      paymentStatus: 'verified',
    });
    expect(item['actualStartAt']).toBe(start);
    expect((item['actualEndAt'] as { toMillis(): number }).toMillis()).toBe(NOW + 3600000);
    expect(records.get('catalog/local/courts/cancha/operations/current')).toMatchObject({
      activeReservationId: null,
      activeDate: null,
      actualStartAt: null,
      revision: 2,
    });
    sdk.set.mockClear();
    sdk.update.mockClear();
    await service.recordSession({ reservationId: 'partido', action: 'finish' });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it('bloquea nuevas solicitudes del día en juego pero conserva días futuros independientes', async () => {
    const now = directStart('2026-11-20', 8) + 20 * 60000;
    vi.mocked(Date.now).mockReturnValue(now);
    records.set('catalog/local/courts/cancha/operations/current', {
      activeReservationId: 'en-juego',
      activeDate: '2026-11-20',
      actualStartAt: stamp(now - 10 * 60000),
      lastEndedAt: null,
    });
    const result = await service.availability('local', 'cancha', '2026-11-20');
    expect(result.awaitingFinish).toBe(false);
    expect(result.activeUntil).toBe(now - 10 * 60000 + 3600000);
    expect(result.slots.every((slot) => !slot.available)).toBe(true);
    await expect(
      service.create('local', 'cancha', '2026-11-20', 10, 'nuevo'),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    const tomorrow = await service.availability('local', 'cancha', '2026-11-21');
    expect(tomorrow.slots.some((slot) => slot.available)).toBe(true);
    expect(tomorrow.activeUntil).toBeNull();
    await expect(
      service.create('local', 'cancha', '2026-11-21', 10, 'otro-dia'),
    ).resolves.toMatchObject({ status: 'pending_payment' });
  });

  it('actualiza las estimaciones de Mis reservas sin publicar IDs ajenos en disponibilidad', async () => {
    const now = directStart('2026-11-20', 8) + 20 * 60000;
    vi.mocked(Date.now).mockReturnValue(now);
    records.set('catalog/local/courts/cancha/operations/current', {
      activeReservationId: 'primero',
      activeDate: '2026-11-20',
      actualStartAt: stamp(now),
      lastEndedAt: null,
    });
    const base = 'direct_slots/local/courts/cancha/days/2026-11-20/hours/';
    records.set(base + '8', {
      reservationId: 'primero',
      status: 'confirmed',
      lockedAt: stamp(NOW),
      serviceStatus: 'running',
      actualStartAt: stamp(now),
    });
    records.set(base + '9', { reservationId: 'propia', status: 'confirmed', lockedAt: stamp(NOW) });
    records.set('direct_requests/propia', {
      ...request(),
      hour: 9,
      status: 'confirmed',
      paymentStatus: 'verified',
    });
    const own = (await service.mine())[0];
    expect(own.estimatedStartAt).toBe(now + 3600000);
    expect(own.hour).toBe(9);
    const available = await service.availability('local', 'cancha', '2026-11-20');
    expect(available.schedule?.[1].estimatedStartAt).toBe(now + 3600000);
    expect(JSON.stringify(available)).not.toMatch(/primero|propia/);
  });

  it('rechaza finalizar antes de una hora y permite persistir exactamente en el límite', async () => {
    auth.currentUser = { uid: 'admin' };
    prepareSession();
    await service.recordSession({ reservationId: 'partido', action: 'start' });
    vi.mocked(Date.now).mockReturnValue(NOW + 3600000 - 1);
    await expect(
      service.recordSession({ reservationId: 'partido', action: 'finish' }),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect(records.get('direct_requests/partido')?.['serviceStatus']).toBe('running');
    vi.mocked(Date.now).mockReturnValue(NOW + 3600000);
    await service.recordSession({ reservationId: 'partido', action: 'finish' });
    expect(
      (
        records.get('direct_requests/partido')?.['actualEndAt'] as { toMillis(): number }
      ).toMillis(),
    ).toBe(NOW + 3600000);
  });

  it('la finalización tardía conserva nanosegundos y registra cuándo se persistió sin prolongar el turno', async () => {
    auth.currentUser = { uid: 'admin' };
    prepareSession();
    const start = {
      seconds: Math.floor(NOW / 1000),
      nanoseconds: 123456789,
      toMillis: () => NOW + 123.456789,
    };
    records.set('direct_requests/partido', {
      ...records.get('direct_requests/partido'),
      serviceStatus: 'running',
      actualStartAt: start,
    });
    records.set('direct_slots/local/courts/cancha/days/2026-11-19/hours/10', {
      ...records.get('direct_slots/local/courts/cancha/days/2026-11-19/hours/10'),
      serviceStatus: 'running',
      actualStartAt: start,
    });
    const operation = {
      establishmentId: 'local',
      courtId: 'cancha',
      activeReservationId: 'partido',
      activeDate: '2026-11-19',
      actualStartAt: start,
      lastEndedAt: null,
      revision: 1,
      updatedAt: start,
      updatedBy: 'admin',
    };
    records.set('establishments/local/courts/cancha/operations/current', operation);
    vi.mocked(Date.now).mockReturnValue(NOW + 2 * 3600000);
    await service.recordSession({ reservationId: 'partido', action: 'finish' });
    const end = records.get('direct_requests/partido')!['actualEndAt'] as {
      seconds: number;
      nanoseconds: number;
    };
    expect(end.seconds).toBe(start.seconds + 3600);
    expect(end.nanoseconds).toBe(123456789);
    const stored = records.get('establishments/local/courts/cancha/operations/current')!;
    expect(stored['lastEndedAt']).toBe(end);
    expect((stored['updatedAt'] as { toMillis(): number }).toMillis()).toBe(NOW + 2 * 3600000);
  });

  it('la siguiente lectura del administrador registra el fin automático una sola vez', async () => {
    auth.currentUser = { uid: 'admin' };
    prepareSession();
    await service.recordSession({ reservationId: 'partido', action: 'start' });
    vi.mocked(Date.now).mockReturnValue(NOW + 2 * 3600000);
    const overview = (await service.adminOverview('local', '2026-11-19')) as {
      reservations: { serviceStatus: string; actualEndAt: number }[];
      courts: { runtime: unknown }[];
    };
    expect(overview.reservations[0]).toMatchObject({
      serviceStatus: 'completed',
      actualEndAt: NOW + 3600000,
    });
    expect(overview.courts[0].runtime).toBeNull();
    expect(records.get('establishments/local/courts/cancha/operations/current')?.['revision']).toBe(
      2,
    );
    sdk.set.mockClear();
    sdk.update.mockClear();
    await service.adminOverview('local', '2026-11-19');
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it('al empezar el siguiente turno primero persiste el anterior expirado y conserva ambas historias', async () => {
    auth.currentUser = { uid: 'admin' };
    prepareSession('primero', 10);
    prepareSession('siguiente', 11);
    await service.recordSession({ reservationId: 'primero', action: 'start' });
    vi.mocked(Date.now).mockReturnValue(NOW + 3600000);
    await service.recordSession({ reservationId: 'siguiente', action: 'start' });
    expect(records.get('direct_requests/primero')?.['serviceStatus']).toBe('completed');
    expect(
      (
        records.get('direct_requests/primero')?.['actualEndAt'] as { toMillis(): number }
      ).toMillis(),
    ).toBe(NOW + 3600000);
    expect(records.get('direct_requests/siguiente')).toMatchObject({
      serviceStatus: 'running',
      hour: 11,
      paymentStatus: 'verified',
    });
    expect(records.get('establishments/local/courts/cancha/operations/current')).toMatchObject({
      revision: 3,
      activeReservationId: 'siguiente',
    });
    expect(
      records.get('establishments/local/courts/cancha/operations/current/history/2'),
    ).toMatchObject({ action: 'finish', reservationId: 'primero' });
    expect(
      records.get('establishments/local/courts/cancha/operations/current/history/3'),
    ).toMatchObject({ action: 'start', reservationId: 'siguiente' });
  });
});

describe('Fechas y vencimiento del recorrido directo', () => {
  it('interpreta el horario en Lima y rechaza fechas imposibles o horas manipuladas', () => {
    expect(new Date(directStart('2026-11-20', 0)).toISOString()).toBe('2026-11-20T05:00:00.000Z');
    for (const [date, hour] of [
      ['2026-02-30', 10],
      ['2026-13-01', 10],
      ['2026-01-01', 24],
      ['2026-01-01', -1],
      ['2026-01-01', 8.5],
      ['2026-1-01', 8],
    ] as const)
      expect(() => directStart(date, hour)).toThrow();
  });
  it('vence a los 15 minutos o al inicio si ocurre antes, sin vencer reservas confirmadas', () => {
    const data = request();
    expect(directReservation('a', data, NOW + 14 * 60000).status).toBe('pending_payment');
    expect(directReservation('a', data, NOW + 15 * 60000).status).toBe('expired');
    const nearStart = { ...data, startsAt: stamp(NOW + 5 * 60000), status: 'pending_verification' };
    expect(directReservation('a', nearStart, NOW + 5 * 60000).status).toBe('expired');
    expect(
      directReservation(
        'a',
        { ...data, status: 'confirmed', paymentStatus: 'verified' },
        NOW + 365 * 86400000,
      ).status,
    ).toBe('confirmed');
  });
  it('un partido termina lógicamente en una hora sin depender de escrituras ni del navegador abierto', () => {
    const raw = {
      ...request(),
      status: 'confirmed',
      paymentStatus: 'verified',
      serviceStatus: 'running',
      actualStartAt: stamp(NOW),
    };
    expect(directReservation('partido', raw, NOW + 3600000 - 1).serviceStatus).toBe('running');
    const ended = directReservation('partido', raw, NOW + 3600000);
    expect(ended).toMatchObject({
      serviceStatus: 'completed',
      actualEndAt: NOW + 3600000,
      status: 'confirmed',
      paymentStatus: 'verified',
    });
    expect(raw.serviceStatus).toBe('running');
    expect(
      directReservation(
        'partido',
        { ...raw, serviceStatus: 'completed', actualEndAt: stamp(NOW + 1800000) },
        NOW + 7200000,
      ).actualEndAt,
    ).toBe(NOW + 1800000);
  });
});
