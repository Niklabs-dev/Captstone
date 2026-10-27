import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';

test(
  'HTTP personal: sesión, rol, identidad no editable, proyección, aislamiento y stream',
  { timeout: 60000 },
  async () => {
    const workerId = '11000000-0000-4000-8000-000000000001';
    const id = '11000000-0000-4000-8000-000000000002';
    const versionId = '11000000-0000-4000-8000-000000000003';
    const version = {
      id: versionId,
      number: 1,
      fileName: 'contrato.pdf',
      mime: 'application/pdf',
      size: 10,
      sha256: 'a'.repeat(64),
      createdAt: '2026-10-26T12:00:00Z',
      uploadedBy: 'Administración',
    };
    const document = {
      id,
      workerId,
      type: 'CONTRATO',
      title: 'Contrato propio',
      retainUntil: null,
      deletionBlocked: false,
      deletionReason: null,
      latestVersion: version,
    };
    let mode = '';
    let calls = 0;
    const backend = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const role =
        req.headers.authorization === 'Bearer worker-token'
          ? 'TRABAJADOR'
          : req.headers.authorization === 'Bearer supervisor-token'
            ? 'SUPERVISOR'
            : req.headers.authorization === 'Bearer admin-token'
              ? 'ADMINISTRADOR'
              : null;
      if (!role) {
        res.writeHead(401);
        res.end('{}');
        return;
      }
      if (req.url === '/auth/me') {
        res.end(
          JSON.stringify({
            id: workerId,
            email: 'own@example.test',
            role,
            storeId: id,
          }),
        );
        return;
      }
      calls++;
      assert.equal(req.method, 'GET');
      if (mode === 'down') {
        res.writeHead(500);
        res.end('{"message":"SQL private"}');
        return;
      }
      if (req.url === '/documents') {
        res.end(
          JSON.stringify({
            items: [
              {
                ...document,
                workerId: mode === 'foreign' ? id : workerId,
                type: mode === 'payroll' ? 'LIQUIDACION' : 'CONTRATO',
                storagePath: 'private',
              },
            ],
            policy: {
              maxBytes: 26214400,
              allowedMimes: ['application/pdf'],
              canUpload: false,
            },
            token: 'private',
          }),
        );
        return;
      }
      if (req.url === `/documents/${id}/versions`) {
        res.end(
          JSON.stringify({
            documentId: id,
            workerId: mode === 'foreign' ? id : workerId,
            versions: [version],
            private: true,
          }),
        );
        return;
      }
      if (req.url === `/documents/versions/${versionId}/download`) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', '10');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="propio.pdf"',
        );
        res.setHeader('X-Document-Integrity', 'VALID');
        res.end('%PDF-test!');
        return;
      }
      res.writeHead(403);
      res.end('{"message":"private foreign filename"}');
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const address = backend.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://localhost:3134';
    const frontend = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'start', '--port', '3134'],
      {
        env: {
          ...process.env,
          BACKEND_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
        },
        stdio: 'pipe',
      },
    );
    let logs = '';
    frontend.stdout.on('data', (chunk: Buffer) => {
      logs += chunk.toString();
    });
    frontend.stderr.on('data', (chunk: Buffer) => {
      logs += chunk.toString();
    });
    async function send(
      path = '',
      token = 'worker-token',
      method = 'GET',
    ): Promise<Response> {
      return fetch(origin + '/api/my-documents' + path, {
        method,
        redirect: 'manual',
        headers: { Cookie: `mf_access=${token}`, Origin: origin },
      });
    }
    try {
      const deadline = Date.now() + 30000;
      let ready = false;
      while (Date.now() < deadline && frontend.exitCode === null) {
        try {
          ready = (await send()).status === 200;
          if (ready) break;
        } catch {
          /* Espera del servidor. */
        }
        await setTimeout(100);
      }
      assert.ok(ready, logs);
      assert.equal((await send('', '')).status, 401);
      assert.equal((await send('', 'invalid-token')).status, 401);
      const before = calls;
      assert.equal((await send('', 'admin-token')).status, 403);
      for (const query of [
        '?workerId=' + id,
        '?storeId=' + id,
        '?documentTypeCode=CONTRATO',
      ])
        assert.equal((await send(query)).status, 400);
      assert.equal((await send('/bad/versions')).status, 404);
      for (const method of ['POST', 'PATCH', 'DELETE'])
        assert.equal((await send('', 'worker-token', method)).status, 405);
      assert.equal(calls, before);
      for (const token of ['worker-token', 'supervisor-token']) {
        const response = await send('', token);
        assert.equal(response.status, 200);
        assert.ok(response.headers.get('cache-control')?.includes('no-store'));
        const text = await response.text();
        assert.ok(text.includes('Contrato propio'));
        assert.ok(
          !text.includes('private') &&
            !text.includes('storagePath') &&
            !text.includes('worker-token'),
        );
        const page = await fetch(origin + '/portal/documentos', {
          headers: { Cookie: `mf_access=${token}` },
          redirect: 'manual',
        });
        assert.equal(page.status, 200);
      }
      assert.equal((await send(`/${id}/versions`)).status, 200);
      const forbidden = await send(`/versions/${workerId}/download`);
      assert.equal(forbidden.status, 403);
      assert.ok(!(await forbidden.text()).includes('private'));
      const download = await send(`/versions/${versionId}/download`);
      assert.equal(download.status, 200);
      assert.equal(download.headers.get('content-type'), 'application/pdf');
      assert.equal(download.headers.get('content-length'), '10');
      assert.equal(download.headers.get('x-document-integrity'), 'VALID');
      assert.ok(
        download.headers.get('content-disposition')?.includes('propio.pdf'),
      );
      assert.equal(await download.text(), '%PDF-test!');
      for (const invalid of ['foreign', 'payroll']) {
        mode = invalid;
        const response = await send();
        assert.equal(response.status, 502);
        assert.ok(!(await response.text()).includes('Contrato propio'));
      }
      mode = 'foreign';
      assert.equal((await send(`/${id}/versions`)).status, 502);
      mode = 'down';
      const down = await send();
      assert.equal(down.status, 502);
      assert.ok(!(await down.text()).includes('SQL'));
    } finally {
      if (frontend.exitCode === null) {
        frontend.kill();
        await once(frontend, 'exit');
      }
      backend.closeAllConnections();
      await new Promise<undefined>((resolve) =>
        backend.close(() => resolve(undefined)),
      );
    }
  },
);
