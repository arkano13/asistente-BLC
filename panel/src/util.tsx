import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { Icono } from './iconos';

/** Carga datos de la API y expone recargar(). Con `cadaMs` refresca solo. */
export function useDatos<T>(ruta: string | null, cadaMs?: number) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recargar = useCallback(async () => {
    if (!ruta) return;
    try {
      setDatos(await api.get<T>(ruta));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [ruta]);
  useEffect(() => {
    void recargar();
    if (!cadaMs) return;
    const t = setInterval(recargar, cadaMs);
    return () => clearInterval(t);
  }, [recargar, cadaMs]);
  return { datos, error, recargar, setDatos };
}

export const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'short' }) : '';

export const nombreContacto = (c: { nombre: string | null; telefono: string | null; jid: string }) =>
  c.nombre || (c.telefono ? `+${c.telefono}` : c.jid.split('@')[0]);

export function Aviso({ error }: { error: string | null }) {
  return error ? <p className="error">{error}</p> : null;
}

/** Iniciales para el avatar: dos letras del nombre o los últimos dígitos del número. */
export function Avatar({ texto, alerta = false }: { texto: string; alerta?: boolean }) {
  const palabras = texto.replace(/^\+/, '').split(/\s+/).filter(Boolean);
  const ini = /^\d/.test(palabras[0] ?? '')
    ? (palabras[0] ?? '').slice(-2)
    : palabras.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return (
    <span className={alerta ? 'avatar alerta' : 'avatar'} aria-hidden="true">
      {ini || '?'}
    </span>
  );
}

/** Encabezado de sección como en blcleaders.com: etiqueta con línea turquesa, título y descripción. */
export function Encabezado({ etiqueta, titulo, children, accion }: { etiqueta: string; titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <header className="encabezado">
      <div>
        <p className="kicker">{etiqueta}</p>
        <h2>{titulo}</h2>
        {children && <p className="descripcion">{children}</p>}
      </div>
      {accion}
    </header>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return (
    <div className="vacio">
      <Icono nombre="vacio" tam={28} />
      <p>{children}</p>
    </div>
  );
}
