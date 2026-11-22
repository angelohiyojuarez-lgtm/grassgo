export interface PlatformCourt {
  id: string;
  name: string;
  sport?: string;
  status: string;
  dayPriceCents: number | null;
  nightPriceCents: number | null;
  nightStartsAt: number | null;
}

export interface PlatformVenue {
  id: string;
  name: string;
  location: string;
  description: string;
  status: string;
  publicationStatus: 'published' | 'draft' | 'suspended' | 'missing';
  bookingEnabled: boolean;
  courtCount: number;
  courts: PlatformCourt[];
  courtLimitReached: boolean;
  ownerAssigned: boolean;
  scheduleConfigured: boolean;
  paymentConfigured: boolean;
  ready: boolean;
  missing: string[];
}

export interface PlatformOverview {
  establishments: PlatformVenue[];
  /** Estos contadores corresponden a los negocios cargados, no a una muestra oculta. */
  totals: {
    businesses: number;
    published: number;
    enabled: number;
    suspended: number;
    courts: number;
  };
  totalBusinessCount: number;
  limitReached: boolean;
}

export interface PlatformAuditEvent {
  id: string;
  action: string;
  establishmentId: string;
  actorUid: string;
  at: number | null;
  status: string | null;
  kind?: string;
}

export function platformError(code: string, message: string): never {
  throw Object.assign(new Error(message), { code: 'functions/' + code });
}
