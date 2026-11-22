export interface ConfiguredCourt {
  id: string;
  name: string;
  sport: string;
  surface: string;
  dayPriceCents: number | null;
  nightPriceCents: number | null;
  nightStartsAt: number | null;
  images: string[];
}
export interface BusinessConfiguration {
  name: string;
  district: string;
  address: string;
  reference: string;
  description: string;
  phone: string;
  images: string[];
  days: number[];
  openHour: number | null;
  closeHour: number | null;
  courts: ConfiguredCourt[];
  holdMinutes: number | null;
  adminEmail: string;
  payment: {
    mode: 'demo' | 'live';
    methods: string[];
    recipient: string;
    phone: string;
    qr: string;
  };
}
export interface BusinessConfigurationResponse {
  id: string;
  name: string;
  location: string;
  status: string;
  revision: number;
  configuration: BusinessConfiguration | null;
  legacyCourts?: ConfiguredCourt[];
}
export const emptyCourt = (index: number): ConfiguredCourt => ({
  id: crypto.randomUUID(),
  name: `Cancha ${index}`,
  sport: '',
  surface: '',
  dayPriceCents: null,
  nightPriceCents: null,
  nightStartsAt: null,
  images: [],
});
export const emptyConfiguration = (): BusinessConfiguration => ({
  name: '',
  district: '',
  address: '',
  reference: '',
  description: '',
  phone: '',
  images: [],
  days: [],
  openHour: null,
  closeHour: null,
  courts: [emptyCourt(1)],
  holdMinutes: null,
  adminEmail: '',
  payment: { mode: 'live', methods: [], recipient: '', phone: '', qr: '' },
});
