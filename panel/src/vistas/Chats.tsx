import { useEffect, useRef, useState } from 'react';
import { api, type DetalleContacto, type FilaContacto } from '../api';
import { Icono } from '../iconos';
import { Avatar, Aviso, fecha, nombreContacto, useDatos, Vacio } from '../util';

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
        <p className="kicker">Conversaciones</p>
        <h2>Chats</h2>
        <div className="buscador">
          <Icono nombre="buscar" />
          <input placeholder="Buscar por nombre o número" aria-label="Buscar chats" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Aviso error={lista.error} />
        <div className="filas">
          {filas.map((c) => (
            <button key={c.id} className={['fila', c.id === abierto && 'activa', c.escalado && 'escalada'].filter(Boolean).join(' ')} onClick={() => setAbierto(c.id)}>
              <Avatar texto={nombreContacto(c)} alerta={c.escalado} />
              <span className="fila-titulo">{nombreContacto(c)}</span>
              <span className="fila-fecha">{fecha(c.ultimoEn)}</span>
              <span className="fila-sub">
                {c.ultimaDireccion === 'SALIENTE' ? 'Asistente: ' : ''}
                {c.ultimoMensaje ?? ''}
              </span>
              <span className="fila-etiquetas">
                {c.escalado && <span className="etiqueta alerta">escalado</span>}
                {c.rol === 'EQUIPO' && <span className="etiqueta">equipo</span>}
                {c.modo !== 'BOT' && <span className="etiqueta humano">pausado</span>}
              </span>
            </button>
          ))}
          {lista.datos && !filas.length && <Vacio>{busca ? 'Ningún chat coincide con la búsqueda.' : 'Sin chats todavía.'}</Vacio>}
        </div>
      </div>
      {abierto ? (
        <Detalle base={base} id={abierto} alCerrar={() => setAbierto(null)} alCambiar={lista.recargar} />
      ) : (
        <div className="detalle sin-seleccion">
          <div>
            <Icono nombre="chats" tam={32} />
            <p>Elige un chat para ver la conversación.</p>
          </div>
        </div>
      )}
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

  if (!d.datos) return <div className="detalle cargando">Cargando…</div>;
  const c = d.datos;
  return (
    <div className="detalle">
      <div className="detalle-cabecera">
        <button className="secundario solo-movil chico" aria-label="Volver a la lista" onClick={alCerrar}>
          <Icono nombre="volver" tam={16} />
        </button>
        <Avatar texto={nombreContacto(c)} alerta={c.escalamientos.length > 0} />
        <div style={{ minWidth: 0 }}>
          <strong>{nombreContacto(c)}</strong>
          {c.nombre && <div className="tenue">{c.telefono ? `+${c.telefono}` : c.jid}</div>}
        </div>
        <span className="espacio" />
        <div className="botones detalle-acciones">
          {c.modo === 'BOT' ? (
            <button className="secundario chico" onClick={() => accion(() => api.post(`${base}/contactos/${id}/pausar`))}>
              <Icono nombre="pausa" tam={16} />
              Pausar bot
            </button>
          ) : (
            <button className="chico" onClick={() => accion(() => api.post(`${base}/contactos/${id}/devolver-al-bot`))}>
              <Icono nombre="play" tam={16} />
              Devolver al bot
            </button>
          )}
          <button
            className="peligro chico"
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
            <Icono nombre="reiniciar" tam={16} />
            Reiniciar
          </button>
        </div>
      </div>
      <div className="detalle-info">
        <span className={c.modo === 'BOT' ? 'etiqueta bot' : 'etiqueta humano'}>{c.modo === 'BOT' ? 'Atiende el bot' : 'Bot pausado: atiende una persona'}</span>
        <label className="en-linea">
          Rol
          <select value={c.rol} onChange={(e) => accion(() => api.patch(`${base}/contactos/${id}`, { rol: e.target.value }))}>
            <option value="CLIENTE">Cliente</option>
            <option value="EQUIPO">Equipo</option>
          </select>
        </label>
      </div>
      {c.escalamientos.length > 0 && (
        <p className="alerta-caja">
          <Icono nombre="escalamientos" />
          <span>
            <strong>Escalado:</strong> {c.escalamientos.map((e) => e.motivo).join(' · ')}
          </span>
        </p>
      )}
      {c.resumen && (
        <details className="resumen">
          <summary>Lo que el asistente recuerda de este contacto</summary>
          <pre>{c.resumen}</pre>
        </details>
      )}
      <div style={{ padding: '0 18px' }}>
        <Aviso error={error ?? d.error} />
      </div>
      <div className="mensajes">
        {c.mensajes.map((m) => (
          <div key={m.id} className={m.direccion === 'ENTRANTE' ? 'burbuja entrante' : 'burbuja saliente'}>
            <div>{m.contenido}</div>
            <div className="hora">{fecha(m.creadoEn)}</div>
          </div>
        ))}
        <div ref={fin} />
      </div>
      <p className="tenue pie">
        <Icono nombre="whatsapp" tam={16} />
        Para responder, escribe desde el WhatsApp del asistente.
      </p>
    </div>
  );
}
