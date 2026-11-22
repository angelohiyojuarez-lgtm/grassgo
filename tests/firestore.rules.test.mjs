import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

let environment;
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-grassgo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => {
  await environment?.cleanup();
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'profiles/alice'), {
        uid: 'alice',
        displayName: 'Alicia',
        phone: '',
        createdAt: Timestamp.fromMillis(1000),
        updatedAt: Timestamp.fromMillis(1000),
      }),
      setDoc(doc(db, 'establishments/a'), { name: 'Local A', status: 'approved' }),
      setDoc(doc(db, 'establishments/b'), { name: 'Local B', status: 'approved' }),
      setDoc(doc(db, 'establishments/a/members/admin-a'), { role: 'admin', status: 'active' }),
      setDoc(doc(db, 'establishments/b/members/admin-b'), { role: 'admin', status: 'active' }),
      setDoc(doc(db, 'establishments/a/courts/one'), { name: 'Cancha A' }),
      setDoc(doc(db, 'establishments/b/courts/one'), { name: 'Cancha B' }),
      setDoc(doc(db, 'platform_roles/root'), { role: 'superadmin', status: 'active' }),
      setDoc(doc(db, 'catalog/a'), { name: 'Local A', status: 'published' }),
      setDoc(doc(db, 'catalog/b'), { name: 'Local B', status: 'draft' }),
    ]);
  });
});
const dbFor = (uid) => environment.authenticatedContext(uid).firestore();
const profile = (uid) => ({
  uid,
  displayName: 'Cliente',
  phone: '+51 987 654 321',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

test('perfil propio: crear, leer y actualizar con timestamps de servidor', async () => {
  const reference = doc(dbFor('bob'), 'profiles/bob');
  await assertSucceeds(setDoc(reference, profile('bob')));
  await assertSucceeds(getDoc(reference));
  await assertSucceeds(
    updateDoc(reference, { displayName: 'Roberto', updatedAt: serverTimestamp() }),
  );
});
test('visitante no puede leer perfiles ni listar el catálogo', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'profiles/alice')));
  await assertFails(getDocs(collection(db, 'catalog')));
});
test('cliente y superadmin no pueden leer el perfil privado de otro usuario', async () => {
  await assertFails(getDoc(doc(dbFor('bob'), 'profiles/alice')));
  await assertFails(getDoc(doc(dbFor('root'), 'profiles/alice')));
  await assertFails(getDocs(collection(dbFor('bob'), 'profiles')));
});
test('crear con UID ajeno o en el perfil ajeno falla', async () => {
  await assertFails(setDoc(doc(dbFor('bob'), 'profiles/bob'), profile('alice')));
  await assertFails(setDoc(doc(dbFor('bob'), 'profiles/charlie'), profile('charlie')));
});
test('inyección de rol o contraseña se rechaza en creación y actualización', async () => {
  await assertFails(
    setDoc(doc(dbFor('bob'), 'profiles/bob'), { ...profile('bob'), role: 'superadmin' }),
  );
  for (const fields of [{ role: 'admin' }, { password: 'no-guardar' }, { extra: 'x' }]) {
    await assertFails(
      updateDoc(doc(dbFor('alice'), 'profiles/alice'), { ...fields, updatedAt: serverTimestamp() }),
    );
  }
});
test('actualización no permite cambiar titular o fecha de creación', async () => {
  const reference = doc(dbFor('alice'), 'profiles/alice');
  await assertFails(updateDoc(reference, { uid: 'bob', updatedAt: serverTimestamp() }));
  await assertFails(
    updateDoc(reference, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
  );
});
test('esquema cerrado: límites, tipos, campos obligatorios y teléfono', async () => {
  const reference = doc(dbFor('alice'), 'profiles/alice');
  for (const fields of [
    { displayName: 'x'.repeat(81) },
    { displayName: 123 },
    { displayName: '   ' },
    { phone: 'x'.repeat(21) },
    { phone: '<script>' },
    { phone: deleteField() },
  ]) {
    await assertFails(updateDoc(reference, { ...fields, updatedAt: serverTimestamp() }));
  }
  const missing = profile('bob');
  delete missing.phone;
  await assertFails(setDoc(doc(dbFor('bob'), 'profiles/bob'), missing));
});
test('timestamps manipulados y borrado de perfil se rechazan', async () => {
  await assertFails(
    setDoc(doc(dbFor('bob'), 'profiles/bob'), {
      ...profile('bob'),
      createdAt: Timestamp.fromMillis(0),
    }),
  );
  await assertFails(
    updateDoc(doc(dbFor('alice'), 'profiles/alice'), { updatedAt: Timestamp.fromMillis(0) }),
  );
  await assertFails(deleteDoc(doc(dbFor('alice'), 'profiles/alice')));
});
test('administrador A lee su establecimiento y cancha, pero no B', async () => {
  const db = dbFor('admin-a');
  await assertSucceeds(getDoc(doc(db, 'establishments/a')));
  await assertSucceeds(getDoc(doc(db, 'establishments/a/courts/one')));
  await assertFails(getDoc(doc(db, 'establishments/b')));
  await assertFails(getDoc(doc(db, 'establishments/b/courts/one')));
  await assertFails(updateDoc(doc(db, 'establishments/b'), { name: 'Tomado' }));
  await assertFails(setDoc(doc(db, 'establishments/b/courts/two'), { name: 'Tomada' }));
});
test('no se pueden crear privilegios, asignaciones ni publicaciones desde el navegador', async () => {
  const db = dbFor('bob');
  for (const path of [
    'platform_roles/bob',
    'users/bob/memberships/a',
    'establishments/a/members/bob',
    'catalog/new',
  ]) {
    await assertFails(setDoc(doc(db, path), { role: 'superadmin', status: 'active' }));
  }
});
test('índice de asignaciones es privado al titular; no autoriza acceso canónico', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users/bob/memberships/a'), {
      role: 'admin',
      status: 'active',
    });
  });
  await assertSucceeds(getDocs(collection(dbFor('bob'), 'users/bob/memberships')));
  await assertFails(getDocs(collection(dbFor('alice'), 'users/bob/memberships')));
  await assertFails(getDoc(doc(dbFor('bob'), 'establishments/a')));
});
test('suspender miembro o establecimiento revoca lecturas', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'establishments/a/members/admin-a'), {
      status: 'suspended',
    });
    await updateDoc(doc(context.firestore(), 'establishments/b'), { status: 'suspended' });
  });
  await assertFails(getDoc(doc(dbFor('admin-a'), 'establishments/a/courts/one')));
  await assertFails(getDoc(doc(dbFor('admin-b'), 'establishments/b/courts/one')));
});
test('subcolección huérfana no es accesible aunque haya membresía', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), 'establishments/a'));
  });
  await assertFails(getDoc(doc(dbFor('admin-a'), 'establishments/a/courts/one')));
});
test('catálogo: consulta publicada permitida; borradores y listado sin filtro denegados', async () => {
  const db = dbFor('alice');
  await assertSucceeds(
    getDocs(query(collection(db, 'catalog'), where('status', '==', 'published'), limit(30))),
  );
  await assertFails(getDoc(doc(db, 'catalog/b')));
  await assertFails(getDocs(collection(db, 'catalog')));
});
test('superadmin activo puede leer tenants; suspendido pierde acceso', async () => {
  await assertSucceeds(getDoc(doc(dbFor('root'), 'establishments/b')));
  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'platform_roles/root'), { status: 'suspended' });
  });
  await assertFails(getDoc(doc(dbFor('root'), 'establishments/b')));
});
test('rutas antiguas, reservas y pagos permanecen denegados', async () => {
  const db = dbFor('alice');
  for (const path of ['users/alice', 'reservations/new', 'payments/new', 'audit_logs/new']) {
    await assertFails(setDoc(doc(db, path), { ownerUid: 'alice', status: 'confirmed' }));
    await assertFails(getDoc(doc(db, path)));
  }
});
