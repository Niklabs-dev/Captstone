import { AppModule } from '../src/app.module.js';
import { RequestMethod } from '@nestjs/common';
import {
  ADMIN_AND_ACCOUNTANT_READ_CONTROLLER_PATHS,
  ADMIN_ONLY_CONTROLLER_PATHS,
} from '../src/auth/constants/admin-only-routes.constants.js';
import { ROLE } from '../src/auth/constants/roles.constants.js';
import { IS_PUBLIC_KEY } from '../src/auth/decorators/public.decorator.js';
import { ROLES_KEY } from '../src/auth/decorators/roles.decorator.js';

// Rutas exclusivas del administrador (SPRINT-4R-T15). Recorre los módulos de
// la aplicación real y comprueba, solo con metadatos (sin servidor ni base de
// datos), que cada controlador registrado como exclusivo exista y que todos
// sus endpoints exijan ADMINISTRADOR y ningún otro rol.

type Constructor = abstract new (...args: never[]) => unknown;

// Claves con que @Module, @Controller y @Get/@Post/... guardan sus metadatos
// (constantes internas de @nestjs/common, que su exports no expone).
const MODULE_CONTROLLERS = 'controllers';
const MODULE_IMPORTS = 'imports';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

interface Endpoint {
  controller: string;
  handler: string;
  method: unknown;
  roles: readonly string[] | undefined;
  isPublic: boolean;
}

function asModule(entry: unknown): Constructor | null {
  if (typeof entry === 'function') return entry as Constructor;
  if (typeof entry === 'object' && entry !== null && 'module' in entry) {
    const module = entry.module;
    return typeof module === 'function' ? (module as Constructor) : null;
  }
  return null;
}

function collectControllers(
  module: Constructor,
  seen = new Set<Constructor>(),
): Constructor[] {
  if (seen.has(module)) return [];
  seen.add(module);
  const controllers =
    (Reflect.getMetadata(MODULE_CONTROLLERS, module) as
      Constructor[] | undefined) ?? [];
  const imports =
    (Reflect.getMetadata(MODULE_IMPORTS, module) as unknown[] | undefined) ??
    [];
  const nested = imports
    .map(asModule)
    .filter((entry): entry is Constructor => entry !== null)
    .flatMap((entry) => collectControllers(entry, seen));
  return [...controllers, ...nested];
}

function controllerPath(controller: Constructor): string {
  const path: unknown = Reflect.getMetadata(PATH_METADATA, controller);
  return typeof path === 'string' ? path.replace(/^\/+|\/+$/g, '') : '';
}

// Endpoints del controlador con los roles efectivos: los del método mandan
// sobre los de la clase, igual que Reflector.getAllAndOverride en el guard.
function endpointsOf(controller: Constructor): Endpoint[] {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .filter((name) => {
      const handler = prototype[name];
      return (
        typeof handler === 'function' &&
        Reflect.getMetadata(METHOD_METADATA, handler) !== undefined
      );
    })
    .map((name) => {
      const handler = prototype[name] as object;
      const roles =
        (Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined) ??
        (Reflect.getMetadata(ROLES_KEY, controller) as string[] | undefined);
      const isPublic =
        Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true ||
        Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
      const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      return {
        controller: controller.name,
        handler: name,
        method,
        roles,
        isPublic,
      };
    });
}

describe('Rutas exclusivas del administrador (SPRINT-4R-T15)', () => {
  const controllers = collectControllers(AppModule);

  it('encuentra los controladores de la aplicación', () => {
    expect(controllers.length).toBeGreaterThan(10);
  });

  it.each(ADMIN_ONLY_CONTROLLER_PATHS)(
    '%s existe y todos sus endpoints exigen solo ADMINISTRADOR',
    (path) => {
      const matches = controllers.filter(
        (controller) => controllerPath(controller) === path,
      );
      expect(matches).toHaveLength(1);
      const endpoints = matches.flatMap(endpointsOf);
      expect(endpoints.length).toBeGreaterThan(0);
      for (const endpoint of endpoints) {
        expect(endpoint, `${endpoint.controller}.${endpoint.handler}`).toEqual(
          expect.objectContaining({
            roles: [ROLE.ADMINISTRADOR],
            isPublic: false,
          }),
        );
      }
    },
  );

  // SPRINT-4A-T23: los reportes de ventas son de solo lectura y los comparte
  // el CONTADOR; ningún endpoint de escritura puede colarse en ellos.
  it.each(ADMIN_AND_ACCOUNTANT_READ_CONTROLLER_PATHS)(
    '%s existe, solo expone GET y exige ADMINISTRADOR o CONTADOR',
    (path) => {
      expect(ADMIN_ONLY_CONTROLLER_PATHS).not.toContain(path);
      const matches = controllers.filter(
        (controller) => controllerPath(controller) === path,
      );
      expect(matches).toHaveLength(1);
      const endpoints = matches.flatMap(endpointsOf);
      expect(endpoints.length).toBeGreaterThan(0);
      for (const endpoint of endpoints) {
        expect(endpoint, `${endpoint.controller}.${endpoint.handler}`).toEqual(
          expect.objectContaining({
            method: RequestMethod.GET,
            roles: [ROLE.ADMINISTRADOR, ROLE.CONTADOR],
            isPublic: false,
          }),
        );
      }
    },
  );
});
