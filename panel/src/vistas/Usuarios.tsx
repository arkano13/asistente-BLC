import { useState, type FormEvent } from 'react';
import { api, type Sesion, type Usuario } from '../api';
import { Avatar, Aviso, Encabezado, fecha, useDatos } from '../util';

export function Usuarios({ base, sesion }: { base: string; sesion: Sesion }) {
  const { datos, error, recargar } = useDatos<Usuario[]>(`${base}/usuarios`);
  const [err, setErr] = useState<string | null>(null);

  const crear = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setErr(null);
    try {
      await api.post(`${base}/usuarios`, f);
      form.reset();
      await recargar();
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  const borrar = async (u: Usuario) => {
    if (!confirm(`¿Quitar el acceso de ${u.email}?`)) return;
    await api.del(`${base}/usuarios/${u.id}`).catch((x) => setErr((x as Error).message));
    await recargar();
  };

  return (
    <section>
      <Encabezado etiqueta="Equipo" titulo="Usuarios del panel">
        Personas del equipo con acceso a este panel.
      </Encabezado>
      <div className="rejilla-2">
      <Aviso error={error ?? err} />
      <div className="lista-tarjetas">
        {datos?.map((u) => (
          <div key={u.id} className="tarjeta fila-tabla">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
              <Avatar texto={u.nombre} />
              <div style={{ minWidth: 0 }}>
                <strong>{u.nombre}</strong>
                <div className="tenue">{u.email}</div>
                <div className="tenue">Último acceso: {fecha(u.ultimoAcceso) || 'nunca'}</div>
              </div>
            </div>
            {u.id !== sesion.usuarioId && (
              <button className="peligro chico" onClick={() => borrar(u)}>
                Quitar
              </button>
            )}
          </div>
        ))}
      </div>
      <form className="tarjeta" onSubmit={crear} style={{ margin: 0 }}>
        <h3>Agregar usuario</h3>
        <label>
          Nombre
          <input name="nombre" required />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Contraseña inicial (mínimo 10 caracteres)
          <input name="password" type="password" minLength={10} required autoComplete="new-password" />
        </label>
        <button>Agregar usuario</button>
      </form>
      </div>
    </section>
  );
}
