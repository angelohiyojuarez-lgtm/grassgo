// Horario reservado inmutable; la proyección operativa se calcula en el servidor.
export const millis = (value) => value?.toMillis?.() ?? null;
export const limaDate = (value) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

export function projectSchedule(reservations, runtime, now, lastEndedAt = null) {
  let cursor = runtime ? Math.max(millis(runtime.estimatedEndAt), now) : 0;
  cursor = Math.max(cursor, millis(lastEndedAt) || 0);
  cursor = Math.max(
    cursor,
    ...reservations
      .filter((r) => r.serviceStatus === 'completed')
      .map((r) => millis(r.actualEndAt) || 0),
  );
  const items = reservations
    .filter((r) => r.status === 'confirmed' && r.serviceStatus !== 'completed')
    .sort((a, b) => millis(a.startsAt) - millis(b.startsAt) || a.id.localeCompare(b.id));
  return items.map((r) => {
    const running = runtime?.reservationId === r.id;
    const start = running ? millis(runtime.actualStartAt) : Math.max(millis(r.startsAt), cursor);
    const end = running ? Math.max(millis(runtime.estimatedEndAt), now) : start + 3600000;
    if (!running) cursor = end;
    return {
      reservationId: r.id,
      scheduledHour: r.hour,
      estimatedStartAt: start,
      estimatedEndAt: end,
      running,
      awaitingFinish: running && now > millis(runtime.estimatedEndAt),
    };
  });
}

export async function readSchedule(db, establishmentId, courtId, date, court, now, transaction) {
  const query = db
    .collection('reservations')
    .where('establishmentId', '==', establishmentId)
    .where('courtId', '==', courtId)
    .where('date', '==', date);
  const result = await (transaction ? transaction.get(query) : query.get());
  return projectSchedule(
    result.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
    court.runtime,
    now,
    court.lastEndedAt,
  );
}

export function conflictsWithSchedule(schedule, runtime, start, end, now) {
  if (runtime && now > millis(runtime.estimatedEndAt)) return true;
  if (runtime && start < millis(runtime.estimatedEndAt) && end > millis(runtime.actualStartAt))
    return true;
  return schedule.some((item) => start < item.estimatedEndAt && end > item.estimatedStartAt);
}

export async function enrichReservations(db, reservations, now) {
  const schedules = new Map();
  await Promise.all(
    reservations.map(async (r) => {
      if (r.status !== 'confirmed' || r.serviceStatus === 'completed') return;
      const key = `${r.establishmentId}/${r.courtId}/${r.date}`;
      if (!schedules.has(key))
        schedules.set(
          key,
          (async () => {
            const court = await db
              .doc(`establishments/${r.establishmentId}/courts/${r.courtId}`)
              .get();
            return readSchedule(db, r.establishmentId, r.courtId, r.date, court.data() || {}, now);
          })(),
        );
      const item = (await schedules.get(key)).find((entry) => entry.reservationId === r.id);
      if (item)
        Object.assign(r, {
          estimatedStartAt: item.estimatedStartAt,
          estimatedEndAt: item.estimatedEndAt,
          awaitingFinish: item.awaitingFinish,
        });
    }),
  );
  return reservations;
}
