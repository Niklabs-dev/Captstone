'use client';

import { useMemo, useState } from 'react';
import { MOCK_USUARIOS, UsuarioRow } from '@/lib/mock-data';
import { Card, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/Modal';
import { ConfirmModal } from '@/components/ConfirmModal';

const ROLES: UsuarioRow['rol'][] = ['Administrador', 'Contador', 'Supervisor', 'Trabajador'];

function nuevoId() {
  return `u${Math.random().toString(36).slice(2, 8)}`;
}

const inputClass =
  'border border-line2 rounded-lg px-3 py-2.5 bg-bg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-salmon';

export default function UsuariosPage() {
  const [busqueda, setBusqueda] = useState('');
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>(MOCK_USUARIOS);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [confirmando, setConfirmando] = useState<UsuarioRow | null>(null);

  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [rol, setRol] = useState<UsuarioRow['rol']>('Trabajador');
  const [alcance, setAlcance] = useState('');
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter(
      (u) => u.nombre.toLowerCase().includes(q) || u.correo.toLowerCase().includes(q)
    );
  }, [busqueda, usuarios]);

  function abrirModal() {
    setNombre('');
    setCorreo('');
    setRol('Trabajador');
    setAlcance('');
    setErrorForm(null);
    setModalAbierto(true);
  }

  function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !correo.trim()) {
      setErrorForm('Nombre y correo son obligatorios.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())) {
      setErrorForm('Ingresa un correo válido.');
      return;
    }
    if (usuarios.some((u) => u.correo.toLowerCase() === correo.trim().toLowerCase())) {
      setErrorForm('Ya existe un usuario con ese correo.');
      return;
    }

    // TODO(SPRINT-1-T08): reemplazar por POST /usuarios contra NestJS.
    const nuevo: UsuarioRow = {
      id: nuevoId(),
      nombre: nombre.trim(),
      correo: correo.trim().toLowerCase(),
      rol,
      alcance: alcance.trim() || '—',
      estado: 'Activo',
    };
    setUsuarios((prev) => [nuevo, ...prev]);
    setModalAbierto(false);
  }

  function confirmarToggle() {
    if (!confirmando) return;
    // TODO(SPRINT-1-T08): reemplazar por PATCH /usuarios/:id/desactivar (o reactivar).
    setUsuarios((prev) =>
      prev.map((x) =>
        x.id === confirmando.id ? { ...x, estado: x.estado === 'Activo' ? 'Desactivado' : 'Activo' } : x
      )
    );
    setConfirmando(null);
  }

  return (
    <Card>
      <CardHeader
        title="Usuarios del sistema"
        subtitle="Control de acceso por rol · mínimo privilegio (Ley N°21.719)"
        action={
          <Button variant="primary" onClick={abrirModal}>
            ＋ Crear usuario
          </Button>
        }
      />

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre o correo…"
        className={`${inputClass} w-full mb-3.5`}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {['Usuario', 'Rol', 'Alcance', 'Estado', ''].map((h) => (
                <th
                  key={h}
                  className="text-left text-[11px] text-muted uppercase tracking-wide font-semibold px-2.5 py-2 border-b border-line"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.map((u) => (
              <tr key={u.id}>
                <td className="px-2.5 py-2.5 border-b border-line">
                  <div className="font-semibold">{u.nombre}</div>
                  <div className="text-[11.5px] text-muted">{u.correo}</div>
                </td>
                <td className="px-2.5 py-2.5 border-b border-line">
                  <Pill>{u.rol}</Pill>
                </td>
                <td className="px-2.5 py-2.5 border-b border-line">{u.alcance}</td>
                <td className="px-2.5 py-2.5 border-b border-line">
                  <Pill variant={u.estado === 'Activo' ? 'ok' : 'crit'}>{u.estado}</Pill>
                </td>
                <td className="px-2.5 py-2.5 border-b border-line">
                  <Button onClick={() => setConfirmando(u)}>
                    {u.estado === 'Activo' ? 'Desactivar' : 'Reactivar'}
                  </Button>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-5">
                  Sin resultados para “{busqueda}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <Modal title="Crear usuario" onClose={() => setModalAbierto(false)}>
          <form onSubmit={handleCrear} className="flex flex-col gap-4">
            {errorForm && (
              <div className="bg-crit-bg text-crit rounded-lg px-3.5 py-2.5 text-[12.5px]">
                {errorForm}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="nombre" className="text-[12.5px] font-semibold text-ink2">
                Nombre completo
              </label>
              <input
                id="nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Camila Rojas"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="correo" className="text-[12.5px] font-semibold text-ink2">
                Correo
              </label>
              <input
                id="correo"
                type="email"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="nombre@moifood.cl"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="rol" className="text-[12.5px] font-semibold text-ink2">
                Rol
              </label>
              <select
                id="rol"
                value={rol}
                onChange={(e) => setRol(e.target.value as UsuarioRow['rol'])}
                className={inputClass}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="alcance" className="text-[12.5px] font-semibold text-ink2">
                Alcance (opcional)
              </label>
              <input
                id="alcance"
                value={alcance}
                onChange={(e) => setAlcance(e.target.value)}
                placeholder="Ej: Solo LOC-02"
                className={inputClass}
              />
            </div>

            <div className="flex gap-2.5 justify-end mt-1.5">
              <Button type="button" onClick={() => setModalAbierto(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Crear usuario
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {confirmando && (
        <ConfirmModal
          title={confirmando.estado === 'Activo' ? 'Desactivar usuario' : 'Reactivar usuario'}
          message={
            confirmando.estado === 'Activo'
              ? `${confirmando.nombre} perderá acceso al sistema hasta que lo reactives. ¿Continuar?`
              : `${confirmando.nombre} volverá a tener acceso al sistema. ¿Continuar?`
          }
          confirmLabel={confirmando.estado === 'Activo' ? 'Desactivar' : 'Reactivar'}
          danger={confirmando.estado === 'Activo'}
          onConfirm={confirmarToggle}
          onCancel={() => setConfirmando(null)}
        />
      )}
    </Card>
  );
}
