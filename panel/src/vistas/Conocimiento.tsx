import { useState } from 'react';
import { api, type Documento } from '../api';
import { Aviso, useDatos } from '../util';

type Borrador = Omit<Documento, 'id'> & { id?: string };
const VACIO: Borrador = { titulo: '', contenido: '', audiencia: 'TODOS' };

export function Conocimiento({ base }: { base: string }) {
  const { datos, error, recargar } = useDatos<Documento[]>(`${base}/conocimiento`);
  const [editando, setEditando] = useState<Borrador | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    if (!editando) return;
    setErr(null);
    try {
      const cuerpo = { titulo: editando.titulo, contenido: editando.contenido, audiencia: editando.audiencia };
      if (editando.id) await api.put(`${base}/conocimiento/${editando.id}`, cuerpo);
      else await api.post(`${base}/conocimiento`, cuerpo);
      setEditando(null);
      await recargar();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const borrar = async (d: Documento) => {
    if (!confirm(`¿Borrar "${d.titulo}"? El asistente dejará de usar esta información.`)) return;
    await api.del(`${base}/conocimiento/${d.id}`).catch((e) => setErr((e as Error).message));
    await recargar();
  };

  if (editando)
    return (
      <section>
        <h2>{editando.id ? 'Editar documento' : 'Nuevo documento'}</h2>
        <div className="tarjeta">
          <label>
            Título
            <input value={editando.titulo} onChange={(e) => setEditando({ ...editando, titulo: e.target.value })} />
          </label>
          <label>
            Quién puede verlo
            <select
              value={editando.audiencia}
              onChange={(e) => setEditando({ ...editando, audiencia: e.target.value as Documento['audiencia'] })}
            >
              <option value="TODOS">Clientes y equipo</option>
              <option value="EQUIPO">Solo el equipo (interno)</option>
            </select>
          </label>
          <label>
            Contenido
            <textarea rows={18} value={editando.contenido} onChange={(e) => setEditando({ ...editando, contenido: e.target.value })} />
          </label>
          <p className="tenue">No incluyas precios: el asistente los deriva al equipo.</p>
          <Aviso error={err} />
          <div className="botones">
            <button onClick={guardar} disabled={!editando.titulo.trim() || !editando.contenido.trim()}>
              Guardar
            </button>
            <button className="secundario" onClick={() => setEditando(null)}>
              Cancelar
            </button>
          </div>
        </div>
      </section>
    );

  return (
    <section>
      <div className="cabecera-seccion">
        <h2>Conocimiento</h2>
        <button onClick={() => setEditando(VACIO)}>Nuevo documento</button>
      </div>
      <p className="tenue">Lo que el asistente puede consultar para responder. Los cambios aplican al instante.</p>
      <Aviso error={error ?? err} />
      <div className="tabla">
        {datos?.map((d) => (
          <div key={d.id} className="tarjeta fila-tabla">
            <div>
              <strong>{d.titulo}</strong> {d.audiencia === 'EQUIPO' && <span className="etiqueta">interno</span>}
              <div className="tenue recorte">{d.contenido.slice(0, 160)}</div>
            </div>
            <div className="botones">
              <button className="secundario" onClick={() => setEditando(d)}>
                Editar
              </button>
              <button className="peligro" onClick={() => borrar(d)}>
                Borrar
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
