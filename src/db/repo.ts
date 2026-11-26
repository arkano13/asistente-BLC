import { prisma, type Contacto, type Empresa } from './prisma.js';

export type { Contacto, Empresa };

/** Identidad y reglas del asistente: sale de las fases F1-F6 de la metodología BLC. */
export interface Perfil {
  nombreAsistente?: string;
  resumenEmpresa?: string;
  personalidad?: string[];
  tono?: string;
  saludo?: string;
  servicios?: string[];
  reglas?: string[];
  prohibido?: string[];
  informacionRestringida?: string[];
  /** Biblioteca de mensajes oficiales: el agente adapta el texto sin cambiar su intención. */
  mensajesOficiales?: { situacion: string; texto: string }[];
  instruccionesEquipo?: string;
  /** Rutas comerciales de la empresa (qué se precalifica, qué se vende directo, ruta por intención). */
  modeloComercial?: string[];
}

/** dias: "0"=domingo ... "6"=sábado -> ["09:00","17:00"]. */
export interface Horario {
  /** Franjas en que el agente puede agendar reuniones. Sin `dias`, el agente no agenda: deriva al equipo. */
  dias?: Record<string, [string, string] | null>;
  minutosPorCita?: number;
  tiposReunion?: string[];
  /** Horario de atención humana (el agente atiende 24/7). */
  atencionHumana?: { dias: Record<string, [string, string] | null>; descripcion: string };
}

/** El agente agenda solo si la empresa definió franjas de agenda. */
export const agendaActiva = (e: Empresa) => Object.values(horarioDe(e).dias ?? {}).some(Boolean);

/** ¿Hay atención humana en este momento, según la zona horaria de la empresa? */
export function enHorarioHumano(e: Empresa, ahora = new Date()) {
  const h = horarioDe(e).atencionHumana;
  if (!h) return true;
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: e.zonaHoraria, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(ahora)
      .map((p) => [p.type, p.value]),
  );
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday);
  const rango = h.dias[String(dia)];
  const hhmm = `${partes.hour}:${partes.minute}`;
  return Boolean(rango && hhmm >= rango[0] && hhmm < rango[1]);
}

export const perfilDe = (e: Empresa) => (e.perfil ?? {}) as Perfil;
export const horarioDe = (e: Empresa) => (e.horario ?? {}) as Horario;

export const getEmpresa = (id: string) => prisma.empresa.findUnique({ where: { id } });

export const empresasActivas = () => prisma.empresa.findMany({ where: { waActivo: true }, select: { id: true } });

/** Busca el contacto por cualquiera de sus jid (número o LID). */
export const buscarContacto = (empresaId: string, jids: string[]) =>
  prisma.contacto.findFirst({ where: { empresaId, jid: { in: [...new Set(jids)] } }, orderBy: { creadoEn: 'asc' } });

/** alterno: el LID con que llegó el chat; si existe un contacto viejo guardado con él, se reutiliza. */
export async function upsertContacto(empresaId: string, jid: string, telefono: string | null, nombre: string | null, alterno?: string) {
  const existente = await buscarContacto(empresaId, alterno ? [jid, alterno] : [jid]);
  if (existente) {
    if ((!existente.telefono && telefono) || (!existente.nombre && nombre)) {
      return prisma.contacto.update({
        where: { id: existente.id },
        data: { telefono: existente.telefono ?? telefono, nombre: existente.nombre ?? nombre },
      });
    }
    return existente;
  }
  return prisma.contacto.upsert({
    where: { empresaId_jid: { empresaId, jid } },
    create: { empresaId, jid, telefono, nombre },
    update: {},
  });
}

/** Un teléfono que está en avisarA de la empresa pasa a rol EQUIPO automáticamente. */
export async function sincronizarRol(contacto: Contacto, empresa: Empresa) {
  const telefonosEquipo = empresa.avisarA.map((j) => j.split('@')[0]);
  if (contacto.telefono && telefonosEquipo.includes(contacto.telefono) && contacto.rol !== 'EQUIPO') {
    return prisma.contacto.update({ where: { id: contacto.id }, data: { rol: 'EQUIPO' } });
  }
  return contacto;
}

export const getContacto = (empresaId: string, jid: string) =>
  prisma.contacto.findUnique({ where: { empresaId_jid: { empresaId, jid } } });

/** Guarda un mensaje entrante. false si ya existía (Baileys puede repetir eventos). */
export async function guardarEntrante(empresaId: string, contactoId: string, contenido: string, waId: string) {
  const r = await prisma.mensaje.createMany({
    data: [{ empresaId, contactoId, direccion: 'ENTRANTE', contenido, waId }],
    skipDuplicates: true,
  });
  return r.count > 0;
}

export const guardarSaliente = (empresaId: string, contactoId: string, contenido: string) =>
  prisma.mensaje.create({ data: { empresaId, contactoId, direccion: 'SALIENTE', contenido, procesado: true } });

export const pendientes = (contactoId: string) =>
  prisma.mensaje.findMany({ where: { contactoId, direccion: 'ENTRANTE', procesado: false }, orderBy: { id: 'asc' } });

export const marcarProcesados = (ids: bigint[]) =>
  prisma.mensaje.updateMany({ where: { id: { in: ids } }, data: { procesado: true } });

/** Últimos N mensajes ya procesados, en orden cronológico. */
export async function historial(contactoId: string, limite: number) {
  const filas = await prisma.mensaje.findMany({
    where: { contactoId, OR: [{ direccion: 'SALIENTE' }, { procesado: true }] },
    orderBy: { id: 'desc' },
    take: limite,
  });
  return filas.reverse();
}

/** Deja solo dígitos: "+504 9999-9999" -> "50499999999". */
export const soloDigitos = (t: string) => t.replace(/\D/g, '');

/**
 * ¿El agente debe atender este número? TODOS: sí. SOLO_LISTA: solo si está en la lista
 * (sin número conocido, no). EXCLUIR_LISTA: todos menos los de la lista.
 */
export function numeroPermitido(e: Pick<Empresa, 'filtroModo' | 'filtroNumeros'>, telefono: string | null) {
  if (e.filtroModo === 'TODOS') return true;
  const enLista = Boolean(telefono) && e.filtroNumeros.map(soloDigitos).includes(soloDigitos(telefono!));
  return e.filtroModo === 'SOLO_LISTA' ? enLista : !enLista;
}
