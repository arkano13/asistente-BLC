// Cliente de la API del core. La sesión viaja en una cookie HttpOnly: aquí no hay claves.

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown, extra?: Record<string, string>): Promise<T> {
  const r = await fetch(ruta, {
    method: metodo,
    credentials: 'same-origin',
    headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new ErrorApi(r.status, datos?.error ?? `Error ${r.status}`);
  return datos as T;
}

export const api = {
  get: <T>(ruta: string) => llamar<T>('GET', ruta),
  post: <T>(ruta: string, cuerpo?: unknown, extra?: Record<string, string>) => llamar<T>('POST', ruta, cuerpo ?? {}, extra),
  put: <T>(ruta: string, cuerpo: unknown) => llamar<T>('PUT', ruta, cuerpo),
  patch: <T>(ruta: string, cuerpo: unknown) => llamar<T>('PATCH', ruta, cuerpo),
  del: <T>(ruta: string) => llamar<T>('DELETE', ruta),
};

export interface Sesion {
  usuarioId?: string;
  empresaId: string;
  email: string;
  nombre: string;
}

export interface Empresa {
  id: string;
  nombre: string;
  zonaHoraria: string;
  filtroModo: 'TODOS' | 'SOLO_LISTA' | 'EXCLUIR_LISTA';
  filtroNumeros: string[];
}

export interface FilaContacto {
  id: string;
  nombre: string | null;
  telefono: string | null;
  jid: string;
  rol: 'CLIENTE' | 'EQUIPO';
  modo: 'BOT' | 'HUMANO';
  ultimoMensaje: string | null;
  ultimaDireccion: 'ENTRANTE' | 'SALIENTE' | null;
  ultimoEn: string | null;
  escalado: boolean;
}

export interface Mensaje {
  id: string;
  direccion: 'ENTRANTE' | 'SALIENTE';
  contenido: string;
  creadoEn: string;
}

export interface DetalleContacto extends Omit<FilaContacto, 'ultimoMensaje' | 'ultimaDireccion' | 'ultimoEn' | 'escalado'> {
  resumen: string | null;
  mensajes: Mensaje[];
  escalamientos: { id: string; motivo: string; creadoEn: string }[];
}

export interface Escalamiento {
  id: string;
  motivo: string;
  creadoEn: string;
  contacto: { id: string; nombre: string | null; telefono: string | null; jid: string; modo: string };
}

export interface Lead {
  id: string;
  interes: string;
  email: string | null;
  presupuesto: string | null;
  notas: string | null;
  estado: string;
  creadoEn: string;
  contacto: { id: string; nombre: string | null; telefono: string | null };
}

export interface Documento {
  id: string;
  titulo: string;
  contenido: string;
  audiencia: 'TODOS' | 'EQUIPO';
}

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  creadoEn: string;
  ultimoAcceso: string | null;
}
