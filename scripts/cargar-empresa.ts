import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../src/db/prisma.js';
import { cargarDocumento } from '../src/knowledge/index.js';

/**
 * Sincroniza una empresa desde la carpeta empresas/<id>/:
 *   empresa.json        perfil, horario y configuración (las claves que empiezan con _ son notas)
 *   conocimiento/*.md   cada "# Título" es un documento; "<!-- audiencia: EQUIPO -->" lo marca como interno
 * Es idempotente: reemplaza el conocimiento anterior de esa empresa.
 * Uso: node dist/scripts/cargar-empresa.js blc
 */
const id = process.argv[2];
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

await prisma.documento.deleteMany({ where: { empresaId: id } });
let total = 0;
for (const archivo of (await readdir(join(dir, 'conocimiento'))).filter((f) => f.endsWith('.md')).sort()) {
  const texto = await readFile(join(dir, 'conocimiento', archivo), 'utf8');
  const audiencia = /<!--\s*audiencia:\s*EQUIPO\s*-->/.test(texto) ? 'EQUIPO' : 'TODOS';
  for (const seccion of texto.split(/^# /m).filter((s) => s.trim())) {
    const [titulo, ...cuerpo] = seccion.split('\n');
    await cargarDocumento(id, titulo.trim(), cuerpo.join('\n').replace(/<!--.*?-->/g, '').trim(), audiencia);
    total++;
  }
}
console.log(`empresa ${id} sincronizada: ${total} documentos de conocimiento`);
await prisma.$disconnect();
