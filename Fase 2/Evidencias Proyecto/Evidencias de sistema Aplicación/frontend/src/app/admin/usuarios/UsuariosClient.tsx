'use client';

import { useMemo, useState } from 'react';
import { ApiUser, CREATABLE_ROLES } from '@/lib/users-api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/Modal';
import { ConfirmModal } from '@/components/ConfirmModal';

const inputClass =
  'border border-line2 rounded-lg px-3 py-2.5 bg-bg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-salmon';

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  roleCode: (typeof CREATABLE_ROLES)[number]['code'];
}

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  roleCode: 'ADMINISTRADOR',
};

export function UsuariosClient({
  initialUsers,
  initialError,
}: {
  initialUsers: ApiUser[];
  initialError: string | null;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [usuarios, setUsuarios] = useState<ApiUser[]>(initialUsers);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [confirmando, setConfirmando] = useState<ApiUser | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter(
      (u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [busqueda, usuarios]);

  function abrirModal() {
    setForm(EMPTY_FORM);
    setErrorForm(null);
    setModalAbierto(true);
  }

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    setErrorForm(null);

    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.password) {
      setErrorForm('Nombre, apellido, correo y contraseña son obligatorios.');
      return;
    }
    if (form.password.length < 8) {
      setErrorForm('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setGuardando(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          password: form.password,
          roleCode: form.roleCode,
          // Sin storeId: los dos roles disponibles acá (Administrador,
          // Contador) son globales y el backend lo rechaza si se envía.
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorForm(data.message ?? 'No se pudo crear el usuario.');
        return;
      }

      setUsuarios((prev) => [data as ApiUser, ...prev]);
      setModalAbierto(false);
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarDesactivar() {
    if (!confirmando) return;
    const res = await fetch(`/api/users/${confirmando.id}/deactivate`, { method: 'PATCH' });
    const data = await res.json();

    if (res.ok) {
      setUsuarios((prev) => prev.map((u) => (u.id === confirmando.id ? (data as ApiUser) : u)));
    }
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

      {initialError && (
        <div className="bg-crit-bg text-crit rounded-lg px-3.5 py-2.5 text-[12.5px] mb-3.5">
          No se pudo cargar la lista desde el backend ({initialError}). Verifica que esté
          corriendo y que tu sesión siga activa.
        </div>
      )}

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre o correo…"
        className={`${inputClass} w-full mb-3.5`}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {['Usuario', 'Rol', 'Local', 'Estado', ''].map((h) => (
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
                  <div className="font-semibold">{u.firstName} {u.lastName}</div>
                  <div className="text-[11.5px] text-muted">{u.email}</div>
                </td>
                <td className="px-2.5 py-2.5 border-b border-line">
                  <Pill>{u.role.name}</Pill>
                </td>
                <td className="px-2.5 py-2.5 border-b border-line">{u.store?.name ?? 'Global (sin local)'}</td>
                <td className="px-2.5 py-2.5 border-b border-line">
                  <Pill variant={u.isActive ? 'ok' : 'crit'}>{u.isActive ? 'Activo' : 'Desactivado'}</Pill>
                </td>
                <td className="px-2.5 py-2.5 border-b border-line">
                  {u.isActive ? (
                    <Button onClick={() => setConfirmando(u)}>Desactivar</Button>
                  ) : (
                    <span className="text-[11.5px] text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-5">
                  {usuarios.length === 0 ? 'Sin usuarios aún.' : `Sin resultados para “${busqueda}”.`}
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

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12.5px] font-semibold text-ink2">Nombre</label>
                <input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  placeholder="Juan"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12.5px] font-semibold text-ink2">Apellido</label>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="Pérez"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12.5px] font-semibold text-ink2">Correo</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="juan.perez@moi-food.cl"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12.5px] font-semibold text-ink2">Contraseña inicial</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Mínimo 8 caracteres"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12.5px] font-semibold text-ink2">Rol</label>
              <select
                value={form.roleCode}
                onChange={(e) => setForm({ ...form, roleCode: e.target.value as FormState['roleCode'] })}
                className={inputClass}
              >
                {CREATABLE_ROLES.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted leading-relaxed">
                Supervisor y Trabajador requieren un local, y el backend todavía no tiene
                módulo de locales — se habilitan cuando exista.
              </p>
            </div>

            <div className="flex gap-2.5 justify-end mt-1.5">
              <Button type="button" onClick={() => setModalAbierto(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={guardando}>
                {guardando ? 'Creando…' : 'Crear usuario'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {confirmando && (
        <ConfirmModal
          title="Desactivar usuario"
          message={`${confirmando.firstName} ${confirmando.lastName} perderá acceso al sistema (se cierran sus sesiones activas). Esta acción no se puede deshacer desde aquí todavía — el backend no tiene endpoint de reactivar.`}
          confirmLabel="Desactivar"
          danger
          onConfirm={confirmarDesactivar}
          onCancel={() => setConfirmando(null)}
        />
      )}
    </Card>
  );
}
