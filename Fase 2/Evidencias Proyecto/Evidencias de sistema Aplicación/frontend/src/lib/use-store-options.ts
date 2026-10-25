'use client';
import { useCallback, useEffect, useState } from 'react';
import { loadStores, StoreError } from './stores-client';
import { storeOptions } from './stores';
import type { StoreOption } from './users';

// El catálogo se revalida al volver a la pestaña y después de una mutación.
export function useStoreOptions(initial: StoreOption[] = []): {
  stores: StoreOption[];
  catalogError: string;
  reload: (signal?: AbortSignal) => Promise<StoreOption[]>;
} {
  const [stores, setStores] = useState(initial);
  const [catalogError, setError] = useState('');
  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<StoreOption[]> => {
      try {
        const items = storeOptions(await loadStores(signal));
        if (!signal?.aborted) {
          setStores(items);
          setError('');
        }
        return items;
      } catch (error) {
        if (!signal?.aborted)
          setError(
            error instanceof StoreError
              ? error.message
              : 'No se pudo actualizar el catálogo de locales.',
          );
        throw error;
      }
    },
    [],
  );
  useEffect(() => {
    let controller = new AbortController();
    function update(): void {
      controller.abort();
      controller = new AbortController();
      refresh(controller.signal).catch(() => undefined);
    }
    update();
    window.addEventListener('focus', update);
    window.addEventListener('stores-updated', update);
    return () => {
      controller.abort();
      window.removeEventListener('focus', update);
      window.removeEventListener('stores-updated', update);
    };
  }, [refresh]);
  return { stores, catalogError, reload: refresh };
}
