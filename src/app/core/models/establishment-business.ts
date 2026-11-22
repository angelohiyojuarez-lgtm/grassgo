export interface BusinessContact {
  phone: string;
  description: string;
  reference: string;
  revision: number;
}

export interface BusinessPayment {
  methods: string[];
  recipient: string;
  phone: string;
  qr: string;
  revision: number;
}

export interface PreparedPaymentQr {
  id: string;
  imageData: string;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  sha256: string;
}

export interface AdminBusinessData {
  name: string;
  contact: BusinessContact;
  payment: BusinessPayment;
}

export const PAYMENT_QR_MAX_LENGTH = 420000;

export function businessSettingsError(code: string, message: string): never {
  throw Object.assign(new Error(message), { code: 'functions/' + code });
}

/** Una referencia inmutable, sin incorporar la foto a cada tarjeta del catálogo. */
export function paymentQrParts(path: string): { establishmentId: string; id: string } | null {
  const match = /^payment-qrs\/([A-Za-z0-9-]{1,80})\/([A-Za-z0-9-]{1,80})$/.exec(path);
  return match ? { establishmentId: match[1], id: match[2] } : null;
}

export function validPaymentQr(value: PreparedPaymentQr): boolean {
  return (
    !!value &&
    /^[A-Za-z0-9-]{1,80}$/.test(value.id) &&
    value.contentType === 'image/jpeg' &&
    Number.isInteger(value.width) &&
    value.width >= 64 &&
    value.width <= 1600 &&
    Number.isInteger(value.height) &&
    value.height >= 64 &&
    value.height <= 1600 &&
    typeof value.imageData === 'string' &&
    value.imageData.length >= 32 &&
    value.imageData.length <= PAYMENT_QR_MAX_LENGTH &&
    /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value.imageData) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  );
}
