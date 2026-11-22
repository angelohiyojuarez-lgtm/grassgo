export interface CourtPricing {
  id: string;
  name: string;
  sport?: string;
  dayPriceCents: number | null;
  nightPriceCents: number | null;
  nightStartsAt: number | null;
  revision: number;
}

export interface AdminPricingData {
  name: string;
  advanceCents: number | null;
  courts: CourtPricing[];
}

export function pricingError(code: string, message: string): never {
  throw Object.assign(new Error(message), { code: 'functions/' + code });
}

/** Lee soles con hasta dos decimales, sin redondear silenciosamente el importe. */
export function solesToCents(value: string): number | null {
  const text = value.trim();
  if (!/^[0-9]{1,5}([.,][0-9]{1,2})?$/.test(text)) return null;
  const [whole, decimal = ''] = text.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return cents >= 1000 && cents <= 1000000 ? cents : null;
}
