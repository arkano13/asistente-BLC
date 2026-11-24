import type { Lead } from '../api';
import { Aviso, fecha, useDatos } from '../util';

export function Leads({ base }: { base: string }) {
  const { datos, error } = useDatos<Lead[]>(`${base}/leads`, 30_000);
  return (
    <section>
      <h2>Leads</h2>
      <p className="tenue">Prospectos que el asistente registró. Los precios y propuestas los da el equipo.</p>
      <Aviso error={error} />
      {datos && !datos.length && <p className="tenue">Todavía no hay leads.</p>}
      <div className="tabla">
        {datos?.map((l) => (
          <div key={l.id} className="tarjeta">
            <strong>{l.contacto.nombre ?? 'Sin nombre'}</strong>{' '}
            <span className="tenue">
              {l.contacto.telefono ? `+${l.contacto.telefono}` : ''} · {fecha(l.creadoEn)}
            </span>
            <div>Interés: {l.interes}</div>
            {l.email && <div>Email: {l.email}</div>}
            {l.presupuesto && <div>Presupuesto: {l.presupuesto}</div>}
            {l.notas && <div className="tenue">{l.notas}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
