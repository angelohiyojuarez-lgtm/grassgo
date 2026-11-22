// Proyección de adelantos YA verificados. No crea cobros ni modifica reservas.
// Por defecto solo consulta. --apply únicamente añade ledgers ausentes.
import { createRequire } from 'node:module';
import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');
const project = 'grassgoo';
const database = `projects/${project}/databases/(default)`;
const documents = `${database}/documents`;
const requestPrefix = `${documents}/direct_requests/`;
const arguments_ = process.argv.slice(2);
const apply = arguments_.length === 1 && arguments_[0] === '--apply';
const mode = apply ? 'apply' : 'dry-run';
const counts = {
  scanned: 0,
  eligible: 0,
  missing: 0,
  existingMatches: 0,
  existingConflicts: 0,
  invalidSources: 0,
  unsupportedVenues: 0,
  created: 0,
  commitRaces: 0,
  resolvedRaces: 0,
  changedDuringApply: 0,
  unresolvedRaces: 0,
  apiFailures: 0,
  invalidArguments: 0,
};
const printCounts = () => console.log(JSON.stringify({ project, mode, counts }));
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(value);
const text = (value, min, max) =>
  typeof value === 'string' && value.length >= min && value.length <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const stringField = (document, key) => document?.fields?.[key]?.stringValue;
const integerField = (document, key) => {
  const value = document?.fields?.[key]?.integerValue;
  if (typeof value !== 'string' || !/^-?[0-9]+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};
const nullField = (document, key) => {
  const value = document?.fields?.[key];
  return (
    value && Object.hasOwn(value, 'nullValue') && [null, 'NULL_VALUE'].includes(value.nullValue)
  );
};
const timestampKey = (value) => {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]{1,9}))?Z$/.exec(value);
  if (!match) return null;
  const instant = Date.parse(match[1] + 'Z');
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 19) !== match[1])
    return null;
  // Conserva los nanosegundos y permite formatos equivalentes de Firestore.
  return `${match[1]}.${(match[2] || '').padEnd(9, '0')}Z`;
};
const date = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
};
const fieldsOf = (source) => {
  if (!source?.name?.startsWith(requestPrefix) || !timestampKey(source.updateTime)) return null;
  const reservationId = source.name.slice(requestPrefix.length);
  const establishmentId = stringField(source, 'establishmentId');
  const courtId = stringField(source, 'courtId');
  const courtName = stringField(source, 'courtName');
  const serviceDate = stringField(source, 'date');
  const hour = integerField(source, 'hour');
  const total = integerField(source, 'totalCents');
  const advance = integerField(source, 'verifiedAdvanceCents');
  const reviewedAt = source.fields?.reviewedAt?.timestampValue;
  const reviewedBy = stringField(source, 'reviewedBy');
  if (
    stringField(source, 'paymentStatus') !== 'verified' ||
    stringField(source, 'status') !== 'confirmed' ||
    !id(reservationId) ||
    !id(establishmentId) ||
    !id(courtId) ||
    !text(courtName, 1, 120) ||
    !date(serviceDate) ||
    !integer(hour, 0, 23) ||
    !integer(total, 1000, 100_000_000) ||
    !integer(advance, 1, total) ||
    advance !== integerField(source, 'advanceCents') ||
    !timestampKey(reviewedAt) ||
    !text(reviewedBy, 1, 128)
  )
    return null;
  return {
    establishmentId,
    targetPath: `establishments/${establishmentId}/court_income/${reservationId}`,
    fields: {
      reservationId: { stringValue: reservationId },
      courtId: { stringValue: courtId },
      courtName: { stringValue: courtName },
      date: { stringValue: serviceDate },
      hour: { integerValue: String(hour) },
      totalCents: { integerValue: String(total) },
      advanceCents: { integerValue: String(advance) },
      advanceAt: { timestampValue: reviewedAt },
      advanceBy: { stringValue: reviewedBy },
      balanceCents: { integerValue: '0' },
      balanceAt: { nullValue: null },
      balanceBy: { nullValue: null },
      balanceMethod: { nullValue: null },
    },
  };
};
function matchesExisting(existing, expected) {
  const keys = Object.keys(existing.fields || {});
  const canonical = Object.keys(expected);
  if (keys.length !== canonical.length || canonical.some((key) => !keys.includes(key)))
    return false;
  const expectedDocument = { fields: expected };
  for (const key of ['reservationId', 'courtId', 'courtName', 'date', 'advanceBy'])
    if (stringField(existing, key) !== stringField(expectedDocument, key)) return false;
  for (const key of ['hour', 'totalCents', 'advanceCents'])
    if (integerField(existing, key) !== integerField(expectedDocument, key)) return false;
  if (
    timestampKey(existing.fields.advanceAt?.timestampValue) !==
    timestampKey(expected.advanceAt.timestampValue)
  )
    return false;
  const balance = integerField(existing, 'balanceCents');
  if (balance === 0)
    return ['balanceAt', 'balanceBy', 'balanceMethod'].every((key) => nullField(existing, key));
  const remaining =
    integerField(expectedDocument, 'totalCents') - integerField(expectedDocument, 'advanceCents');
  // Un saldo recibido legítimamente después de crear el ledger se conserva.
  return (
    remaining > 0 &&
    balance === remaining &&
    !!timestampKey(existing.fields.balanceAt?.timestampValue) &&
    text(stringField(existing, 'balanceBy'), 1, 128) &&
    ['cash', 'yape', 'plin'].includes(stringField(existing, 'balanceMethod'))
  );
}

