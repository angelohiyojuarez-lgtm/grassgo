import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../server.js';
let server, base;
before(async () => {
  server = createApiServer({
    db: {},
    origins: ['https://grassgo.web.app'],
    verifyToken: async (token) => {
      if (token !== 'valid') throw Error('invalid');
      return { uid: 'cliente-real' };
    },
    handlers: {
      example: { run: async (request) => ({ uid: request.auth.uid, data: request.data }) },
      hidden: () => {},
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
test('HTTP: rechaza solicitudes sin sesión y tokens inválidos', async () => {
  for (const headers of [{}, { Authorization: 'Bearer fake' }]) {
    const response = await fetch(base + '/api/example', { method: 'POST', headers });
    assert.equal(response.status, 401);
  }
});
test('HTTP: la identidad viene del token, nunca de los campos del cliente', async () => {
  const response = await fetch(base + '/api/example', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth: { uid: 'superadmin' }, data: { uid: 'inventado' } }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.uid, 'cliente-real');
});
test('HTTP: CORS no permite otro sitio y el preflight permitido no necesita sesión', async () => {
  assert.equal(
    (
      await fetch(base + '/api/example', {
        method: 'POST',
        headers: { Origin: 'https://other.invalid' },
      })
    ).status,
    403,
  );
  const response = await fetch(base + '/api/example', {
    method: 'OPTIONS',
    headers: { Origin: 'https://grassgo.web.app' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://grassgo.web.app');
});
test('HTTP: no expone helpers ni propiedades heredadas del objeto', async () => {
  for (const name of ['hidden', 'toString', 'constructor'])
    assert.equal(
      (
        await fetch(base + '/api/' + name, {
          method: 'POST',
          headers: { Authorization: 'Bearer valid' },
          body: '{}',
        })
      ).status,
      404,
    );
});
test('HTTP: JSON inválido no se procesa y health no filtra configuración', async () => {
  assert.equal(
    (
      await fetch(base + '/api/example', {
        method: 'POST',
        headers: { Authorization: 'Bearer valid' },
        body: '{',
      })
    ).status,
    400,
  );
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true });
});
