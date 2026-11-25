import { useEffect, useRef, useState } from 'react';
import { api, type DetalleContacto, type FilaContacto } from '../api';
import { Aviso, fecha, nombreContacto, useDatos } from '../util';

export function Chats({ base }: { base: string }) {
  const lista = useDatos<FilaContacto[]>(`${base}/contactos`, 10_000);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const filas = (lista.datos ?? []).filter((c) =>
    `${c.nombre ?? ''} ${c.telefono ?? ''}`.toLowerCase().includes(busca.toLowerCase()),
  );

  return (
    <section className={abierto ? 'chats con-detalle' : 'chats'}>
      <div className="lista">
        <h2>Chats</h2>
        <input placeholder="Buscar por nombre o número" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Aviso error={lista.error} />
        {filas.map((c) => (
          <button key={c.id} className={c.id === abierto ? 'fila activa' : 'fila'} onClick={() => setAbierto(c.id)}>
            <span className="fila-titulo">
              {nombreContacto(c)}
              {c.rol === 'EQUIPO' && <span className="etiqueta">equipo</span>}
              {c.escalado && <span className="etiqueta alerta">escalado</span>}
              <span className={c.modo === 'BOT' ? 'etiqueta bot' : 'etiqueta humano'}>{c.modo === 'BOT' ? 'bot' : 'humano'}</span>
            </span>
            <span className="fila-sub">
              {c.ultimaDireccion === 'SALIENTE' ? '↩ ' : ''}
              {c.ultimoMensaje ?? ''}
            </span>
            <span className="fila-fecha">{fecha(c.ultimoEn)}</span>
          </button>
        ))}
        {lista.datos && !filas.length && <p className="tenue">Sin chats todavía.</p>}
      </div>
      {abierto && <Detalle base={base} id={abierto} alCerrar={() => setAbierto(null)} alCambiar={lista.recargar} />}
    </section>
  );
}

function Detalle({ base, id, alCerrar, alCambiar }: { base: string; id: string; alCerrar: () => void; alCambiar: () => void }) {
  const d = useDatos<DetalleContacto>(`${base}/contactos/${id}`, 5000);
  const [error, setError] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const ultimo = d.datos?.mensajes.at(-1)?.id;
  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [ultimo]);

  const accion = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await d.recargar();
      alCambiar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!d.datos) return <div className="detalle">Cargando…</div>;
  const c = d.datos;
  return (
    <div className="detalle">
      <div className="detalle-cabecera">
        <button className="secundario solo-movil" onClick={alCerrar}>
          ← Volver
        </button>
        <div>
          <strong>{nombreContacto(c)}</strong>
          {c.nombre && <div className="tenue">{c.telefono ? `+${c.telefono}` : c.jid}</div>}
        </div>
        <span className="espacio" />
        <button
          className="peligro"
          onClick={async () => {
            if (!confirm('Se borra toda la conversación de este número (mensajes, memoria, leads y escalamientos). El próximo mensaje empieza desde cero. ¿Seguir?')) return;
            try {
              await api.del(`${base}/contactos/${id}`);
              alCerrar();
              alCambiar();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Reiniciar conversación
        </button>
        {c.modo === 'BOT' ? (
          <button className="secundario" onClick={() => accion(() => api.post(`${base}/contactos/${id}/pausar`))}>
            Pausar bot
          </button>
        ) : (
          <button onClick={() => accion(() => api.post(`${base}/contactos/${id}/devolver-al-bot`))}>Devolver al bot</button>
        )}
      </div>
      <div className="detalle-info">
        <span>
          Modo: <strong>{c.modo === 'BOT' ? 'atiende el bot' : 'atiende una persona (bot pausado)'}</strong>
        </span>
        <label className="en-linea">
          Rol:
          <select value={c.rol} onChange={(e) => accion(() => api.patch(`${base}/contactos/${id}`, { rol: e.target.value }))}>
            <option value="CLIENTE">Cliente</option>
            <option value="EQUIPO">Equipo</option>
          </select>
        </label>
      </div>
      {c.escalamientos.length > 0 && (
        <p className="alerta-caja">Escalado: {c.escalamientos.map((e) => e.motivo).join(' · ')}</p>
      )}
      {c.resumen && (
        <details className="resumen">
          <summary>Lo que el asistente recuerda de este contacto</summary>
          <pre>{c.resumen}</pre>
        </details>
      )}
      <Aviso error={error ?? d.error} />
      <div className="mensajes">
        {c.mensajes.map((m) => (
          <div key={m.id} className={m.direccion === 'ENTRANTE' ? 'burbuja entrante' : 'burbuja saliente'}>
            <div>{m.contenido}</div>
            <div className="hora">{fecha(m.creadoEn)}</div>
          </div>
        ))}
        <div ref={fin} />
      </div>
      <p className="tenue pie">Para responder, escribe desde el WhatsApp del asistente: el bot se pausa solo en ese chat.</p>
    </div>
  );
}
