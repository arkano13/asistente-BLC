import type Anthropic from '@anthropic-ai/sdk';
import { prisma, type Contacto, type Empresa, type Rol } from '../db/prisma.js';
import { agendaActiva, enHorarioHumano, horarioDe } from '../db/repo.js';
import { buscar } from '../knowledge/index.js';
import { enviarTexto, marcarNoLeido } from '../queue/index.js';

export interface Contexto {
  empresa: Empresa;
  contacto: Contacto;
}

interface Herramienta {
  def: Anthropic.Tool | ((e: Empresa) => Anthropic.Tool);
  roles: Rol[];
  /** Si existe y devuelve false, la herramienta no se ofrece a esa empresa. */
  activa?: (e: Empresa) => boolean;
  run: (input: any, ctx: Contexto) => Promise<unknown>;
}

const esquema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
});

const FECHA = { type: 'string', description: 'Fecha YYYY-MM-DD en la zona horaria del negocio' };

const herramientas: Herramienta[] = [
  {
    roles: ['CLIENTE', 'EQUIPO'],
    def: {
      name: 'buscar_conocimiento',
      description:
        'Busca en la base de conocimiento oficial de la empresa (servicios, precios, políticas, procesos). Úsala antes de dar cualquier dato concreto; no inventes datos que no aparezcan aquí.',
      input_schema: esquema({ consulta: { type: 'string', description: 'Pregunta o palabras clave en español' } }, ['consulta']),
      strict: true,
    },
    run: async ({ consulta }, { empresa, contacto }) => {
      const r = await buscar(empresa.id, consulta, contacto.rol);
      return r.length ? r.map((x) => x.contenido) : 'Sin resultados. Dilo con honestidad y ofrece escalar a una persona.';
    },
  },
  {
    roles: ['CLIENTE', 'EQUIPO'],
    activa: agendaActiva,
    def: {
      name: 'consultar_disponibilidad',
      description: 'Devuelve los horarios libres para citas en una fecha.',
      input_schema: esquema({ fecha: FECHA }, ['fecha']),
      strict: true,
    },
    run: async ({ fecha }, { empresa }) => ({ fecha, libres: await horariosLibres(empresa, fecha) }),
  },
  {
    roles: ['CLIENTE', 'EQUIPO'],
    activa: agendaActiva,
    def: (e) => ({
      name: 'agendar_cita',
      description: 'Agenda una reunión confirmada. Antes confirma con la persona el tipo de reunión, la fecha y la hora.',
      input_schema: esquema(
        {
          fecha: FECHA,
          hora: { type: 'string', description: 'HH:MM, uno de los horarios libres' },
          servicio: horarioDe(e).tiposReunion?.length
            ? { type: 'string', enum: horarioDe(e).tiposReunion, description: 'Tipo de reunión' }
            : { type: 'string', description: 'Tipo de reunión' },
          nombre: { type: 'string', description: 'Nombre de la persona' },
          notas: { type: 'string' },
        },
        ['fecha', 'hora', 'servicio', 'nombre', 'notas'],
      ),
      strict: true,
    }),
    run: async ({ fecha, hora, servicio, nombre, notas }, { empresa, contacto }) => {
      if (!(await horariosLibres(empresa, fecha)).includes(hora)) return { ok: false, error: 'Horario no disponible' };
      const minutos = horarioDe(empresa).minutosPorCita ?? 60;
      const [{ inicio }] = await prisma.$queryRaw<{ inicio: Date }[]>`
        SELECT ((${fecha} || ' ' || ${hora})::timestamp AT TIME ZONE ${empresa.zonaHoraria}) AS inicio`;
      try {
        const cita = await prisma.cita.create({
          data: { empresaId: empresa.id, contactoId: contacto.id, inicio, fin: new Date(inicio.getTime() + minutos * 60_000), servicio, notas },
        });
        await prisma.contacto.update({ where: { id: contacto.id }, data: { nombre } });
        await avisarEquipo(empresa, `Nueva cita: ${nombre} (${contacto.telefono ?? contacto.jid}) el ${fecha} ${hora}, ${servicio}.`);
        return { ok: true, id: cita.id };
      } catch {
        return { ok: false, error: 'Ese horario se acaba de ocupar; ofrece otro.' };
      }
    },
  },
  {
    roles: ['CLIENTE'],
    def: {
      name: 'registrar_lead',
      description: 'Registra a un prospecto con interés comercial para que ventas le dé seguimiento.',
      input_schema: esquema(
        {
          interes: { type: 'string', description: 'Servicio o necesidad concreta' },
          nombre: { type: 'string' },
          organizacion: { type: 'string', description: 'Empresa u organización; cadena vacía si no aplica' },
          email: { type: 'string', description: 'Cadena vacía si no lo dio' },
          presupuesto: { type: 'string', description: 'Cadena vacía si no lo dio' },
          notas: { type: 'string' },
        },
        ['interes', 'nombre', 'organizacion', 'email', 'presupuesto', 'notas'],
      ),
      strict: true,
    },
    run: async ({ interes, nombre, organizacion, email, presupuesto, notas }, { empresa, contacto }) => {
      await prisma.lead.create({
        data: {
          empresaId: empresa.id,
          contactoId: contacto.id,
          interes,
          email: email || null,
          presupuesto: presupuesto || null,
          notas: [organizacion && `Organización: ${organizacion}`, notas].filter(Boolean).join('\n'),
        },
      });
      if (nombre) await prisma.contacto.update({ where: { id: contacto.id }, data: { nombre } });
      await avisarEquipo(empresa, `Nuevo lead: ${nombre} (${contacto.telefono ?? contacto.jid}) interesado en ${interes}.`);
      return { ok: true };
    },
  },
  {
    roles: ['CLIENTE', 'EQUIPO'],
    def: {
      name: 'escalar_a_humano',
      description:
        'Transfiere la conversación a una persona del equipo. Úsala si la persona lo pide, si hay una queja, un tema sensible o algo que no puedes resolver con la base de conocimiento.',
      input_schema: esquema({ motivo: { type: 'string' } }, ['motivo']),
      strict: true,
    },
    run: async ({ motivo }, { empresa, contacto }) => {
      await prisma.$transaction([
        prisma.escalamiento.create({ data: { empresaId: empresa.id, contactoId: contacto.id, motivo } }),
        prisma.contacto.update({ where: { id: contacto.id }, data: { modo: 'HUMANO' } }),
      ]);
      // El equipo responde desde el mismo WhatsApp: el chat queda como no leído para que lo vea.
      await marcarNoLeido(empresa.id, contacto.jid);
      await avisarEquipo(empresa, `Escalamiento: ${contacto.nombre ?? ''} (${contacto.telefono ?? contacto.jid}). Motivo: ${motivo}`);
      const enHorario = enHorarioHumano(empresa);
      return {
        ok: true,
        dentro_de_horario: enHorario,
        mensaje: enHorario
          ? 'Usa el mensaje de transferencia humana: una persona del equipo continuará por este mismo medio.'
          : `Usa el mensaje de transferencia humana y aclara que el equipo atiende ${horarioDe(empresa).atencionHumana?.descripcion ?? 'en horario laboral'} y responderá en el siguiente horario hábil.`,
      };
    },
  },
  {
    roles: ['EQUIPO'],
    def: {
      name: 'resumen_comercial',
      description: 'Uso interno: leads, citas y escalamientos abiertos de los últimos N días.',
      input_schema: esquema({ dias: { type: 'integer', description: 'Días hacia atrás, 1 a 90' } }, ['dias']),
      strict: true,
    },
    run: async ({ dias }, { empresa }) => {
      const desde = new Date(Date.now() - Math.min(Math.max(Number(dias) || 7, 1), 90) * 86_400_000);
      const [leads, citas, escalamientos] = await Promise.all([
        prisma.lead.findMany({ where: { empresaId: empresa.id, creadoEn: { gte: desde } }, select: { interes: true, estado: true, creadoEn: true }, take: 30 }),
        prisma.cita.findMany({ where: { empresaId: empresa.id, inicio: { gte: desde } }, select: { inicio: true, servicio: true, estado: true }, take: 30 }),
        prisma.escalamiento.findMany({ where: { empresaId: empresa.id, estado: 'ABIERTO' }, select: { motivo: true, creadoEn: true }, take: 30 }),
      ]);
      return { leads, citas, escalamientos };
    },
  },
];

