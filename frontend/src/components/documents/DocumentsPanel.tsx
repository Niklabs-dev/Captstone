'use client';
import {
  filterPanelClass,
  panelTitleClass,
  tablePanelClass,
  tableHeaderClass,
  labelClass,
  inputClass,
} from '@/components/ui/styles';
import { useState, type ReactElement } from 'react';
import type { ManagedUser } from '@/lib/users';
import { DocumentWorkspace } from './DocumentWorkspace';

export function DocumentsPanel({
  workers,
}: {
  workers: ManagedUser[];
}): ReactElement {
  const [search, setSearch] = useState('');
  const [store, setStore] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = workers.find((worker) => worker.id === selectedId);
  const stores = [
    ...new Map(
      workers.flatMap((worker) =>
        worker.store ? [[worker.store.id, worker.store] as const] : [],
      ),
    ).values(),
  ];
  const visible = workers.filter(
    (worker) =>
      (!store || worker.store?.id === store) &&
      (worker.firstName + ' ' + worker.lastName + ' ' + worker.email)
        .toLocaleLowerCase('es')
        .includes(search.trim().toLocaleLowerCase('es')),
  );
  return (
    <div className="space-y-5">
      <section
        aria-labelledby="module-filters-title"
        className={filterPanelClass}
      >
        <h2 id="module-filters-title" className={`${panelTitleClass} mb-4`}>
          Filtros
        </h2>
        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <label className={labelClass}>
            Buscar trabajador
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, apellido o correo"
              className={'mt-2 ' + inputClass}
            />
          </label>
          <label className={labelClass}>
            Local
            <select
              aria-label="Local"
              value={store}
              onChange={(event) => setStore(event.target.value)}
              className={'mt-2 ' + inputClass}
            >
              <option value="">Todos los locales</option>
              {stores.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {busy && (
        <p role="status" className="text-sm text-ink2">
          Espera a que termine la operación antes de cambiar de trabajador.
        </p>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <section
          aria-labelledby="workers-title"
          className={`${tablePanelClass} min-w-0`}
        >
          <header className={tableHeaderClass}>
            <h2 id="workers-title" className={panelTitleClass}>
              Trabajadores
            </h2>
            <p className="mt-2 text-sm text-ink2">
              {visible.length}{' '}
              {visible.length === 1
                ? 'cuenta disponible'
                : 'cuentas disponibles'}
            </p>
          </header>
          {visible.length === 0 ? (
            <p className="p-5 text-sm leading-6 text-ink2">
              {workers.length
                ? 'No hay trabajadores que coincidan con los filtros.'
                : 'Aún no hay trabajadores disponibles para consultar.'}
            </p>
          ) : (
            <ul className="max-h-[480px] divide-y divide-line overflow-y-auto">
              {visible.map((worker) => (
                <li key={worker.id}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={selectedId === worker.id}
                    onClick={() => setSelectedId(worker.id)}
                    className={
                      'block min-h-20 w-full px-5 py-4 text-left transition-colors hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-salmon-ink disabled:opacity-60 ' +
                      (selectedId === worker.id ? 'bg-tint2' : '')
                    }
                  >
                    <span className="block break-words text-sm font-semibold">
                      {worker.firstName} {worker.lastName}
                    </span>
                    <span className="mt-2 block break-all text-xs text-ink2">
                      {worker.email}
                    </span>
                    <span className="mt-2 block text-xs text-ink2">
                      {worker.store?.name ?? 'Sin local'} ·{' '}
                      {worker.isActive ? 'Activo' : 'Desactivado'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {selected ? (
          <DocumentWorkspace
            key={selected.id}
            workerId={selected.id}
            workerName={selected.firstName + ' ' + selected.lastName}
            onBusy={(value) => {
              setBusy(value);
            }}
          />
        ) : (
          <section
            aria-labelledby="select-worker-title"
            className="flex min-h-72 flex-col items-center justify-center rounded-[14px] border border-line bg-bg px-6 py-12 text-center"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mb-4 size-12 text-salmon-ink"
            >
              <path d="M5 13a3 3 0 0 1 3-3h11l5 5h16a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3Z" />
              <path d="M5 20h38" />
            </svg>
            <h2 id="select-worker-title" className={panelTitleClass}>
              Selecciona un trabajador
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-ink2">
              Abre su carpeta para consultar documentos, versiones y opciones de
              carga.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
