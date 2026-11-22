export type IncomePeriod = 'day' | 'week' | 'month';
export type IncomeMethod = 'cash' | 'yape' | 'plin';
export interface CourtIncome {
  reservationId: string;
  courtId: string;
  courtName: string;
  date: string;
  hour: number;
  totalCents: number;
  advanceCents: number;
  advanceAt: number;
  advanceBy: string;
  balanceCents: number;
  balanceAt: number | null;
  balanceBy: string | null;
  balanceMethod: IncomeMethod | null;
}
export interface IncomeSale {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  totalCents: number;
  costTotalCents: number | null;
  profitCents: number | null;
  paymentMethod: IncomeMethod;
  at: number;
}
export interface IncomeSummary {
  courtAdvancesCents: number;
  courtBalancesCents: number;
  courtsCents: number;
  productsCents: number;
  totalCents: number;
  saleCount: number;
  unitsSold: number;
  knownProfitCents: number;
  uncostedSales: number;
  costedSales: number;
}
export interface IncomeRange {
  startDate: string;
  endDate: string;
  startMs: number;
  endMs: number;
}
export interface BusinessIncomeReport {
  range: IncomeRange;
  summary: IncomeSummary;
  sales: IncomeSale[];
  outstanding: CourtIncome[];
  topProducts: { productId: string; name: string; quantity: number; totalCents: number }[];
}
const shiftDate = (value: string, days: number): string => {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export function incomeRange(period: IncomePeriod, anchor: string): IncomeRange {
  const value = new Date(anchor + 'T12:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(anchor) ||
    !Number.isFinite(value.getTime()) ||
    value.toISOString().slice(0, 10) !== anchor
  )
    throw new Error('Elige una fecha válida.');
  let startDate = anchor,
    endDate: string;
  if (period === 'week') {
    startDate = shiftDate(anchor, -((value.getUTCDay() + 6) % 7));
    endDate = shiftDate(startDate, 7);
  } else if (period === 'month') {
    startDate = anchor.slice(0, 7) + '-01';
    const next = new Date(startDate + 'T12:00:00Z');
    next.setUTCMonth(next.getUTCMonth() + 1);
    endDate = next.toISOString().slice(0, 10);
  } else if (period === 'day') endDate = shiftDate(anchor, 1);
  else throw new Error('Elige día, semana o mes.');
  return {
    startDate,
    endDate,
    startMs: new Date(startDate + 'T00:00:00-05:00').getTime(),
    endMs: new Date(endDate + 'T00:00:00-05:00').getTime(),
  };
}
export function summarizeIncome(
  advances: CourtIncome[],
  balances: CourtIncome[],
  sales: IncomeSale[],
): IncomeSummary {
  const courtAdvancesCents = advances.reduce((sum, item) => sum + item.advanceCents, 0);
  const courtBalancesCents = balances.reduce((sum, item) => sum + item.balanceCents, 0);
  const productsCents = sales.reduce((sum, item) => sum + item.totalCents, 0);
  const courtsCents = courtAdvancesCents + courtBalancesCents;
  return {
    courtAdvancesCents,
    courtBalancesCents,
    courtsCents,
    productsCents,
    totalCents: courtsCents + productsCents,
    saleCount: sales.length,
    unitsSold: sales.reduce((sum, item) => sum + item.quantity, 0),
    knownProfitCents: sales.reduce((sum, item) => sum + (item.profitCents ?? 0), 0),
    uncostedSales: sales.filter((item) => item.costTotalCents === null).length,
    costedSales: sales.filter((item) => item.costTotalCents !== null).length,
  };
}
