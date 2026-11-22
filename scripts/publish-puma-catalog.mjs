// Alta explícita y única del catálogo DEMO remoto. No migra usuarios ni reservas.
// Usa la sesión de Firebase CLI en memoria; no guarda ni imprime credenciales.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getGlobalDefaultAccount, setActiveAccount } = require('firebase-tools/lib/auth');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { Client } = require('firebase-tools/lib/apiv2');
if (process.argv[2] !== '--publish-demo-grassgoo')
  throw Error('Usa --publish-demo-grassgoo para publicar únicamente el catálogo de prueba.');
const options = { project: 'grassgoo', nonInteractive: true };
const account = getGlobalDefaultAccount();
if (!account) throw Error('Inicia sesión con Firebase CLI.');
setActiveAccount(options, account);
await requireAuth(options);
const client = new Client({
  urlPrefix: 'https://firestore.googleapis.com',
  apiVersion: 'v1',
  auth: true,
});
const data = {
  status: 'published',
  demo: true,
  name: 'Grass El Puma',
  location: 'Salinas, Andahuaylas',
  description: 'Local de prueba. Las reservas online están en preparación.',
  reference: '',
  district: '',
  phone: '',
  images: [],
  openHour: null,
  closeHour: null,
  days: [],
  advanceCents: 1000,
  rating: null,
  courts: [
    {
      id: 'principal',
      name: 'Cancha principal',
      sport: 'Fútbol',
      surface: '',
      images: [],
      dayPriceCents: 3000,
      nightPriceCents: 4000,
      nightStartsAt: 18,
    },
  ],
};
function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return {
    mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) },
  };
}
const name = 'projects/grassgoo/databases/(default)/documents/catalog/el-puma';
await client.post('/projects/grassgoo/databases/(default)/documents:commit', {
  writes: [
    { update: { name, fields: encode(data).mapValue.fields }, currentDocument: { exists: false } },
  ],
});
console.log(
  'Catálogo DEMO de Grass El Puma creado. No se modificaron permisos, reservas ni otros locales.',
);
