import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
const fail = (code, message) => { throw new HttpsError(code, message); };
export function makeRatingsApi(db, { now = () => Date.now() } = {}) {
  return {
    async rateEstablishment(uid, input) {
      if (!uid) fail('unauthenticated', 'Inicia sesión para calificar.');
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).some(key => !['reservationId', 'stars'].includes(key)) ||
          typeof input.reservationId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(input.reservationId) ||
          !Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5)
        fail('invalid-argument', 'Elige una calificación de 1 a 5 estrellas.');
      return db.runTransaction(async tx => {
        const ref = db.doc(`reservations/${input.reservationId}`);
        const r = (await tx.get(ref)).data();
        if (!r || r.clientUid !== uid) fail('permission-denied', 'Solo puedes calificar tus propias reservas.');
        if (r.status !== 'confirmed' || r.paymentStatus !== 'verified' ||
            r.serviceStatus !== 'completed' || !r.actualEndAt?.toMillis || r.actualEndAt.toMillis() > now())
          fail('failed-precondition', 'Podrás calificar cuando el administrador finalice tu partido.');
        if (r.rating) {
          if (r.rating.stars === input.stars) return { stars: r.rating.stars };
          fail('already-exists', 'Ya calificaste esta reserva.');
        }
        const venueRef = db.doc(`establishments/${r.establishmentId}`);
        const venue = (await tx.get(venueRef)).data();
        if (!venue) fail('not-found', 'El establecimiento ya no está disponible.');
        const field = r.demo === true ? 'demoRatingSummary' : 'ratingSummary';
        const previous = venue[field] || { count: 0, sum: 0 };
        const count = previous.count + 1, sum = previous.sum + input.stars;
        tx.update(ref, { rating: { stars: input.stars, ratedAt: FieldValue.serverTimestamp() } });
        tx.update(venueRef, { [field]: { count, sum, average: sum / count } });
        tx.create(ref.collection('events').doc(), {
          action: 'establishment_rated', actorUid: uid, stars: input.stars, at: FieldValue.serverTimestamp(),
        });
        tx.create(db.collection('audit_logs').doc(), {
          action: 'establishment_rated', actorUid: uid, establishmentId: r.establishmentId,
          reservationId: input.reservationId, stars: input.stars, demo: r.demo === true,
          at: FieldValue.serverTimestamp(),
        });
        return { stars: input.stars };
      });
    },
  };
}
