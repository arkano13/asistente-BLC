import { useEffect, useState } from 'react';
import { api, ErrorApi, type Sesion } from './api';
import { Acceso } from './vistas/Acceso';
import { Chats } from './vistas/Chats';
import { Conocimiento } from './vistas/Conocimiento';
import { Escalamientos } from './vistas/Escalamientos';
import { Leads } from './vistas/Leads';
import { Usuarios } from './vistas/Usuarios';
import { WhatsApp } from './vistas/WhatsApp';

const SECCIONES = [
  { id: 'whatsapp', titulo: 'WhatsApp y filtro' },
  { id: 'chats', titulo: 'Chats' },
  { id: 'escalamientos', titulo: 'Escalamientos' },
  { id: 'leads', titulo: 'Leads' },
  { id: 'conocimiento', titulo: 'Conocimiento' },
  { id: 'usuarios', titulo: 'Usuarios' },
] as const;
type Seccion = (typeof SECCIONES)[number]['id'];

const seccionDeUrl = (): Seccion => {
  const h = location.hash.slice(1) as Seccion;
  return SECCIONES.some((s) => s.id === h) ? h : 'whatsapp';
};

export function App() {
  const [sesion, setSesion] = useState<Sesion | null | undefined>(undefined);
  const [seccion, setSeccion] = useState<Seccion>(seccionDeUrl);
  const [menuAbierto, setMenuAbierto] = useState(false);

  useEffect(() => {
    api
      .get<Sesion>('/auth/yo')
      .then(setSesion)
      .catch((e) => setSesion(e instanceof ErrorApi && e.status === 401 ? null : null));
    const alCambiar = () => setSeccion(seccionDeUrl());
    addEventListener('hashchange', alCambiar);
    return () => removeEventListener('hashchange', alCambiar);
  }, []);

  if (sesion === undefined) return <div className="cargando">Cargando…</div>;
  if (!sesion) return <Acceso alEntrar={setSesion} />;

  const base = `/empresas/${encodeURIComponent(sesion.empresaId)}`;
  const salir = async () => {
    await api.post('/auth/logout');
    setSesion(null);
  };

  return (
    <div className="app">
      <header className="barra">
        <button className="hamburguesa" aria-label="Menú" onClick={() => setMenuAbierto((v) => !v)}>
          ☰
        </button>
        <strong>Asistente BLC</strong>
        <span className="espacio" />
        <span className="tenue">{sesion.nombre}</span>
        <button className="secundario" onClick={salir}>
          Salir
        </button>
      </header>
      <nav className={menuAbierto ? 'menu abierto' : 'menu'}>
        {SECCIONES.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={s.id === seccion ? 'activo' : ''}
            onClick={() => setMenuAbierto(false)}
          >
            {s.titulo}
          </a>
        ))}
      </nav>
      <main className="contenido">
        {seccion === 'whatsapp' && <WhatsApp base={base} />}
        {seccion === 'chats' && <Chats base={base} />}
        {seccion === 'escalamientos' && <Escalamientos base={base} />}
        {seccion === 'leads' && <Leads base={base} />}
        {seccion === 'conocimiento' && <Conocimiento base={base} />}
        {seccion === 'usuarios' && <Usuarios base={base} sesion={sesion} />}
      </main>
    </div>
  );
}
