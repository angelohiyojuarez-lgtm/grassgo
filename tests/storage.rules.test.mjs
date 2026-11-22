import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
let environment;
const bucket = 'gs://demo-grassgo.firebasestorage.app';
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-grassgo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});
after(async () => {
  await environment?.cleanup();
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    try {
      await context.storage(bucket).ref('proofs/alice/one/receipt').delete();
    } catch (error) {
      if (error.code !== 'storage/object-not-found') throw error;
    }
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'reservations/one'), {
      clientUid: 'alice',
      establishmentId: 'a',
      status: 'pending_payment',
      expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
    });
    await setDoc(doc(db, 'establishments/a'), { status: 'published' });
    await setDoc(doc(db, 'establishments/b'), { status: 'published' });
    await setDoc(doc(db, 'establishments/a/members/admin-a'), { role: 'admin', status: 'active' });
    await setDoc(doc(db, 'establishments/b/members/admin-b'), { role: 'admin', status: 'active' });
  });
});
const file = (uid, path = 'proofs/alice/one/receipt') =>
  environment.authenticatedContext(uid).storage(bucket).ref(path);
test('titular puede subir comprobante pendiente y leerlo', async () => {
  await assertSucceeds(file('alice').put(image, { contentType: 'image/png' }));
  await assertSucceeds(file('alice').getMetadata());
});
test('comprobante es privado: visitante y otro cliente no pueden leer/subir', async () => {
  await assertFails(
    environment
      .unauthenticatedContext()
      .storage(bucket)
      .ref('proofs/alice/one/receipt')
      .put(image, { contentType: 'image/png' }),
  );
  await assertSucceeds(file('alice').put(image, { contentType: 'image/png' }));
  await assertFails(file('bob').getMetadata());
  await assertFails(file('bob', 'proofs/bob/one/receipt').put(image, { contentType: 'image/png' }));
});
test('solo administrador del tenant puede leer el comprobante', async () => {
  await assertSucceeds(file('alice').put(image, { contentType: 'image/png' }));
  await assertSucceeds(file('admin-a').getMetadata());
  await assertFails(file('admin-b').getMetadata());
});
test('archivo inmutable: ni titular ni administrador pueden reemplazar o borrar', async () => {
  await assertSucceeds(file('alice').put(image, { contentType: 'image/png' }));
  await assertFails(file('alice').put(image, { contentType: 'image/png' }));
  await assertFails(file('alice').delete());
  await assertFails(file('admin-a').delete());
});
test('tipo, tamaño, ruta y reserva inexistente se rechazan', async () => {
  await assertFails(file('alice').put(image, { contentType: 'text/html' }));
  await assertFails(
    file('alice').put(new Uint8Array(5 * 1024 * 1024 + 1), { contentType: 'image/png' }),
  );
  await assertFails(
    file('alice', 'proofs/alice/missing/receipt').put(image, { contentType: 'image/png' }),
  );
  await assertFails(file('alice', 'public/receipt').put(image, { contentType: 'image/png' }));
});
test('reserva vencida o ya enviada no permite subir', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reservations/one'), {
      clientUid: 'alice',
      establishmentId: 'a',
      status: 'pending_payment',
      expiresAt: Timestamp.fromMillis(0),
    });
  });
  await assertFails(file('alice').put(image, { contentType: 'image/png' }));
});
