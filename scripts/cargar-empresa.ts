import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../src/db/prisma.js';
import { cargarDocumento } from '../src/knowledge/index.js';

/**
 * Sincroniza una empresa desde la carpeta empresas/<id>/:
 *   empresa.json        perfil, horario y configuración (las claves que empiezan con _ son notas)
 *   conocimiento/*.md   cada "# Título" es un documento; "<!-- audiencia: EQUIPO -->" lo marca como interno
 * Perfil y horario se sincronizan siempre. El conocimiento se reemplaza completo, salvo con
 * --si-vacio: entonces solo se carga si la empresa no tiene documentos (para no pisar lo editado en el panel).
 * Uso: node dist/scripts/cargar-empresa.js blc [--si-vacio]
 */
const id = process.argv[2];
const siVacio = process.argv.includes('--si-vacio');
if (!id) throw new Error('Uso: cargar-empresa <id>');
const dir = join(process.cwd(), 'empresas', id);
const sinNotas = (o: unknown): unknown =>
  Array.isArray(o) ? o.map(sinNotas) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, sinNotas(v)])) : o;

const e = sinNotas(JSON.parse(await readFile(join(dir, 'empresa.json'), 'utf8'))) as Record<string, any>;
const data = {
  nombre: e.nombre,
  zonaHoraria: e.zonaHoraria,
  modelo: e.modelo ?? null,
  esfuerzo: e.esfuerzo ?? null,
  perfil: e.perfil ?? {},
  horario: e.horario ?? {},
  avisarA: e.avisarA ?? [],
};
await prisma.empresa.upsert({ where: { id }, create: { id, ...data }, update: data });

// Documentos cargados antes de guardar el texto original (contenido vacío) se recargan una vez.
const [docs, sinTexto] = await Promise.all([
  prisma.documento.count({ where: { empresaId: id } }),
  prisma.documento.count({ where: { empresaId: id, contenido: '' } }),
]);
// Con --si-vacio el conocimiento editado en el panel se respeta: solo se agregan secciones nuevas
// (títulos que no existen). Sin la bandera, o con documentos sin texto, se recarga todo.
const soloNuevos = siVacio && docs > 0 && sinTexto === 0;
const existentes = new Set(
  soloNuevos ? (await prisma.documento.findMany({ where: { empresaId: id }, select: { titulo: true } })).map((d) => d.titulo) : [],
);
if (!soloNuevos) await prisma.documento.deleteMany({ where: { empresaId: id } });
let total = 0;
for (const archivo of (await readdir(join(dir, 'conocimiento'))).filter((f) => f.endsWith('.md')).sort()) {
  const texto = await readFile(join(dir, 'conocimiento', archivo), 'utf8');
  const audiencia = /<!--\s*audiencia:\s*EQUIPO\s*-->/.test(texto) ? 'EQUIPO' : 'TODOS';
  for (const seccion of texto.split(/^# /m).filter((s) => s.trim())) {
    const [titulo, ...cuerpo] = seccion.split('\n');
    if (existentes.has(titulo.trim())) continue;
    await cargarDocumento(id, titulo.trim(), cuerpo.join('\n').replace(/<!--.*?-->/g, '').trim(), audiencia);
    total++;
  }
}
if (soloNuevos) {
  console.log(`empresa ${id} sincronizada; conocimiento del panel intacto, ${total} secciones nuevas agregadas`);
  await prisma.$disconnect();
  process.exit(0);
}
console.log(`empresa ${id} sincronizada: ${total} documentos de conocimiento`);
await prisma.$disconnect();
