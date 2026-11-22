export type KioskPaymentMethod = 'cash' | 'yape' | 'plin';
export type KioskMovementKind = 'create' | 'edit' | 'restock' | 'sale';

export const KIOSK_PHOTO_MAX_LENGTH = 180_000;
/** La foto es opcional y nunca admite HTML, SVG ni enlaces externos. */
export function validKioskPhoto(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length >= 32 &&
      value.length <= KIOSK_PHOTO_MAX_LENGTH &&
      /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value))
  );
}

/** Importes enteros en céntimos; null conserva un costo todavía desconocido. */
export interface KioskProductSnapshot {
  name: string;
  category: string;
  priceCents: number;
  costCents: number | null;
  active: boolean;
}

export interface KioskProduct extends KioskProductSnapshot {
  id: string;
  /** Ausente en productos anteriores, null cuando no se ha elegido foto. */
  photo?: string | null;
  stock: number;
  revision: number;
  createdAt: number | null;
  createdBy: string;
  updatedAt: number | null;
  updatedBy: string;
  lastMovementId: string;
}

export interface KioskMovement {
  id: string;
  productId: string;
  kind: KioskMovementKind;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  productSnapshot: KioskProductSnapshot;
  totalCents: number;
  costTotalCents: number | null;
  profitCents: number | null;
  paymentMethod: KioskPaymentMethod | null;
  paymentReceived: boolean;
  revision: number;
  actorUid: string;
  at: number | null;
}

export interface KioskProductInput extends KioskProductSnapshot {
  productId: string;
  /** Omitir conserva la foto existente; null la quita explícitamente. */
  photo?: string | null;
  operationId: string;
  initialStock: number;
  expectedRevision: number;
}

export interface KioskStockInput {
  productId: string;
  operationId: string;
  quantity: number;
  expectedRevision: number;
}

export interface KioskSaleInput extends KioskStockInput {
  paymentMethod: KioskPaymentMethod;
  paymentReceived: true;
}
