import { useState } from 'react';
import { api, type Escalamiento } from '../api';
import { Aviso, fecha, nombreContacto, useDatos } from '../util';

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
      <h2>Escalamientos abiertos</h2>
      <p className="tenue">Chats que el asistente pasó a una persona. Respóndelos desde el WhatsApp del asistente.</p>
      <Aviso error={error ?? errAccion} />
      {datos && !datos.length && <p className="tenue">No hay escalamientos abiertos.</p>}
      <div className="tabla">
        {datos?.map((e) => (
          <div key={e.id} className="tarjeta fila-tabla">
            <div>
              <strong>{nombreContacto(e.contacto)}</strong> <span className="tenue">{fecha(e.creadoEn)}</span>
              <div>{e.motivo}</div>
            </div>
            <button onClick={() => devolver(e.contacto.id)}>Resuelto: devolver al bot</button>
          </div>
        ))}
      </div>
    </section>
  );
}
