export function limaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
export function calendarDays(month: string): { date: string; day: number; inMonth: boolean }[] {
  const first = new Date(`${month}-01T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(`${month}-01`, index - offset);
    return { date, day: Number(date.slice(-2)), inMonth: date.startsWith(month) };
  });
}
export function longDate(date: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00-05:00`));
}
