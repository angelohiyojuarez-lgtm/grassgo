import { Reservation, clockLabel, slotLabel, statusLabel } from '../core/models/booking';

/** Resumen para el equipo: sin identidad del cliente, comprobantes ni enlaces privados. */
export function reservationShareText(r: Reservation): string {
  const date = new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'full', timeZone: 'America/Lima',
  }).format(new Date(`${r.date}T12:00:00-05:00`));
  const lines = [
    '⚽ Mi reserva en GrassGo',
    r.establishmentName,
    r.courtName,
    `Fecha: ${date}`,
    `Horario reservado: ${slotLabel(r.hour)} · hora de Perú`,
    `Estado: ${statusLabel(r.status)}`,
  ];
  if (r.serviceStatus === 'completed') {
    lines.push(`Partido finalizado: ${clockLabel(r.actualStartAt)} – ${clockLabel(r.actualEndAt)}`);
  } else if (r.estimatedStartAt && r.estimatedEndAt) {
    lines.push(`Horario estimado: ${clockLabel(r.actualStartAt || r.estimatedStartAt)} – ${clockLabel(r.estimatedEndAt)}`);
    if (r.awaitingFinish) lines.push('Esperando la confirmación del término del partido anterior.');
  }
  if (r.status === 'pending_payment' || r.status === 'pending_verification') {
    lines.push('La reserva aún no está confirmada por el establecimiento.');
  }
  if (r.demo) lines.push('DEMOSTRACIÓN · Reserva de prueba, sin pagos reales.');
  lines.push('Estado y horario al momento de compartir. Consulta los cambios en GrassGo.');
  return lines.join('\n');
}
