import { describe, it, expect } from 'vitest';
import { Reservation } from '../core/models/booking';
import { reservationShareText } from './reservation-share-text';
const reservation: Reservation = {
  id: 'private-id', clientUid: 'private-user', establishmentId: 'el-puma',
  establishmentName: 'Grass El Puma', courtId: 'principal', courtName: 'Cancha principal',
  date: '2026-10-24', hour: 17, totalCents: 3000, advanceCents: 1000,
  status: 'pending_verification', paymentStatus: 'submitted', demo: true,
  proofPath: 'private-proof',
  paymentSnapshot: { mode: 'demo', qr: 'private-qr', methods: ['Yape'], recipient: 'private-owner', phone: 'private-phone' },
};
describe('Datos que se comparten de una reserva', () => {
  it('identifica una solicitud pendiente y de prueba sin exponer identidad ni comprobantes', () => {
    const text = reservationShareText(reservation);
    expect(text).toContain('Grass El Puma');
    expect(text).toContain('17:00 – 18:00');
    expect(text).toContain('Comprobante en revisión');
    expect(text).toContain('aún no está confirmada');
    expect(text).toContain('DEMOSTRACIÓN');
    expect(text).not.toContain('private-');
  });
  it('incluye el horario estimado con zona de Perú si hubo un retraso', () => {
    const text = reservationShareText({ ...reservation, status: 'confirmed', demo: false,
      estimatedStartAt: Date.parse('2026-10-24T17:20:00-05:00'),
      estimatedEndAt: Date.parse('2026-10-24T18:20:00-05:00') });
    expect(text).toContain('Reserva confirmada');
    expect(text).toContain('Horario estimado: 17:20 – 18:20');
    expect(text).not.toContain('aún no está confirmada');
    expect(text).not.toContain('DEMOSTRACIÓN');
  });
});
