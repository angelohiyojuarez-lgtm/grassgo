import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { makeBookingApi } from './booking-api.js';
import { makeBusinessApi } from './business-api.js';
import { makeRatingsApi } from './ratings-api.js';
import { makeOperationsApi } from './operations-api.js';
import { firestoreMedia } from './private-media.js';

if (!getApps().length)
  initializeApp(
    process.env.FUNCTIONS_EMULATOR === 'true'
      ? { projectId: 'demo-grassgo', storageBucket: 'demo-grassgo.firebasestorage.app' }
      : undefined,
  );
const db = getFirestore();
const media = process.env.MEDIA_DRIVER === 'firestore' ? firestoreMedia(db) : getStorage();
const api = makeBookingApi(db, { allowDemo: process.env.FUNCTIONS_EMULATOR === 'true' });
const operations = makeOperationsApi(db);
const ratings = makeRatingsApi(db);
export async function verifyBusinessImage(path) {
  const file = media.bucket().file(path);
  try {
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) <= 0 || Number(metadata.size) > 5 * 1024 * 1024) throw Error('size');
    const [bytes] = await file.download();
    const valid =
      (metadata.contentType === 'image/png' &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (metadata.contentType === 'image/jpeg' &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255) ||
      (metadata.contentType === 'image/webp' &&
        bytes.subarray(0, 4).toString() === 'RIFF' &&
        bytes.subarray(8, 12).toString() === 'WEBP');
    if (!valid) throw Error('format');
  } catch {
    throw new HttpsError(
      'failed-precondition',
      'Una foto o QR no se pudo verificar. Usa JPG, PNG o WebP de hasta 5 MB.',
    );
  }
}
const business = makeBusinessApi(db, {
  allowDemo: process.env.FUNCTIONS_EMULATOR === 'true',
  verifyAsset: verifyBusinessImage,
  resolveAdmin: async (email) => {
    try {
      const user = await getAuth().getUserByEmail(email);
      return { uid: user.uid, disabled: user.disabled, emailVerified: user.emailVerified };
    } catch (error) {
      if (error.code === 'auth/user-not-found') return null;
      throw error;
    }
  },
});
const callable = (handler) =>
  onCall(
    { region: 'us-central1', maxInstances: 5, concurrency: 10, timeoutSeconds: 120 },
    (request) => handler(request.auth?.uid, request.data || {}),
  );
export const getAvailability = callable(api.getAvailability);
export const createReservation = callable(api.createReservation);
export const myReservations = callable(api.myReservations);
export const rateEstablishment = callable(ratings.rateEstablishment);
export const adminOverview = callable(api.adminOverview);
export const recordSession = callable(operations.recordSession);
export const setCourtMaintenance = callable(operations.setCourtMaintenance);
export const getAdminSettings = callable(operations.getAdminSettings);
export const saveAdminSettings = callable(operations.saveAdminSettings);
export const reviewPayment = callable(api.reviewPayment);
export const platformOverview = callable(api.platformOverview);
export const createEstablishment = callable(api.createEstablishment);
export const platformActivity = callable(api.platformActivity);
export const getBusinessConfiguration = callable(business.getBusinessConfiguration);
export const saveBusinessConfiguration = callable(business.saveBusinessConfiguration);
export const publishBusiness = callable(business.publishBusiness);
export const listPublishedBusinesses = callable(business.listPublishedBusinesses);
export const setEstablishmentStatus = callable(api.setEstablishmentStatus);
export const submitPaymentProof = callable(async (uid, input) => {
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar.');
  if (typeof input.reservationId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(input.reservationId))
    throw new HttpsError('invalid-argument', 'Solicitud inválida.');
  const reservation = await db.doc(`reservations/${input.reservationId}`).get();
  if (reservation.data()?.clientUid !== uid)
    throw new HttpsError('permission-denied', 'Solicitud ajena.');
  const file = media.bucket().file(`proofs/${uid}/${input.reservationId}/receipt`);
  let metadata, bytes;
  try {
    [metadata] = await file.getMetadata();
    if (Number(metadata.size) <= 0 || Number(metadata.size) > 5 * 1024 * 1024) throw Error('size');
    [bytes] = await file.download();
  } catch {
    throw new HttpsError(
      'failed-precondition',
      'No encontramos un comprobante válido de hasta 5 MB.',
    );
  }
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!(
    (jpeg && metadata.contentType === 'image/jpeg') ||
    (png && metadata.contentType === 'image/png') ||
    (webp && metadata.contentType === 'image/webp')
  ))
    throw new HttpsError(
      'invalid-argument',
      'El comprobante debe ser una imagen JPG, PNG o WebP válida.',
    );
  return api.markProof(uid, input.reservationId, metadata);
});
