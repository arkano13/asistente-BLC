import type { Lead } from '../api';
import { Icono } from '../iconos';
import { Avatar, Aviso, Encabezado, fecha, useDatos, Vacio } from '../util';

export function Leads({ base }: { base: string }) {
  const { datos, error } = useDatos<Lead[]>(`${base}/leads`, 30_000);
  return (
    <section>
      <Encabezado etiqueta="Prospectos" titulo="Leads">
        Personas que el asistente registró con su necesidad. Las propuestas y los precios los da el equipo.
      </Encabezado>
      <Aviso error={error} />
      {datos && !datos.length && <Vacio>Todavía no hay leads registrados.</Vacio>}
      <div className="lista-tarjetas">
        {datos?.map((l) => (
          <article key={l.id} className="tarjeta" style={{ display: 'flex', gap: 14 }}>
            <Avatar texto={l.contacto.nombre ?? l.contacto.telefono ?? '?'} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="botones" style={{ justifyContent: 'space-between' }}>
                <strong>{l.contacto.nombre ?? 'Sin nombre'}</strong>
                <span className="tenue">{fecha(l.creadoEn)}</span>
              </div>
              <p style={{ margin: '6px 0 0' }}>{l.interes}</p>
              <div className="metas">
                {l.contacto.telefono && (
                  <span className="dato">
                    <Icono nombre="telefono" tam={15} />+{l.contacto.telefono}
                  </span>
                )}
                {l.email && (
                  <span className="dato">
                    <Icono nombre="correo" tam={15} />
                    {l.email}
                  </span>
                )}
                {l.presupuesto && <span className="dato">Presupuesto: {l.presupuesto}</span>}
              </div>
              {l.notas && <p className="tenue" style={{ margin: '8px 0 0' }}>{l.notas}</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
