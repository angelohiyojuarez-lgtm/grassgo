import type { Firestore, Transaction } from 'firebase/firestore';

/** Proyección de actividad: la imagen, el teléfono y los valores anteriores quedan privados. */
export async function recordBusinessAudit(
  tx: Transaction,
  db: Firestore,
  event: {
    establishmentId: string;
    actorUid: string;
    kind: 'contact' | 'payment' | 'schedule' | 'closure' | 'pricing';
    referenceId: string;
    revision: number;
  },
): Promise<void> {
  const { doc, serverTimestamp } = await import('firebase/firestore');
  tx.set(doc(db, 'audit_logs', crypto.randomUUID()), {
    ...event,
    action: 'business_setting_changed',
    at: serverTimestamp(),
  });
}
