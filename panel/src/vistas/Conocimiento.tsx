import { useState } from 'react';
import { api, type Documento } from '../api';
import { Icono } from '../iconos';
import { Aviso, Encabezado, useDatos, Vacio } from '../util';

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
        <Encabezado etiqueta="Conocimiento" titulo={editando.id ? 'Editar documento' : 'Nuevo documento'} />
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
          <p className="alerta-caja suave">No incluyas precios: el asistente los deriva al equipo.</p>
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
      <Encabezado
        etiqueta="Base del asistente"
        titulo="Conocimiento"
        accion={
          <button onClick={() => setEditando(VACIO)}>
            <Icono nombre="mas" />
            Nuevo documento
          </button>
        }
      >
        Lo que el asistente consulta para responder. Los cambios aplican al instante.
      </Encabezado>
      {datos && !datos.length && <Vacio>Todavía no hay documentos.</Vacio>}
      <Aviso error={error ?? err} />
      <div className="lista-tarjetas">
        {datos?.map((d) => (
          <div key={d.id} className="tarjeta fila-tabla">
            <div>
              <strong>{d.titulo}</strong> {d.audiencia === 'EQUIPO' && <span className="etiqueta">interno</span>}
              <div className="tenue recorte" style={{ marginTop: 4 }}>{d.contenido.slice(0, 160)}</div>
            </div>
            <div className="botones">
              <button className="secundario chico" onClick={() => setEditando(d)}>
                <Icono nombre="editar" tam={16} />
                Editar
              </button>
              <button className="peligro chico" onClick={() => borrar(d)}>
                <Icono nombre="borrar" tam={16} />
                Borrar
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
