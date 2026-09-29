import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';

// Parte de la solicitud de donde se lee el ID del local.
export type StoreIdSource = 'params' | 'query' | 'body';

export interface StoreScopeOptions {
  // Nombre del campo con el ID del local (por defecto "storeId").
  field?: string;
  // Parte de la solicitud donde viene (por defecto "params"). Se fija de
  // forma explícita para que el guard valide el mismo valor que usa el
  // servicio.
  source?: StoreIdSource;
}

export interface StoreScopeMetadata {
  field: string;
  source: StoreIdSource;
}

// Restringe un endpoint al local indicado en la solicitud: el StoreAccessGuard
// global responde 403 si un usuario no global intenta operar sobre un local
// distinto al suyo. Documenta además la respuesta 403 en Swagger.
export const STORE_SCOPE_KEY = 'storeScope';
export const StoreScoped = (
  options: StoreScopeOptions = {},
): ReturnType<typeof applyDecorators> => {
  const metadata: StoreScopeMetadata = {
    field: options.field ?? 'storeId',
    source: options.source ?? 'params',
  };
  return applyDecorators(
    SetMetadata(STORE_SCOPE_KEY, metadata),
    ApiForbiddenResponse({
      description: 'El usuario no tiene acceso al local solicitado.',
    }),
  );
};
