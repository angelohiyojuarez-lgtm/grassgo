export interface Venue {
  id: string;
  name: string;
  location: string;
  image: string;
  referenceImage: boolean;
  courts: { id: string; name: string; sport: string }[];
  dayPriceCents: number;
  nightPriceCents: number;
  nightStartsAt: number;
  advanceCents: number;
}
export const PILOT: Venue = {
  id: 'el-puma',
  name: 'Grass El Puma',
  location: 'Salinas, Andahuaylas · Apurímac',
  image: '/assets/login-estadio.png',
  referenceImage: true,
  courts: [{ id: 'principal', name: 'Cancha principal', sport: 'Fútbol' }],
  dayPriceCents: 3000,
  nightPriceCents: 4000,
  nightStartsAt: 18,
  advanceCents: 1000,
};
export interface BookingSlot {
  hour: number;
  available: boolean;
  priceCents: number;
}
export interface Availability {
  schedule?: {
    scheduledHour: number;
    estimatedStartAt: number;
    estimatedEndAt: number;
    running: boolean;
    awaitingFinish: boolean;
  }[];
  maintenance?: boolean;
  closedDate?: boolean;
  weeklyClosed?: boolean;
  awaitingFinish?: boolean;
  activeUntil?: number | null;
  slots: BookingSlot[];
  demo: boolean;
  paymentQr: string;
  paymentMode: 'demo' | 'live';
  holdMinutes: number;
  advanceCents?: number;
  paymentMethods?: string[];
  paymentRecipient?: string;
  paymentPhone?: string;
}
export interface Reservation {
  engine?: 'direct';
  rating?: { stars: number; ratedAt?: number | null } | null;
  startsAt?: number;
  endsAt?: number;
  serviceStatus?: 'running' | 'completed';
  actualStartAt?: number | null;
  actualEndAt?: number | null;
  estimatedStartAt?: number | null;
  estimatedEndAt?: number | null;
  awaitingFinish?: boolean;
  id: string;
  establishmentId: string;
  establishmentName: string;
  courtId: string;
  courtName: string;
  clientUid: string;
  date: string;
  hour: number;
  totalCents: number;
  advanceCents: number;
  status: 'pending_payment' | 'pending_verification' | 'confirmed' | 'rejected' | 'expired';
  paymentStatus: 'unpaid' | 'submitted' | 'verified';
  demo: boolean;
  proofPath?: string;
  expiresAt?: number;
  paymentSnapshot?: {
    mode: 'demo' | 'live';
    qr: string;
    methods: string[];
    recipient: string;
    phone: string;
  };
}
export const money = (cents: number): string =>
  new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const hourLabel = (hour: number): string => `${String(hour % 24).padStart(2, '0')}:00`;
export const clockLabel = (instant: number | null | undefined): string =>
  instant
    ? new Intl.DateTimeFormat('es-PE', {
        timeZone: 'America/Lima',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(instant))
    : '—';
export const slotLabel = (hour: number): string => `${hourLabel(hour)} – ${hourLabel(hour + 1)}`;
export const statusLabel = (status: Reservation['status']): string =>
  ({
    pending_payment: 'Pendiente de pago',
    pending_verification: 'Comprobante en revisión',
    confirmed: 'Reserva confirmada',
    rejected: 'Solicitud rechazada',
    expired: 'Solicitud vencida',
  })[status];
