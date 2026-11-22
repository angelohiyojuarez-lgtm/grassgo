/** La hora contratada no cambia: esta proyección solo informa el retraso operativo. */
export interface DirectCourtOperation {
  activeReservationId: string | null;
  activeDate: string | null;
  actualStartAt: number | null;
  lastEndedAt: number | null;
}
export interface DirectScheduleSlot {
  hour: number;
  reservationId: string;
  status: string;
  serviceStatus?: string;
  actualStartAt?: number | null;
  actualEndAt?: number | null;
}
export interface DirectScheduleItem {
  reservationId: string;
  scheduledHour: number;
  estimatedStartAt: number;
  estimatedEndAt: number;
  running: boolean;
  awaitingFinish: boolean;
}
export const DIRECT_GAME_MS = 3600000;
const HOUR = DIRECT_GAME_MS;
export const directDayStart = (date: string): number => Date.parse(date + 'T00:00:00-05:00');

/** Hora efectiva de liberación, aunque nadie haya abierto la aplicación para persistirla. */
export function operationEndedAt(operation: DirectCourtOperation | null, now: number): number {
  const automaticEnd =
    operation?.activeReservationId &&
    operation.actualStartAt &&
    now >= operation.actualStartAt + HOUR
      ? operation.actualStartAt + HOUR
      : 0;
  return Math.max(operation?.lastEndedAt || 0, automaticEnd);
}

/** Un juego ocupa su día únicamente durante la hora contada desde su inicio real. */
export function operationAffectsDate(
  operation: DirectCourtOperation | null,
  date: string,
  now: number,
): boolean {
  if (
    !operation?.activeReservationId ||
    !operation.actualStartAt ||
    now >= operation.actualStartAt + HOUR
  )
    return false;
  const start = directDayStart(date),
    end = start + 24 * HOUR;
  return end > operation.actualStartAt && (start <= now || start < operation.actualStartAt + HOUR);
}

export function projectDirectSchedule(
  date: string,
  slots: DirectScheduleSlot[],
  operation: DirectCourtOperation | null,
  now: number,
): DirectScheduleItem[] {
  const dayEnd = directDayStart(date) + 24 * HOUR;
  const previousActive =
    operation?.activeReservationId && operation.actualStartAt && operation.actualStartAt < dayEnd
      ? operation
      : null;
  const active =
    previousActive && now < previousActive.actualStartAt! + HOUR ? previousActive : null;
  let cursor = previousActive ? previousActive.actualStartAt! + HOUR : 0;
  if (operation?.lastEndedAt && operation.lastEndedAt < dayEnd)
    cursor = Math.max(cursor, operation.lastEndedAt);
  const completed = (slot: DirectScheduleSlot) =>
    slot.serviceStatus === 'completed' ||
    (slot.serviceStatus === 'running' && !!slot.actualStartAt && now >= slot.actualStartAt + HOUR);
  for (const slot of slots) {
    if (completed(slot))
      cursor = Math.max(
        cursor,
        slot.serviceStatus === 'completed' ? slot.actualEndAt || 0 : slot.actualStartAt! + HOUR,
      );
  }
  return slots
    .filter(
      (slot) =>
        slot.status === 'confirmed' &&
        !completed(slot) &&
        !(previousActive?.activeReservationId === slot.reservationId && !active),
    )
    .sort((a, b) => a.hour - b.hour || a.reservationId.localeCompare(b.reservationId))
    .map((slot) => {
      const running = active?.activeReservationId === slot.reservationId;
      const start = running
        ? active!.actualStartAt!
        : Math.max(directDayStart(date) + slot.hour * HOUR, cursor, now);
      const end = start + HOUR;
      cursor = Math.max(cursor, end);
      return {
        reservationId: slot.reservationId,
        scheduledHour: slot.hour,
        estimatedStartAt: start,
        estimatedEndAt: end,
        running: !!running,
        awaitingFinish: false,
      };
    });
}

export function overlapsDirectSchedule(schedule: DirectScheduleItem[], start: number): boolean {
  return schedule.some(
    (item) => start < item.estimatedEndAt && start + HOUR > item.estimatedStartAt,
  );
}
