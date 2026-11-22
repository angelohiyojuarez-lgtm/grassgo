import { Injectable, inject } from '@angular/core';
import { recordBusinessAudit } from './business-audit';
import type { DocumentData } from 'firebase/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { AdminPricingData, CourtPricing, pricingError } from '../models/establishment-pricing';

function identifier(value: string): void {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(value))
    pricingError('invalid-argument', 'Identificador de local o cancha inválido.');
}
const price = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1000 && Number(value) <= 1000000;
const hour = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 23;
const view = (id: string, name: string, data: DocumentData, sport = ''): CourtPricing => ({
  id,
  name,
  ...(sport ? { sport } : {}),
  dayPriceCents: price(data['dayPriceCents']) ? data['dayPriceCents'] : null,
  nightPriceCents: price(data['nightPriceCents']) ? data['nightPriceCents'] : null,
  nightStartsAt: hour(data['nightStartsAt']) ? data['nightStartsAt'] : null,
  revision: data['revision'] || 0,
});

/** Precios de nuevas solicitudes: canónico, proyecciones e historial en una transacción. */
@Injectable({ providedIn: 'root' })
export class EstablishmentPricingService {
  private readonly firebase = inject(FirebaseService);
  private uid(): string {
    return (
      this.firebase.auth.currentUser?.uid ||
      pricingError('unauthenticated', 'Inicia sesión para continuar.')
    );
  }
  private assertLocal(data: DocumentData | undefined): void {
    if (!data || data['bookingEngine'] !== 'direct')
      pricingError(
        'failed-precondition',
        'La edición de precios de este local todavía no está habilitada.',
      );
  }
  async load(establishmentId: string): Promise<AdminPricingData> {
    this.uid();
    identifier(establishmentId);
    const { doc, collection, query, where, limit, getDocFromServer, getDocsFromServer } =
      await import('firebase/firestore');
    const db = await this.firebase.getDb();
    const local = (await getDocFromServer(doc(db, 'establishments', establishmentId))).data();
    this.assertLocal(local);
    const [parent, courts] = await Promise.all([
      getDocFromServer(doc(db, 'catalog', establishmentId)),
      getDocsFromServer(
        query(
          collection(db, 'establishments', establishmentId, 'courts'),
          where('status', '==', 'active'),
          limit(20),
        ),
      ),
    ]);
    const items = await Promise.all(
      courts.docs.map(async (court) => {
        const saved = await getDocFromServer(
          doc(db, 'establishments', establishmentId, 'courts', court.id, 'settings', 'pricing'),
        );
        return view(
          court.id,
          court.data()['name'] || 'Cancha',
          saved.exists() ? saved.data()! : { ...court.data(), revision: 0 },
          court.data()['sport'] || '',
        );
      }),
    );
    const advance = parent.data()?.['advanceCents'];
    return {
      name: local!['name'] || '',
      advanceCents: Number.isInteger(advance) && advance >= 0 ? advance : null,
      courts: items,
    };
  }
  async savePricing(establishmentId: string, value: CourtPricing): Promise<CourtPricing> {
    const uid = this.uid();
    identifier(establishmentId);
    identifier(value.id);
    if (
      !price(value.dayPriceCents) ||
      !price(value.nightPriceCents) ||
      !hour(value.nightStartsAt) ||
      !Number.isInteger(value.revision) ||
      value.revision < 0 ||
      value.revision >= 1000000000
    )
      pricingError(
        'invalid-argument',
        'Escribe precios de S/ 10 a S/ 10 000 y elige desde qué hora empieza la tarifa de noche.',
      );
    const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    return runTransaction(db, async (tx) => {
      this.assertLocal((await tx.get(doc(db, 'establishments', establishmentId))).data());
      const privateCourt = doc(db, 'establishments', establishmentId, 'courts', value.id);
      const publicCourt = doc(db, 'catalog', establishmentId, 'courts', value.id);
      const parentRef = doc(db, 'catalog', establishmentId);
      const canonical = doc(
        db,
        'establishments',
        establishmentId,
        'courts',
        value.id,
        'settings',
        'pricing',
      );
      const court = (await tx.get(privateCourt)).data();
      const projection = (await tx.get(publicCourt)).data();
      const parent = (await tx.get(parentRef)).data();
      const before = (await tx.get(canonical)).data() || null;
      if (
        !court ||
        court['status'] !== 'active' ||
        !projection ||
        projection['status'] !== 'active' ||
        !Array.isArray(parent?.['courts']) ||
        parent!['courts'].length > 20
      )
        pricingError(
          'failed-precondition',
          'Esta cancha todavía no está preparada. Consulta al administrador de la plataforma.',
        );
      const courts = parent!['courts'] as DocumentData[];
      const index = courts.findIndex((item) => item['id'] === value.id);
      if (index < 0 || courts.filter((item) => item['id'] === value.id).length !== 1)
        pricingError(
          'failed-precondition',
          'La ficha de esta cancha no está preparada. Consulta al administrador de la plataforma.',
        );
      const advance = parent!['advanceCents'];
      if (
        Number.isInteger(advance) &&
        advance > 0 &&
        (value.dayPriceCents! < advance || value.nightPriceCents! < advance)
      )
        pricingError(
          'invalid-argument',
          'El precio de la cancha no puede ser menor que el adelanto configurado para el negocio.',
        );
      if ((before?.['revision'] || 0) !== value.revision)
        pricingError(
          'aborted',
          'Otra persona cambió estos precios. Consulta los precios guardados antes de volver a guardar.',
        );
      const fields = {
        dayPriceCents: value.dayPriceCents,
        nightPriceCents: value.nightPriceCents,
        nightStartsAt: value.nightStartsAt,
      };
      const same = (data: DocumentData) =>
        Object.entries(fields).every(([key, value]) => data[key] === value);
      const versionMatches =
        before &&
        courts[index]['pricingRevision'] === before['revision'] &&
        courts[index]['pricingConfirmed'] === true &&
        court!['pricingRevision'] === before['revision'] &&
        projection!['pricingRevision'] === before['revision'] &&
        JSON.stringify(court!['pricingUpdatedAt']) === JSON.stringify(before['updatedAt']) &&
        JSON.stringify(projection!['pricingUpdatedAt']) === JSON.stringify(before['updatedAt']);
      if (
        before &&
        versionMatches &&
        same(before) &&
        same(court!) &&
        same(projection!) &&
        same(courts[index])
      )
        return view(value.id, court!['name'] || '', before, court!['sport'] || '');
      const revision = value.revision + 1;
      const after = {
        establishmentId,
        courtId: value.id,
        ...fields,
        revision,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      };
      const mirrors = { ...fields, pricingRevision: revision, pricingUpdatedAt: serverTimestamp() };
      tx.set(canonical, after);
      tx.update(privateCourt, mirrors);
      tx.update(publicCourt, mirrors);
      tx.update(parentRef, {
        courts: courts.map((item, itemIndex) =>
          itemIndex === index
            ? { ...item, ...fields, pricingRevision: revision, pricingConfirmed: true }
            : item,
        ),
        pricingCourtId: value.id,
        pricingCourtIndex: index,
        pricingRevision: revision,
        pricingUpdatedAt: serverTimestamp(),
      });
      tx.set(
        doc(
          db,
          'establishments',
          establishmentId,
          'courts',
          value.id,
          'settings',
          'pricing',
          'history',
          String(revision),
        ),
        {
          establishmentId,
          kind: 'pricing',
          revision,
          actorUid: uid,
          at: serverTimestamp(),
          before,
          after,
        },
      );
      await recordBusinessAudit(tx, db, {
        establishmentId,
        actorUid: uid,
        kind: 'pricing',
        referenceId: value.id,
        revision,
      });
      return view(value.id, court!['name'] || '', after, court!['sport'] || '');
    });
  }
}
