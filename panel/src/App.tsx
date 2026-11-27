import { useEffect, useState } from 'react';
import { api, ErrorApi, type Escalamiento, type Sesion } from './api';
import { Icono } from './iconos';
import { Avatar, useDatos } from './util';
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
  return <Panel sesion={sesion} seccion={seccion} menuAbierto={menuAbierto} setMenuAbierto={setMenuAbierto} setSesion={setSesion} />;
}

function Panel({
  sesion,
  seccion,
  menuAbierto,
  setMenuAbierto,
  setSesion,
}: {
  sesion: Sesion;
  seccion: Seccion;
  menuAbierto: boolean;
  setMenuAbierto: (f: (v: boolean) => boolean) => void;
  setSesion: (s: Sesion | null) => void;
}) {
  const base = `/empresas/${encodeURIComponent(sesion.empresaId)}`;
  // Contador de escalamientos abiertos en el menú: lo primero que el equipo debe atender.
  const abiertos = useDatos<Escalamiento[]>(`${base}/escalamientos`, 30_000).datos?.length ?? 0;
  const titulo = SECCIONES.find((s) => s.id === seccion)?.titulo;
  const salir = async () => {
    await api.post('/auth/logout');
    setSesion(null);
  };

  const cerrar = () => setMenuAbierto(() => false);

  return (
    <div className="app">
      <header className="barra-movil">
        <button aria-label="Abrir menú" aria-expanded={menuAbierto} onClick={() => setMenuAbierto((v) => !v)}>
          <Icono nombre="menu" tam={22} />
          {abiertos > 0 && <span className="punto" aria-label={`${abiertos} escalamientos abiertos`} />}
        </button>
        <img className="logo" src="/logo-blc-blanco.png" alt="BLC" />
        <span className="seccion-actual">{titulo}</span>
      </header>
      {menuAbierto && <div className="velo" onClick={cerrar} />}
      <aside className={menuAbierto ? 'menu abierto' : 'menu'}>
        <img className="menu-logo" src="/logo-blc-blanco.png" alt="BLC Building Leaders Company" />
        <p className="menu-producto">Asistente</p>
        <nav aria-label="Secciones">
          {SECCIONES.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={s.id === seccion ? 'activo' : ''} aria-current={s.id === seccion ? 'page' : undefined} onClick={cerrar}>
              <Icono nombre={s.id} />
              {s.titulo}
              {s.id === 'escalamientos' && abiertos > 0 && <span className="contador">{abiertos}</span>}
            </a>
          ))}
        </nav>
        <div className="menu-usuario">
          <Avatar texto={sesion.nombre} />
          <div>
            <strong>{sesion.nombre}</strong>
            <span>Equipo BLC</span>
          </div>
          <button aria-label="Salir" title="Salir" onClick={salir}>
            <Icono nombre="salir" />
          </button>
        </div>
      </aside>
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
