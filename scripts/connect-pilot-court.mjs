// Conecta la cancha existente del catálogo; nunca inventa tarifas ni activa reservas.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some((arg) => arg !== '--apply'))
  throw Error('Usa --apply o ninguna opción.');
const require = createRequire(import.meta.url);
const { getGlobalDefaultAccount, setActiveAccount } = require('firebase-tools/lib/auth');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { Client } = require('firebase-tools/lib/apiv2');
const options = { project: 'grassgoo', nonInteractive: true };
setActiveAccount(options, getGlobalDefaultAccount());
await requireAuth(options);
const client = new Client({
  urlPrefix: 'https://firestore.googleapis.com',
  apiVersion: 'v1',
  auth: true,
});
const root = 'projects/grassgoo/databases/(default)/documents/';
const decode = (value) =>
  value?.mapValue
    ? Object.fromEntries(
        Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]),
      )
    : value?.arrayValue
      ? (value.arrayValue.values || []).map(decode)
      : value?.integerValue !== undefined
        ? Number(value.integerValue)
        : value?.booleanValue !== undefined
          ? value.booleanValue
          : value?.nullValue !== undefined
            ? null
            : value?.timestampValue || value?.stringValue;
const encode = (value) =>
  value === null
    ? { nullValue: null }
    : Array.isArray(value)
      ? { arrayValue: { values: value.map(encode) } }
      : typeof value === 'object'
        ? {
            mapValue: {
              fields: Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, encode(item)]),
              ),
            },
          }
        : typeof value === 'boolean'
          ? { booleanValue: value }
          : typeof value === 'number'
            ? { integerValue: String(value) }
            : { stringValue: value };
async function read(path, optional = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await client.get('/' + root + path)).body;
    } catch (error) {
      if (optional && error.status === 404) return null;
      if (attempt === 2 || ![429,500,502,503,504].includes(error.status)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw Error('No se pudo consultar la ficha del piloto.');
}
const venue = await read('establishments/el-puma');
const parent = await read('catalog/el-puma');
const schedule = await read('establishments/el-puma/settings/schedule');
const data = (document) => decode({ mapValue: { fields: document.fields } });
const local = data(venue),
  catalog = data(parent),
  hours = data(schedule);
if (
  local.bookingEngine !== 'direct' ||
  !['approved', 'published'].includes(local.status) ||
  catalog.status !== 'published' ||
  local.name !== catalog.name ||
  !local.managedAdminUid
)
  throw Error('El local no coincide con el piloto autorizado.');
const member = await read('establishments/el-puma/members/' + local.managedAdminUid);
if (data(member).role !== 'admin' || data(member).status !== 'active')
  throw Error('Falta administrador activo.');
if (
  hours.establishmentId !== 'el-puma' ||
  hours.revision !== catalog.scheduleRevision ||
  hours.openHour !== catalog.openHour ||
  hours.closeHour !== catalog.closeHour ||
  JSON.stringify(hours.days) !== JSON.stringify(catalog.days)
)
  throw Error('Recarga el horario: proyecciones distintas.');
const entries = (catalog.courts || []).filter((court) => court.id === 'principal');
if (entries.length !== 1) throw Error('La ficha no identifica una cancha principal única.');
const existing = entries[0];
if (
  ![existing.dayPriceCents, existing.nightPriceCents].every(
    (price) => Number.isInteger(price) && price >= 1000 && price <= 1000000,
  ) ||
  !Number.isInteger(existing.nightStartsAt) ||
  existing.nightStartsAt < 0 ||
  existing.nightStartsAt > 23
)
  throw Error('Las tarifas existentes requieren revisión del dueño.');
const privatePath = 'establishments/el-puma/courts/principal',
  publicPath = 'catalog/el-puma/courts/principal';
const privateCourt = await read(privatePath, true),
  publicCourt = await read(publicPath, true);
if (privateCourt || publicCourt) {
  console.log(
    JSON.stringify({
      applied: false,
      privateExists: !!privateCourt,
      publicExists: !!publicCourt,
      message: 'No se sobrescribieron canchas existentes.',
    }),
  );
  process.exitCode = privateCourt && publicCourt ? 0 : 1;
} else {
  const court = {
    name: existing.name,
    sport: existing.sport,
    surface: existing.surface || '',
    images: existing.images || [],
    dayPriceCents: existing.dayPriceCents,
    nightPriceCents: existing.nightPriceCents,
    nightStartsAt: existing.nightStartsAt,
    status: 'active',
    maintenance: false,
    runtime: null,
    openHour: hours.openHour,
    closeHour: hours.closeHour,
    openDays: hours.days,
  };
  console.log(
    JSON.stringify({
      apply,
      court,
      bookingEnabled: local.bookingPolicy?.enabled === true,
      message: 'Se copian solo datos ya publicados. La habilitación de reservas se conserva.',
    }),
  );
  if (apply) {
    await mkdir(new URL('../.firebase/', import.meta.url), { recursive: true });
    await writeFile(
      new URL('../.firebase/connect-pilot-court.before.json', import.meta.url),
      JSON.stringify({ venue, parent, schedule, privateCourt, publicCourt }, null, 2),
    );
    const fields = encode(court).mapValue.fields;
    const migration = {
      establishmentId: 'el-puma',
      courtId: 'principal',
      source: parent.name,
      scheduleRevision: hours.revision,
      copied: court,
      actor: 'firebase-cli-authorized-migration',
    };
    const writes = [venue, parent, schedule, member].map((document) => ({
      verify: document.name,
      currentDocument: { updateTime: document.updateTime },
    }));
    for (const path of [privatePath, publicPath])
      writes.push({ update: { name: root + path, fields }, currentDocument: { exists: false } });
    writes.push({
      update: {
        name: root + 'establishments/el-puma/migrations/connect-existing-principal',
        fields: encode(migration).mapValue.fields,
      },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
    });
    await client.post('/projects/grassgoo/databases/(default)/documents:commit', {
      writes,
    });
    console.log(
      'Cancha principal conectada, con auditoría y sin modificar pagos, horarios guardados ni reservas.',
    );
  }
}