async function main() {
  if (arguments_.length > 1 || (arguments_.length === 1 && arguments_[0] !== '--apply')) {
    counts.invalidArguments++;
    process.exitCode = 1;
    return;
  }
  const require = createRequire(import.meta.url);
  const { getGlobalDefaultAccount, setActiveAccount } = require('firebase-tools/lib/auth');
  const { requireAuth } = require('firebase-tools/lib/requireAuth');
  const { Client } = require('firebase-tools/lib/apiv2');
  const options = { project, nonInteractive: true };
  setActiveAccount(options, getGlobalDefaultAccount());
  await requireAuth(options);
  const db = new Client({
    urlPrefix: 'https://firestore.googleapis.com',
    apiVersion: 'v1',
    auth: true,
  });
  const retry = async (operation) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (
          attempt === 3 ||
          !(
            [429, 500, 502, 503, 504].includes(error.status) ||
            ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'ENOTFOUND'].includes(error.code)
          )
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
  };
  const read = async (path) => {
    try {
      return (await retry(() => db.get(`/${documents}/${path}`))).body;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  };
  const venues = new Map();
  const venueFor = async (establishmentId, refresh = false) => {
    if (!refresh && venues.has(establishmentId)) return venues.get(establishmentId);
    const venue = await read(`establishments/${establishmentId}`);
    const value =
      venue && stringField(venue, 'bookingEngine') === 'direct' && timestampKey(venue.updateTime)
        ? venue
        : null;
    venues.set(establishmentId, value);
    return value;
  };
  const create = async (initialSource, initialCandidate, initialVenue) => {
    let source = initialSource,
      candidate = initialCandidate,
      venue = initialVenue;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await retry(() =>
          db.post(`/${documents}:commit`, {
            writes: [
              { verify: source.name, currentDocument: { updateTime: source.updateTime } },
              { verify: venue.name, currentDocument: { updateTime: venue.updateTime } },
              {
                update: { name: `${documents}/${candidate.targetPath}`, fields: candidate.fields },
                currentDocument: { exists: false },
              },
            ],
          }),
        );
        counts.created++;
        return;
      } catch (error) {
        if (![400, 409, 412].includes(error.status)) throw error;
        if (attempt === 0) counts.commitRaces++;
        source = await read(initialSource.name.slice(documents.length + 1));
        candidate = fieldsOf(source);
        if (!candidate) {
          counts.changedDuringApply++;
          return;
        }
        venue = await venueFor(candidate.establishmentId, true);
        if (!venue) {
          counts.changedDuringApply++;
          return;
        }
        const current = await read(candidate.targetPath);
        if (current) {
          if (matchesExisting(current, candidate.fields)) {
            counts.existingMatches++;
            counts.resolvedRaces++;
          } else counts.existingConflicts++;
          return;
        }
      }
    }
    counts.unresolvedRaces++;
  };

  let cursor;
  do {
    const response = await retry(() =>
      db.post(`/${documents}:runQuery`, {
        structuredQuery: {
          from: [{ collectionId: 'direct_requests' }],
          select: {
            fields: [
              'establishmentId',
              'courtId',
              'courtName',
              'date',
              'hour',
              'totalCents',
              'advanceCents',
              'paymentStatus',
              'status',
              'verifiedAdvanceCents',
              'reviewedAt',
              'reviewedBy',
            ].map((fieldPath) => ({ fieldPath })),
          },
          where: {
            fieldFilter: {
              field: { fieldPath: 'paymentStatus' },
              op: 'EQUAL',
              value: { stringValue: 'verified' },
            },
          },
          orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
          ...(cursor ? { startAt: { values: [{ referenceValue: cursor }], before: false } } : {}),
          limit: 250,
        },
      }),
    );
    if (!Array.isArray(response.body)) throw Error('invalid-query-response');
    const rows = response.body.filter((row) => row.document).map((row) => row.document);
    for (const source of rows) {
      counts.scanned++;
      const candidate = fieldsOf(source);
      if (!candidate) {
        counts.invalidSources++;
        continue;
      }
      const venue = await venueFor(candidate.establishmentId);
      if (!venue) {
        counts.unsupportedVenues++;
        continue;
      }
      counts.eligible++;
      const current = await read(candidate.targetPath);
      if (current) {
        if (matchesExisting(current, candidate.fields)) counts.existingMatches++;
        else counts.existingConflicts++;
        continue;
      }
      counts.missing++;
      if (apply) await create(source, candidate, venue);
    }
    cursor = rows.length === 250 ? rows.at(-1).name : undefined;
  } while (cursor);
  if (counts.existingConflicts || counts.unresolvedRaces) process.exitCode = 1;
}

try {
  await main();
} catch {
  // Ningún error remoto imprime documentos, cabeceras, cuentas ni credenciales.
  counts.apiFailures++;
  process.exitCode = 1;
} finally {
  printCounts();
}
