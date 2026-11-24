import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

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
