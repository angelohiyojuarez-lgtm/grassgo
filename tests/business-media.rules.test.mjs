import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
let env;
const bucket = 'gs://demo-grassgo.firebasestorage.app';
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-grassgo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});
after(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'platform_roles/super'), { role: 'superadmin', status: 'active' });
    await setDoc(doc(db, 'platform_roles/suspended'), { role: 'superadmin', status: 'suspended' });
    await setDoc(doc(db, 'establishments/a'), { status: 'draft' });
    await setDoc(doc(db, 'establishments/b'), { status: 'published' });
    await setDoc(doc(db, 'establishments/b/members/admin-b'), { role: 'admin', status: 'active' });
  });
});
const file = (uid, path) => env.authenticatedContext(uid).storage(bucket).ref(path);
test('solo superadmin activo puede subir fotos o QR a un borrador existente', async () => {
  const path = `business-media/a/${randomUUID()}`;
  await assertSucceeds(file('super', path).put(image, { contentType: 'image/png' }));
  for (const uid of ['cliente', 'admin-b', 'suspended'])
    await assertFails(
      file(uid, `business-media/a/${randomUUID()}`).put(image, { contentType: 'image/png' }),
    );
  await assertFails(
    file('super', `business-media/missing/${randomUUID()}`).put(image, {
      contentType: 'image/png',
    }),
  );
});
test('fotos y QR de borrador no son públicos ni accesibles por admin de otro local', async () => {
  const path = `business-media/a/${randomUUID()}`;
  await file('super', path).put(image, { contentType: 'image/png' });
  await assertSucceeds(file('super', path).getMetadata());
  for (const uid of ['cliente', 'admin-b', 'suspended'])
    await assertFails(file(uid, path).getMetadata());
  await assertFails(env.unauthenticatedContext().storage(bucket).ref(path).getMetadata());
});
test('fotos publicadas son visibles para clientes autenticados, no para visitantes', async () => {
  const path = `business-media/b/${randomUUID()}`;
  await env.withSecurityRulesDisabled(async (context) => {
    await context.storage(bucket).ref(path).put(image, { contentType: 'image/png' });
  });
  await assertSucceeds(file('cliente', path).getMetadata());
  await assertSucceeds(file('admin-b', path).getMetadata());
  await assertFails(env.unauthenticatedContext().storage(bucket).ref(path).getMetadata());
  await assertFails(
    file('super', `business-media/b/${randomUUID()}`).put(image, { contentType: 'image/png' }),
  );
});
test('imágenes inmutables: no pueden reemplazarse ni borrarse desde el navegador', async () => {
  const path = `business-media/a/${randomUUID()}`;
  await file('super', path).put(image, { contentType: 'image/png' });
  await assertFails(file('super', path).put(image, { contentType: 'image/png' }));
  await assertFails(file('super', path).delete());
});
test('rechaza SVG, HTML, archivos grandes, vacíos y rutas no admitidas', async () => {
  for (const type of ['image/svg+xml', 'text/html'])
    await assertFails(
      file('super', `business-media/a/${randomUUID()}`).put(image, { contentType: type }),
    );
  await assertFails(
    file('super', `business-media/a/${randomUUID()}`).put(new Uint8Array(5 * 1024 * 1024 + 1), {
      contentType: 'image/png',
    }),
  );
  await assertFails(
    file('super', `business-media/a/${randomUUID()}`).put(new Uint8Array(), {
      contentType: 'image/png',
    }),
  );
  await assertFails(
    file('super', 'business-media/a/ruta/no-valida').put(image, { contentType: 'image/png' }),
  );
});
