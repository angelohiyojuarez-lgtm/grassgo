import { createHash, randomUUID } from 'node:crypto';

const LIMIT = 5 * 1024 * 1024;
export function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return null;
}

// Solo el servidor accede a estos documentos; las reglas existentes deniegan al navegador.
// Archivos pequeños del piloto en bloques inferiores al límite de 1 MiB de Firestore.
export function firestoreMedia(db) {
  const reference = (path) =>
    db.collection('private_media').doc(createHash('sha256').update(path).digest('hex'));
  async function put(path, bytes, contentType) {
    if (!bytes.length || bytes.length > LIMIT || imageType(bytes) !== contentType) {
      throw Object.assign(new Error('Usa JPG, PNG o WebP válido de hasta 5 MB.'), {
        code: 'invalid-argument',
      });
    }
    const ref = reference(path),
      generation = randomUUID();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const metadata = {
      size: String(bytes.length),
      contentType,
      generation,
      customMetadata: { sha256: hash },
      path,
    };
    return db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.exists) {
        if (current.data().customMetadata.sha256 !== hash)
          throw Object.assign(new Error('Ya existe un archivo distinto.'), {
            code: 'already-exists',
          });
        return current.data();
      }
      const pieces = [];
      for (let offset = 0; offset < bytes.length; offset += 384 * 1024)
        pieces.push(bytes.subarray(offset, offset + 384 * 1024));
      tx.create(ref, { ...metadata, parts: pieces.length });
      pieces.forEach((data, index) =>
        tx.create(ref.collection('parts').doc(String(index)), { data }),
      );
      return metadata;
    });
  }
  function file(path) {
    return {
      async getMetadata() {
        const snap = await reference(path).get();
        if (!snap.exists)
          throw Object.assign(new Error('Archivo inexistente.'), { code: 'not-found' });
        return [snap.data()];
      },
      async download() {
        const [meta] = await this.getMetadata();
        const pieces = await db.getAll(
          ...Array.from({ length: meta.parts }, (_, i) =>
            reference(path).collection('parts').doc(String(i)),
          ),
        );
        if (pieces.some((p) => !p.exists)) throw new Error('Archivo incompleto.');
        return [Buffer.concat(pieces.map((p) => p.data().data))];
      },
    };
  }
  return { put, bucket: () => ({ file }) };
}

export async function authorizeMedia(db, uid, path, write, now = Date.now()) {
  const fail = () => {
    throw Object.assign(new Error('No tienes acceso a este archivo.'), {
      code: 'permission-denied',
    });
  };
  const proof = /^proofs\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9-]{1,80})\/receipt$/.exec(path);
  const business = /^business-media\/([A-Za-z0-9-]{1,80})\/([A-Za-z0-9-]{1,80})$/.exec(path);
  if (proof) {
    const reservation = (await db.doc(`reservations/${proof[2]}`).get()).data();
    if (!reservation || reservation.clientUid !== proof[1]) return fail();
    if (write) {
      if (
        uid !== proof[1] ||
        reservation.status !== 'pending_payment' ||
        reservation.expiresAt.toMillis() <= now
      )
        return fail();
    } else if (uid !== proof[1]) {
      const venue = (await db.doc(`establishments/${reservation.establishmentId}`).get()).data();
      const member = (
        await db.doc(`establishments/${reservation.establishmentId}/members/${uid}`).get()
      ).data();
      if (
        !['approved', 'published'].includes(venue?.status) ||
        member?.role !== 'admin' ||
        member.status !== 'active'
      )
        return fail();
    }
    return;
  }
  if (business) {
    const venue = (await db.doc(`establishments/${business[1]}`).get()).data();
    if (!venue) return fail();
    const role = (await db.doc(`platform_roles/${uid}`).get()).data();
    const platform = role?.role === 'superadmin' && role.status === 'active';
    if (write) {
      if (!platform || !['draft', 'pending', 'approved', 'suspended'].includes(venue.status))
        return fail();
    } else if (!platform && venue.status !== 'published') {
      const member = (await db.doc(`establishments/${business[1]}/members/${uid}`).get()).data();
      if (
        !['approved', 'published'].includes(venue.status) ||
        member?.role !== 'admin' ||
        member.status !== 'active'
      )
        return fail();
    }
    return;
  }
  return fail();
}
