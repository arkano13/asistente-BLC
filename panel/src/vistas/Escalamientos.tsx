import { useState } from 'react';
import { api, type Escalamiento } from '../api';
import { Icono } from '../iconos';
import { Avatar, Aviso, Encabezado, fecha, nombreContacto, useDatos, Vacio } from '../util';

export function Escalamientos({ base }: { base: string }) {
  const { datos, error, recargar } = useDatos<Escalamiento[]>(`${base}/escalamientos`, 10_000);
  const [errAccion, setErrAccion] = useState<string | null>(null);

  const devolver = async (contactoId: string) => {
    setErrAccion(null);
    try {
      await api.post(`${base}/contactos/${contactoId}/devolver-al-bot`);
      await recargar();
    } catch (e) {
      setErrAccion((e as Error).message);
    }
  };

  return (
    <section>
      <Encabezado etiqueta="Atención del equipo" titulo="Escalamientos">
        Chats en los que el asistente pidió a una persona. El bot sigue respondiendo; el chat queda sin leer en el WhatsApp del asistente hasta que alguien lo tome.
      </Encabezado>
      <Aviso error={error ?? errAccion} />
      {datos && !datos.length && <Vacio>No hay escalamientos abiertos. Todo está al día.</Vacio>}
      <div className="lista-tarjetas">
        {datos?.map((e) => (
          <div key={e.id} className="tarjeta fila-tabla">
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 0 }}>
              <Avatar texto={nombreContacto(e.contacto)} alerta />
              <div style={{ minWidth: 0 }}>
                <strong>{nombreContacto(e.contacto)}</strong>
                <p style={{ margin: '4px 0 0' }}>{e.motivo}</p>
                <div className="metas">
                  <span className="dato">{fecha(e.creadoEn)}</span>
                  {e.contacto.telefono && e.contacto.nombre && <span className="dato">+{e.contacto.telefono}</span>}
                </div>
              </div>
            </div>
            <button onClick={() => devolver(e.contacto.id)}>
              <Icono nombre="check" />
              Resuelto: devolver al bot
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
