import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { isRecord } from './auth';
import {
  DAILY_STORE_INACTIVE_MESSAGE,
  dailyOperationErrorMessage,
} from './daily-operations';

test(
  'HTTP operación diaria: permisos, origen, multipart, participantes, elegibles, corrección, reintentos, conflicto consultable, voucher y errores privados',
  { timeout: 120000 },
  async () => {
    const storeId = '61000000-0000-4000-8000-000000000311';
    const otherStoreId = '61000000-0000-4000-8000-000000000312';
    const responsibleId = '63000000-0000-4000-8000-000000000311';
    const operationId = '62000000-0000-4000-8000-000000000311';
    const participantId = '65000000-0000-4000-8000-000000000311';
    const secondParticipantId = '65000000-0000-4000-8000-000000000312';
    const participants = [
      { id: participantId, name: 'Benito Trabajador' },
      { id: secondParticipantId, name: 'Ana Trabajadora' },
    ];
    const operation = {
      id: operationId,
      store: { id: storeId, name: 'Centro' },
      businessDate: '2026-10-26',
      cardTipAmount: 12500,
      cashTipAmount: 8000,
      tipFundAmount: 20500,
      cashDifference: -1500,
      differenceReason: 'Vale de caja firmado',
      voucher: {
        id: '64000000-0000-4000-8000-000000000311',
        fileName: 'voucher-comedor.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
        sha256Hash: 'a'.repeat(64),
        createdAt: '2026-10-26T12:05:00Z',
      },
      participants,
      responsible: { id: responsibleId, name: 'Camila Supervisora' },
      createdAt: '2026-10-26T12:00:00Z',
      updatedAt: '2026-10-26T12:00:00Z',
    };
    let mode = '';
    const calls: { path: string; method: string; raw: string }[] = [];
    const backend = createServer(async (request, response) => {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token || token === 'invalid') {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end('{}');
        return;
      }
      if (request.url === '/auth/me') {
        if (token === 'down') {
          response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end('{}');
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            id: responsibleId,
            email: 'operacion@example.test',
            role:
              token === 'admin'
                ? 'ADMINISTRADOR'
                : token === 'worker'
                  ? 'TRABAJADOR'
                  : token === 'accountant'
                    ? 'CONTADOR'
                    : 'SUPERVISOR',
            storeId: token === 'nostore' ? null : storeId,
          }),
        );
        return;
      }
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      if (request.method === 'POST' || request.method === 'PATCH')
        calls.push({ path: request.url ?? '', method: request.method, raw });
      if (mode === 'inactive' || mode === 'bad-request') {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            message:
              mode === 'inactive'
                ? 'El local indicado no existe o está inactivo'
                : 'SQL passwordHash /private/secret',
          }),
        );
        return;
      }
      if (mode === 'conflict' || mode === 'conflict-without-id') {
        response.writeHead(409, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            message: 'SQL passwordHash /private/secret',
            ...(mode === 'conflict'
              ? { existingOperationId: operationId }
              : {}),
          }),
        );
        return;
      }
      if (mode === 'private-error') {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ message: 'SQL passwordHash /private/secret' }),
        );
        return;
      }
      if (
        request.url?.startsWith('/daily-operations/') &&
        request.url.endsWith('/voucher')
      ) {
        // El backend acota el local del supervisor: otro local responde 403.
        if (mode === 'foreign-voucher' || mode === 'missing-voucher') {
          response.writeHead(mode === 'foreign-voucher' ? 403 : 404, {
            'Content-Type': 'application/json',
          });
          response.end(JSON.stringify({ message: 'SQL /private/vouchers' }));
          return;
        }
        const body = Buffer.from('voucher-bytes');
        response.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': body.length,
          'Content-Disposition': 'attachment; filename="voucher-comedor.jpg"',
          'X-Voucher-Integrity': 'OK',
        });
        response.end(body);
        return;
      }
      if (mode === 'bad-json') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('not JSON');
        return;
      }
      // Catálogo acotado de trabajadores elegibles (SPRINT-4R-T03).
      if (request.url?.startsWith('/daily-operations/eligible-workers')) {
        if (mode === 'private-workers') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify([
              {
                ...participants[0],
                email: 'privado@example.test',
                phone: '+569',
                passwordHash: 'secret',
              },
            ]),
          );
          return;
        }
        if (mode === 'duplicate-workers') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify([participants[0], participants[0]]));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(participants));
        return;
      }
      function readParts(body: string): {
        submitted: Record<string, string>;
        participantIds: string[];
      } {
        const contentType = String(request.headers['content-type'] ?? '');
        const boundary = /boundary=([^;]+)/
          .exec(contentType)?.[1]
          ?.replace(/^"|"$/g, '');
        const submitted: Record<string, string> = {};
        const participantIds: string[] = [];
        if (boundary)
          for (const part of body.split('--' + boundary)) {
            const match = /name="([^"]+)"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n$/.exec(
              part,
            );
            if (match) {
              // La selección llega como participantIds repetidos (conjunto).
              if (match[1] === 'participantIds') participantIds.push(match[2]);
              else submitted[match[1]] = match[2];
            }
          }
        return { submitted, participantIds };
      }
      const participantNames = new Map(
        participants.map((participant) => [participant.id, participant.name]),
      );
      function toParticipants(ids: string[]): {
        id: string;
        name: string;
      }[] {
        return ids.map((participantId) => ({
          id: participantId,
          name: participantNames.get(participantId) ?? 'Trabajador',
        }));
      }
      if (request.method === 'POST') {
        const { submitted, participantIds } = readParts(raw);
        const cardTip =
          submitted.cardTipAmount !== undefined
            ? Number(submitted.cardTipAmount)
            : operation.cardTipAmount;
        const cashTip =
          submitted.cashTipAmount !== undefined
            ? Number(submitted.cashTipAmount)
            : operation.cashTipAmount;
        const difference =
          submitted.cashDifference !== undefined
            ? Number(submitted.cashDifference)
            : operation.cashDifference;
        const record = {
          ...operation,
          token: 'private',
          cardTipAmount: mode === 'amount' ? 1 : cardTip,
          cashTipAmount: cashTip,
          tipFundAmount: (mode === 'amount' ? 1 : cardTip) + cashTip,
          cashDifference: difference,
          differenceReason:
            'differenceReason' in submitted
              ? submitted.differenceReason || null
              : null,
          participants: toParticipants(participantIds),
          store: {
            ...operation.store,
            id: mode === 'foreign' ? operation.id : storeId,
          },
          responsible: {
            ...operation.responsible,
            id: mode === 'responsible' ? operation.id : responsibleId,
          },
          businessDate:
            mode === 'date'
              ? '2026-10-25'
              : (submitted.businessDate ?? operation.businessDate),
        };
        response.writeHead(mode === 'replay' ? 200 : 201, {
          'Content-Type': 'application/json',
        });
        response.end(JSON.stringify(record));
        return;
      }
      // Corrección parcial de la operación y/o de la selección (SPRINT-4R-T03).
      if (request.method === 'PATCH') {
        if (mode === 'patch-missing') {
          response.writeHead(404, { 'Content-Type': 'application/json' });
          response.end('{}');
          return;
        }
        if (mode === 'patch-conflict') {
          response.writeHead(409, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              message: 'SQL passwordHash /private/secret',
              existingOperationId: operationId,
            }),
          );
          return;
        }
        if (mode === 'patch-foreign') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              ...operation,
              store: { id: operation.id, name: 'Ajeno' },
            }),
          );
          return;
        }
        if (mode === 'patch-lying') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              ...operation,
              cashTipAmount: 1,
              tipFundAmount: 12501,
            }),
          );
          return;
        }
        const { submitted, participantIds } = readParts(raw);
        const patchedCardTip =
          submitted.cardTipAmount !== undefined
            ? Number(submitted.cardTipAmount)
            : operation.cardTipAmount;
        const patchedCashTip =
          submitted.cashTipAmount !== undefined
            ? Number(submitted.cashTipAmount)
            : operation.cashTipAmount;
        const updated = {
          ...operation,
          cardTipAmount: patchedCardTip,
          cashTipAmount: patchedCashTip,
          tipFundAmount: patchedCardTip + patchedCashTip,
          cashDifference:
            submitted.cashDifference !== undefined
              ? Number(submitted.cashDifference)
              : operation.cashDifference,
          differenceReason:
            'differenceReason' in submitted
              ? submitted.differenceReason || null
              : operation.differenceReason,
          participants:
            participantIds.length > 0
              ? toParticipants(participantIds)
              : operation.participants,
          updatedAt: '2026-10-26T12:35:00Z',
        };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(updated));
        return;
      }
      if (mode === 'duplicate') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify([operation, operation]));
        return;
      }
      if (mode === 'foreign-list') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify([
            { ...operation, store: { id: operation.id, name: 'Ajeno' } },
          ]),
        );
        return;
      }
      if (mode === 'empty-list') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('[]');
        return;
      }
      if (request.url?.startsWith('/daily-operations/')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify(
            mode === 'foreign-detail'
              ? { ...operation, store: { id: operation.id, name: 'Ajeno' } }
              : operation,
          ),
        );
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify([operation]));
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const address = backend.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://localhost:3375';
    const frontend = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'start', '--port', '3375'],
      {
        env: {
          ...process.env,
          BACKEND_INTERNAL_URL: 'http://127.0.0.1:' + address.port,
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
    function multipart(
      fields: Record<string, string | string[]>,
      file?: { name: string; filename: string; type: string; data: string },
    ): { body: string; contentType: string } {
      const boundary = '----OperacionDiariaTest';
      let body = '';
      for (const [name, value] of Object.entries(fields))
        for (const item of Array.isArray(value) ? value : [value])
          body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${item}\r\n`;
      if (file)
        body += `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n${file.data}\r\n`;
      body += `--${boundary}--\r\n`;
      return {
        body,
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }
    const validFields = {
      storeId,
      businessDate: '2026-10-26',
      cardTipAmount: '12500',
      cashTipAmount: '8000',
      cashDifference: '-1500',
      differenceReason: 'Vale de caja firmado',
      participantIds: [participantId, secondParticipantId],
    };
    const voucherFile = {
      name: 'voucher',
      filename: 'voucher.jpg',
      type: 'image/jpeg',
      data: 'foto-voucher',
    };
    async function send(
      options: {
        target?: string;
        token?: string;
        method?: string;
        query?: string;
        fields?: Record<string, string | string[]>;
        file?: typeof voucherFile | null;
        origin?: string;
        raw?: string;
        contentType?: string;
      } = {},
    ): Promise<Response> {
      const method = options.method ?? 'GET';
      const part =
        method === 'POST' || method === 'PATCH'
          ? options.raw !== undefined
            ? { body: options.raw }
            : multipart(
                options.fields ?? validFields,
                options.file === null
                  ? undefined
                  : (options.file ?? voucherFile),
              )
          : {};
      return fetch(
        origin +
          (options.target ?? '/api/daily-operations') +
          (options.query ?? ''),
        {
          method,
          headers: {
            ...(options.token === ''
              ? {}
              : { Cookie: 'mf_access=' + (options.token ?? 'supervisor') }),
            ...(method === 'POST' || method === 'PATCH'
              ? {
                  Origin: options.origin ?? origin,
                  'Content-Type':
                    options.contentType ?? multipart(validFields).contentType,
                }
              : {}),
          },
          ...part,
        },
      );
    }
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (frontend.exitCode !== null) throw new Error(logs);
        try {
          if ((await fetch(origin + '/login')).ok) {
            ready = true;
            break;
          }
        } catch {
          /* El servidor sigue iniciando. */
        }
        await setTimeout(200);
      }
      assert.ok(ready, logs);
      for (const token of ['', 'invalid'])
        assert.equal((await send({ token })).status, 401);
      for (const token of ['admin', 'worker', 'accountant', 'nostore']) {
        assert.equal((await send({ token })).status, 403);
        assert.equal((await send({ token, method: 'POST' })).status, 403);
      }
      assert.equal((await send({ token: 'down' })).status, 503);
      assert.equal(calls.length, 0);
      for (const query of [
        '?businessDate=2026-10-26&businessDate=2026-10-25',
        '?businessDate=2026-02-30',
        '?businessDate=',
        '?storeId=' + otherStoreId + '&businessDate=2026-10-26',
        '?businessDate=2026-10-26',
        '',
        '?storeId=' + storeId + '&businessDate=2026-10-26&extra=1',
      ])
        assert.equal((await send({ query })).status, 400);
      assert.equal(
        (
          await send({
            query: '?storeId=' + storeId + '&businessDate=2026-10-26',
            method: 'POST',
          })
        ).status,
        400,
      );
      assert.equal(calls.length, 0);
      let result = await send({
        query: '?storeId=' + storeId + '&businessDate=2026-10-26',
      });
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual(await result.json(), [operation]);
      mode = 'empty-list';
      result = await send({
        query: '?storeId=' + storeId + '&businessDate=2026-10-26',
      });
      assert.deepEqual(await result.json(), []);
      mode = '';
      result = await send({ target: '/api/daily-operations/' + operationId });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), operation);
      assert.equal(
        (await send({ target: '/api/daily-operations/not-a-uuid' })).status,
        404,
      );
      result = await send({
        target: '/api/daily-operations/' + operationId + '/voucher',
      });
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('Content-Type'), 'image/jpeg');
      assert.match(
        result.headers.get('Content-Disposition') ?? '',
        /attachment; filename="voucher-comedor.jpg"/,
      );
      assert.equal(result.headers.get('X-Voucher-Integrity'), 'OK');
      assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
      assert.deepEqual(
        Buffer.from(await result.arrayBuffer()),
        Buffer.from('voucher-bytes'),
      );
      // SPRINT-4A-T11/T23: administrador y contador revisan el voucher por el
      // mismo BFF privado (el backend audita cada lectura); el trabajador
      // sigue sin acceso.
      for (const token of ['admin', 'accountant']) {
        result = await send({
          token,
          target: '/api/daily-operations/' + operationId + '/voucher',
        });
        assert.equal(result.status, 200);
        assert.equal(result.headers.get('Content-Type'), 'image/jpeg');
        assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
        assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
        assert.deepEqual(
          Buffer.from(await result.arrayBuffer()),
          Buffer.from('voucher-bytes'),
        );
      }
      assert.equal(
        (
          await send({
            token: 'worker',
            target: '/api/daily-operations/' + operationId + '/voucher',
          })
        ).status,
        403,
      );
      for (const token of ['', 'invalid'])
        assert.equal(
          (
            await send({
              token,
              target: '/api/daily-operations/' + operationId + '/voucher',
            })
          ).status,
          401,
        );
      assert.equal(
        (
          await send({
            token: 'admin',
            target: '/api/daily-operations/' + operationId + '/voucher',
            query: '?download=1',
          })
        ).status,
        400,
      );
      // Un supervisor de otro local recibe el 403 del backend, sin detalles.
      mode = 'foreign-voucher';
      result = await send({
        target: '/api/daily-operations/' + operationId + '/voucher',
      });
      assert.equal(result.status, 403);
      assert.doesNotMatch(await result.text(), /private/);
      mode = 'missing-voucher';
      result = await send({
        token: 'admin',
        target: '/api/daily-operations/' + operationId + '/voucher',
      });
      assert.equal(result.status, 404);
      assert.doesNotMatch(await result.text(), /private/);
      mode = '';
      assert.equal(
        (
          await send({
            target: '/api/daily-operations/' + operationId + '/otro',
          })
        ).status,
        404,
      );
      // Catálogo acotado de trabajadores elegibles del propio local
      // (SPRINT-4R-T03): sesión de supervisor, local de la sesión y solo
      // id/nombre en la respuesta.
      const workersTarget = '/api/daily-operations/eligible-workers';
      for (const token of ['', 'invalid'])
        assert.equal(
          (await send({ token, target: workersTarget + '?storeId=' + storeId }))
            .status,
          401,
        );
      for (const token of ['admin', 'worker', 'accountant', 'nostore'])
        assert.equal(
          (await send({ token, target: workersTarget + '?storeId=' + storeId }))
            .status,
          403,
        );
      assert.equal(
        (
          await send({
            token: 'down',
            target: workersTarget + '?storeId=' + storeId,
          })
        ).status,
        503,
      );
      for (const query of [
        '',
        '?storeId=' + otherStoreId,
        '?storeId=' + storeId + '&extra=1',
        '?storeId=' + storeId + '&storeId=' + storeId,
        '?storeId=not-a-uuid',
        '?businessDate=2026-10-26&storeId=' + storeId,
      ])
        assert.equal(
          (await send({ query, target: workersTarget })).status,
          400,
        );
      result = await send({ target: workersTarget + '?storeId=' + storeId });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), participants);
      mode = 'private-workers';
      result = await send({ target: workersTarget + '?storeId=' + storeId });
      const cleanedWorkers: unknown = await result.json();
      assert.deepEqual(cleanedWorkers, [participants[0]]);
      assert.equal(JSON.stringify(cleanedWorkers).includes('privado'), false);
      mode = 'duplicate-workers';
      assert.equal(
        (await send({ target: workersTarget + '?storeId=' + storeId })).status,
        502,
      );
      mode = 'bad-json';
      assert.equal(
        (await send({ target: workersTarget + '?storeId=' + storeId })).status,
        502,
      );
      mode = '';
      // Origen, contenido y campos del multipart.
      assert.equal(
        (
          await send({
            method: 'POST',
            origin: 'https://other.example.test',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await send({
            method: 'POST',
            contentType: 'text/plain',
            raw: 'x',
          })
        ).status,
        400,
      );
      for (const fields of [
        { ...validFields, storeId: otherStoreId },
        { ...validFields, responsibleId: responsibleId },
        { ...validFields, businessDate: '2026-02-30' },
        { ...validFields, cardTipAmount: '-1' },
        { ...validFields, cardTipAmount: '12.500' },
        { ...validFields, cashTipAmount: 'ocho' },
        { ...validFields, cashDifference: 'sin signo' },
        { ...validFields, cashDifference: '1.5' },
        { ...validFields, differenceReason: 'x'.repeat(501) },
        { ...validFields, cashDifference: '-1500', differenceReason: '' },
      ]) {
        const file = fields.cardTipAmount === '0' ? null : undefined;
        assert.equal(
          (await send({ method: 'POST', fields, file })).status,
          400,
          fields.cardTipAmount + '/' + fields.cashDifference,
        );
      }
      assert.equal(calls.length, 0);
      // La selección de participantes exige UUID válidos, sin duplicados, y al
      // menos uno cuando el fondo (tarjeta + efectivo) es mayor que 0.
      const withoutParticipants: Record<string, string | string[]> = {
        ...validFields,
      };
      delete withoutParticipants.participantIds;
      assert.equal(
        (await send({ method: 'POST', fields: withoutParticipants })).status,
        400,
      );
      assert.equal(
        (
          await send({
            method: 'POST',
            fields: { ...validFields, participantIds: ['no-uuid'] },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await send({
            method: 'POST',
            fields: {
              ...validFields,
              participantIds: [participantId, participantId],
            },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await send({
            method: 'POST',
            fields: { ...validFields, participantIds: [] },
          })
        ).status,
        400,
      );
      assert.equal(calls.length, 0);
      // Con fondo 0 la selección es opcional y la operación queda sin reparto.
      result = await send({
        method: 'POST',
        fields: {
          ...validFields,
          cardTipAmount: '0',
          cashTipAmount: '0',
          cashDifference: '0',
          differenceReason: '',
          participantIds: [],
        },
        file: null,
      });
      assert.equal(result.status, 201);
      assert.deepEqual((await result.json()).participants, []);
      calls.length = 0;
      // El voucher solo se acepta cuando hay propina con tarjeta.
      assert.equal(
        (
          await send({
            method: 'POST',
            fields: {
              ...validFields,
              cardTipAmount: '0',
              cashDifference: '0',
              differenceReason: '',
            },
          })
        ).status,
        400,
      );
      assert.equal(calls.length, 0);
      // Propina con tarjeta cero no exige voucher y la diferencia cero no exige motivo.
      result = await send({
        method: 'POST',
        fields: {
          ...validFields,
          cardTipAmount: '0',
          cashDifference: '0',
          differenceReason: '',
        },
        file: null,
      });
      assert.equal(result.status, 201);
      assert.equal(calls.length, 1);
      calls.length = 0;
      assert.equal(
        (
          await send({
            method: 'POST',
            file: { ...voucherFile, type: 'application/pdf' },
          })
        ).status,
        415,
      );
      assert.equal(
        (
          await send({
            method: 'POST',
            file: { ...voucherFile, data: 'a'.repeat(5 * 1024 * 1024 + 1) },
          })
        ).status,
        413,
      );
      assert.equal(calls.length, 0);
      result = await send({ method: 'POST' });
      assert.equal(result.status, 201);
      const echoed: unknown = await result.json();
      assert.deepEqual(echoed, operation);
      const upstream = calls.at(-1);
      assert.equal(upstream?.path, '/daily-operations');
      assert.match(
        upstream?.raw ?? '',
        /name="storeId"[\s\S]*?61000000-0000-4000-8000-000000000311/,
      );
      assert.match(upstream?.raw ?? '', /name="cashDifference"[\s\S]*?-1500/);
      assert.match(
        upstream?.raw ?? '',
        /name="differenceReason"[\s\S]*?Vale de caja firmado/,
      );
      assert.match(upstream?.raw ?? '', /filename="voucher.jpg"/);
      // La selección se reenvía como participantIds repetidos y la respuesta
      // pública conserva solo id y nombre.
      assert.match(
        upstream?.raw ?? '',
        /name="participantIds"[\s\S]*?65000000-0000-4000-8000-000000000311/,
      );
      assert.match(
        upstream?.raw ?? '',
        /name="participantIds"[\s\S]*?65000000-0000-4000-8000-000000000312/,
      );
      assert.deepEqual(
        isRecord(echoed) ? echoed.participants : undefined,
        participants,
      );
      // El local de la sesión reemplaza cualquier valor del formulario.
      result = await send({
        method: 'POST',
        fields: { ...validFields, storeId: otherStoreId, differenceReason: '' },
        file: null,
      });
      assert.equal(result.status, 400);
      mode = 'replay';
      assert.equal((await send({ method: 'POST' })).status, 200);
      mode = 'inactive';
      result = await send({ method: 'POST' });
      assert.equal(result.status, 400);
      assert.deepEqual(await result.json(), {
        code: 'STORE_INACTIVE',
        message: DAILY_STORE_INACTIVE_MESSAGE,
      });
      mode = 'bad-request';
      result = await send({ method: 'POST' });
      assert.equal(result.status, 400);
      assert.deepEqual(await result.json(), {
        message: dailyOperationErrorMessage(400),
      });
      mode = 'conflict';
      result = await send({ method: 'POST' });
      assert.equal(result.status, 409);
      const conflictBody = await result.text();
      assert.equal(conflictBody.includes('private'), false);
      assert.deepEqual(JSON.parse(conflictBody), {
        message: dailyOperationErrorMessage(409),
        existingOperationId: operationId,
      });
      mode = 'conflict-without-id';
      result = await send({ method: 'POST' });
      assert.equal(result.status, 409);
      assert.deepEqual(await result.json(), {
        message: dailyOperationErrorMessage(409),
      });
      for (const value of [
        'foreign-list',
        'duplicate',
        'private-error',
        'bad-json',
      ]) {
        mode = value;
        result = await send({
          query: '?storeId=' + storeId + '&businessDate=2026-10-26',
        });
        assert.equal(result.status, 502, value);
        assert.equal((await result.text()).includes('private'), false);
      }
      mode = 'foreign-detail';
      assert.equal(
        (await send({ target: '/api/daily-operations/' + operationId })).status,
        502,
      );
      mode = '';
      for (const value of [
        'foreign',
        'date',
        'amount',
        'responsible',
        'bad-json',
      ]) {
        mode = value;
        assert.equal((await send({ method: 'POST' })).status, 502, value);
      }
      mode = '';
      // Corrección (SPRINT-4R-T03): origen, esquema estricto, validación y
      // reenvío de solo los campos enviados.
      assert.equal((await send({ method: 'PATCH' })).status, 404);
      assert.equal(
        (
          await send({
            method: 'PATCH',
            target: '/api/daily-operations/not-a-uuid',
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await send({
            method: 'PATCH',
            origin: 'https://other.example.test',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await send({
            method: 'PATCH',
            target: '/api/daily-operations/' + operationId,
            fields: {},
            file: null,
          })
        ).status,
        400,
      );
      calls.length = 0;
      for (const fields of [
        { ...validFields },
        { ...validFields, cardTipAmount: '-1' },
        { ...validFields, cashTipAmount: '1.5' },
        { ...validFields, cashDifference: 'texto' },
        { ...validFields, participantIds: ['no-uuid'] },
        { ...validFields, participantIds: [''] },
        {
          ...validFields,
          participantIds: [participantId, participantId],
        },
        { ...validFields, cardTipAmount: '0' },
        { ...validFields, differenceReason: 'x'.repeat(501) },
      ]) {
        assert.equal(
          (
            await send({
              method: 'PATCH',
              target: '/api/daily-operations/' + operationId,
              fields,
            })
          ).status,
          400,
          JSON.stringify(fields).slice(0, 90),
        );
      }
      assert.equal(calls.length, 0);
      // Corrección válida: monto y selección, sin voucher (se conserva).
      result = await send({
        method: 'PATCH',
        target: '/api/daily-operations/' + operationId,
        fields: {
          cardTipAmount: '13000',
          participantIds: [secondParticipantId],
        },
        file: null,
      });
      assert.equal(result.status, 200);
      const patched: unknown = await result.json();
      assert.ok(isRecord(patched));
      assert.equal(patched.cardTipAmount, 13000);
      assert.equal(patched.tipFundAmount, 21000);
      assert.deepEqual(patched.participants, [participants[1]]);
      assert.ok(isRecord(patched.voucher));
      const patchCall = calls.at(-1);
      assert.equal(patchCall?.method, 'PATCH');
      assert.equal(patchCall?.path, '/daily-operations/' + operationId);
      assert.match(
        patchCall?.raw ?? '',
        /name="participantIds"[\s\S]*?65000000-0000-4000-8000-000000000312/,
      );
      assert.equal(patchCall?.raw.includes('name="storeId"'), false);
      assert.equal(patchCall?.raw.includes('filename='), false);
      // Corrección de solo la selección: se reemplaza completa.
      result = await send({
        method: 'PATCH',
        target: '/api/daily-operations/' + operationId,
        fields: { participantIds: [participantId, secondParticipantId] },
        file: null,
      });
      assert.equal(result.status, 200);
      assert.deepEqual((await result.json()).participants, participants);
      // El servicio miente si no refleja lo enviado o devuelve otro local.
      mode = 'patch-lying';
      assert.equal(
        (
          await send({
            method: 'PATCH',
            target: '/api/daily-operations/' + operationId,
            fields: { cashTipAmount: '9000' },
            file: null,
          })
        ).status,
        502,
      );
      mode = 'patch-foreign';
      assert.equal(
        (
          await send({
            method: 'PATCH',
            target: '/api/daily-operations/' + operationId,
            fields: { cashTipAmount: '9000' },
            file: null,
          })
        ).status,
        502,
      );
      // El conflicto y la ausencia del servicio se mapean sin filtrar datos.
      mode = 'patch-conflict';
      result = await send({
        method: 'PATCH',
        target: '/api/daily-operations/' + operationId,
        fields: { cashTipAmount: '9000' },
        file: null,
      });
      assert.equal(result.status, 409);
      assert.deepEqual(await result.json(), {
        message: dailyOperationErrorMessage(409),
        existingOperationId: operationId,
      });
      mode = 'patch-missing';
      assert.equal(
        (
          await send({
            method: 'PATCH',
            target: '/api/daily-operations/' + operationId,
            fields: { cashTipAmount: '9000' },
            file: null,
          })
        ).status,
        404,
      );
      mode = '';
    } finally {
      frontend.kill();
      backend.closeAllConnections();
      await new Promise<undefined>((resolve) =>
        backend.close(() => resolve(undefined)),
      );
    }
  },
);