const defDe = (h: Herramienta, e: Empresa) => (typeof h.def === 'function' ? h.def(e) : h.def);

const permitida = (h: Herramienta, e: Empresa, rol: Rol) => h.roles.includes(rol) && (h.activa?.(e) ?? true);

export const herramientasPara = (empresa: Empresa, rol: Rol) =>
  herramientas.filter((h) => permitida(h, empresa, rol)).map((h) => defDe(h, empresa));

export async function ejecutarHerramienta(nombre: string, input: unknown, ctx: Contexto) {
  const h = herramientas.find((t) => defDe(t, ctx.empresa).name === nombre && permitida(t, ctx.empresa, ctx.contacto.rol));
  if (!h) throw new Error(`Herramienta no permitida: ${nombre}`);
  return h.run(input, ctx);
}

/** Genera la grilla del día en la zona de la empresa y resta citas confirmadas (en SQL, sin librerías de fechas). */
async function horariosLibres(empresa: Empresa, fecha: string): Promise<string[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return [];
  const h = horarioDe(empresa);
  const minutos = h.minutosPorCita ?? 60;
  const rango = h.dias?.[String(new Date(`${fecha}T12:00:00Z`).getUTCDay())];
  if (!rango) return [];
  const filas = await prisma.$queryRaw<{ hora: string }[]>`
    SELECT to_char(s, 'HH24:MI') AS hora
    FROM generate_series((${fecha} || ' ' || ${rango[0]})::timestamp,
                         (${fecha} || ' ' || ${rango[1]})::timestamp - make_interval(mins => ${minutos}::int),
                         make_interval(mins => ${minutos}::int)) AS s
    WHERE (s AT TIME ZONE ${empresa.zonaHoraria}) > now()
      AND NOT EXISTS (
        SELECT 1 FROM citas c
        WHERE c.empresa_id = ${empresa.id} AND c.estado = 'CONFIRMADA'
          AND c.inicio < (s AT TIME ZONE ${empresa.zonaHoraria}) + make_interval(mins => ${minutos}::int)
          AND c.fin > (s AT TIME ZONE ${empresa.zonaHoraria}))
    ORDER BY s`;
  return filas.map((f) => f.hora);
}

async function avisarEquipo(empresa: Empresa, texto: string) {
  await Promise.all(empresa.avisarA.map((jid) => enviarTexto(empresa.id, jid, texto)));
}
