// Asignación solicitada por el titular del proyecto. Nunca se ejecuta desde la web.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some((argument) => argument !== '--apply'))
  throw Error('Usa ninguna opción para consultar, o --apply para asignar el permiso autorizado.');

const project = 'grassgoo';
const email = 'angelohiyojuarez@gmail.com';
const expectedUid = 'verADCvI58eKgDpi5EpwLm2fLcA3';
const require = createRequire(import.meta.url);
const { getGlobalDefaultAccount, setActiveAccount } = require('firebase-tools/lib/auth');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { Client } = require('firebase-tools/lib/apiv2');
const options = { project, nonInteractive: true };
setActiveAccount(options, getGlobalDefaultAccount());
await requireAuth(options);
const db = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1', auth: true });
const auth = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', apiVersion: 'v1', auth: true });
const root = `projects/${project}/databases/(default)/documents/`;

async function retry(operation) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 3 || ![429, 500, 502, 503, 504].includes(error.status)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
}
async function read(path, optional = false) {
  try {
    return await retry(async () => (await db.get('/' + root + path)).body);
  } catch (error) {
    if (optional && error.status === 404) return null;
    throw error;
  }
}
const textField = (document, key) => document?.fields?.[key]?.stringValue;
const roleSummary = (document) => ({ role: textField(document, 'role') ?? null, status: textField(document, 'status') ?? null });

const lookup = await retry(async () =>
  (await auth.post(`/projects/${project}/accounts:lookup`, { email: [email] })).body,
);
const user = lookup.users?.[0];
if (lookup.users?.length !== 1 || user.localId !== expectedUid || user.email !== email || user.disabled)
  throw Error('La cuenta consultada no coincide con la identidad autorizada o está deshabilitada.');

const rolePath = 'platform_roles/' + expectedUid;
const memberPath = 'establishments/el-puma/members/' + expectedUid;
const indexPath = 'users/' + expectedUid + '/memberships/el-puma';
const [before, member, index] = await Promise.all([read(rolePath, true), read(memberPath), read(indexPath)]);
for (const document of [member, index])
  if (textField(document, 'role') !== 'admin' || textField(document, 'status') !== 'active')
    throw Error('Revisa la asignación de El Puma antes de añadir el rol global.');

const alreadyActive = textField(before, 'role') === 'superadmin' && textField(before, 'status') === 'active';
console.log(JSON.stringify({ project, email, uid: expectedUid, apply, before: roleSummary(before), pumaMember: roleSummary(member), pumaNavigation: roleSummary(index), alreadyActive }));
if (!apply || alreadyActive) {
  console.log(alreadyActive ? 'La cuenta ya tiene superadministración activa.' : 'Consulta completada. No se modificaron permisos.');
} else {
  const backup = new URL(`../.firebase/superadmin-before-${Date.now()}.json`, import.meta.url);
  await mkdir(new URL('../.firebase/', import.meta.url), { recursive: true });
  await writeFile(backup, JSON.stringify({ project, uid: expectedUid, role: before, member, index }, null, 2), { flag: 'wx' });
  const fields = { role: { stringValue: 'superadmin' }, status: { stringValue: 'active' } };
  const roleWrite = {
    update: { name: root + rolePath, fields },
    currentDocument: before ? { updateTime: before.updateTime } : { exists: false },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
  };
  if (before) roleWrite.updateMask = { fieldPaths: ['role', 'status'] };
  else roleWrite.updateTransforms.push({ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' });
  const auditPath = 'audit_logs/' + randomUUID();
  const auditFields = {
    action: { stringValue: 'platform_role_granted' },
    actorUid: { stringValue: 'firebase-cli-authorized-admin' },
    targetUid: { stringValue: expectedUid },
    role: { stringValue: 'superadmin' },
    status: { stringValue: 'active' },
    reason: { stringValue: 'Acceso solicitado expresamente por el responsable del proyecto.' },
    previousRole: { stringValue: textField(before, 'role') ?? 'none' },
    previousStatus: { stringValue: textField(before, 'status') ?? 'none' },
  };
  // Un solo commit: rol y auditoría; las membresías únicamente se verifican.
  await db.post(`/projects/${project}/databases/(default)/documents:commit`, {
    writes: [
      ...[member, index].map((document) => ({ verify: document.name, currentDocument: { updateTime: document.updateTime } })),
      roleWrite,
      {
        update: { name: root + auditPath, fields: auditFields },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
      },
    ],
  });
  const [after, memberAfter, indexAfter, audit] = await Promise.all([read(rolePath), read(memberPath), read(indexPath), read(auditPath)]);
  if (textField(after, 'role') !== 'superadmin' || textField(after, 'status') !== 'active' || memberAfter.updateTime !== member.updateTime || indexAfter.updateTime !== index.updateTime || textField(audit, 'targetUid') !== expectedUid)
    throw Error('La verificación posterior requiere revisión; no repitas la asignación sin consultar su estado.');
  console.log('Verificado: superadmin activo, auditoría guardada y ambas membresías de El Puma intactas.');
}
