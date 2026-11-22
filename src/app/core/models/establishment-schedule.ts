export interface WeeklySchedule {
  days: number[];
  openHour: number | null;
  closeHour: number | null;
  revision: number;
}

export interface DateClosure {
  date: string;
  dateStart: number;
  closed: boolean;
  reason: string;
  revision: number;
}

export interface AdminScheduleData {
  name: string;
  schedule: WeeklySchedule;
  closures: DateClosure[];
  closureLimitReached?: boolean;
}

export function scheduleError(code: string, message: string): never {
  throw Object.assign(new Error(message), { code: 'functions/' + code });
}

export function scheduleDateStart(date: string): number {
  const instant = Date.parse(date + 'T00:00:00-05:00');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(instant) ||
    new Date(instant - 5 * 3600000).toISOString().slice(0, 10) !== date
  )
    scheduleError('invalid-argument', 'Elige una fecha válida.');
  return instant;
}
