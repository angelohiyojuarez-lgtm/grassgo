import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { firestoreMedia, authorizeMedia } from './private-media.js';

export function createApiServer({ handlers, verifyToken, db, origins }) {
  const media = firestoreMedia(db);
  const limits = new Map();
  const errors = {
    'invalid-argument': 400,
    unauthenticated: 401,
    'permission-denied': 403,
    'not-found': 404,
    'already-exists': 409,
    'failed-precondition': 412,
    'resource-exhausted': 429,
  };
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (origin && !origins.includes(origin))
      return json(403, { error: { code: 'permission-denied', message: 'Origen no permitido.' } });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health' && req.method === 'GET') return json(200, { ok: true });
    try {
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      if (!bearer) throw Object.assign(new Error('Inicia sesión.'), { code: 'unauthenticated' });
      let user;
      try {
        user = await verifyToken(bearer[1]);
      } catch {
        throw Object.assign(new Error('Tu sesión venció. Vuelve a ingresar.'), {
          code: 'unauthenticated',
        });
      }
      if (!user?.uid)
        throw Object.assign(new Error('Sesión inválida.'), { code: 'unauthenticated' });
      const minute = Math.floor(Date.now() / 60000),
        key = `${minute}:${user.uid}`;
      if (limits.size > 10000)
        for (const k of limits.keys()) if (!k.startsWith(`${minute}:`)) limits.delete(k);
      limits.set(key, (limits.get(key) || 0) + 1);
      if (limits.get(key) > 120)
        throw Object.assign(new Error('Espera un minuto para volver a intentar.'), {
          code: 'resource-exhausted',
        });
      const read = async (max) => {
        const parts = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > max)
            throw Object.assign(new Error('Archivo o solicitud demasiado grande.'), {
              code: 'invalid-argument',
            });
          parts.push(chunk);
        }
        return Buffer.concat(parts);
      };
      if (url.pathname === '/media' && ['GET', 'PUT'].includes(req.method)) {
        const path = url.searchParams.get('path') || '';
        await authorizeMedia(db, user.uid, path, req.method === 'PUT');
        if (req.method === 'PUT')
          return json(
            200,
            await media.put(path, await read(5 * 1024 * 1024), req.headers['content-type']),
          );
        const file = media.bucket().file(path),
          [meta] = await file.getMetadata(),
          [bytes] = await file.download();
        res.writeHead(200, { 'Content-Type': meta.contentType });
        return res.end(bytes);
      }
      const match = /^\/api\/([A-Za-z]+)$/.exec(url.pathname);
      const handler = match && Object.hasOwn(handlers, match[1]) && handlers[match[1]];
      if (req.method !== 'POST' || typeof handler?.run !== 'function')
        return json(404, { error: { code: 'not-found', message: 'Operación inexistente.' } });
      let input;
      try {
        input = JSON.parse((await read(256 * 1024)).toString());
      } catch (error) {
        if (error.code) throw error;
        throw Object.assign(new Error('Solicitud inválida.'), { code: 'invalid-argument' });
      }
      const result = await handler.run({
        auth: { uid: user.uid, token: user },
        data: input.data ?? {},
      });
      return json(200, { result });
    } catch (error) {
      const code = Object.hasOwn(errors, error.code) ? error.code : 'internal';
      return json(errors[code] || 500, {
        error: {
          code: `functions/${code}`,
          message: code === 'internal' ? 'No pudimos completar la operación.' : error.message,
        },
      });
    }
  });
}

async function main() {
  process.env.MEDIA_DRIVER = 'firestore';
  const local = process.env.FUNCTIONS_EMULATOR === 'true';
  if (!local && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_JSON en el servidor.');
  if (!getApps().length)
    initializeApp(
      local
        ? { projectId: 'demo-grassgo' }
        : {
            credential: cert(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)),
            projectId: 'grassgoo',
          },
    );
  const handlers = await import('./index.js');
  const server = createApiServer({
    handlers,
    db: getFirestore(),
    verifyToken: (token) => getAuth().verifyIdToken(token, true),
    origins: (
      process.env.ALLOWED_ORIGINS || 'https://grassgo.web.app,https://grassgo.firebaseapp.com'
    ).split(','),
  });
  server.requestTimeout = 120000;
  server.listen(Number(process.env.PORT || 3001), '0.0.0.0', () =>
    console.log('GrassGo API listo.'),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error('No se pudo iniciar GrassGo API. Revisa la configuración del servidor.');
    process.exitCode = 1;
  });
