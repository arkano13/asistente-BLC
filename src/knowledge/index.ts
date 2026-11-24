import { prisma, type Audiencia, type Rol } from '../db/prisma.js';

/** Parte un documento en fragmentos de ~1.200 caracteres respetando párrafos. */
export function partirTexto(texto: string, max = 1200): string[] {
  const parrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const partes: string[] = [];
  let actual = '';
  for (const p of parrafos) {
    if (actual && actual.length + p.length + 2 > max) {
      partes.push(actual);
      actual = '';
    }
    if (p.length > max) {
      for (let i = 0; i < p.length; i += max) partes.push(p.slice(i, i + max));
    } else {
      actual = actual ? `${actual}\n\n${p}` : p;
    }
  }
  if (actual) partes.push(actual);
  return partes;
}

export async function cargarDocumento(empresaId: string, titulo: string, contenido: string, audiencia: Audiencia = 'TODOS') {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.documento.create({ data: { empresaId, titulo, audiencia } });
    await tx.fragmento.createMany({
      data: partirTexto(contenido).map((c) => ({ empresaId, documentoId: doc.id, audiencia, contenido: `${titulo}\n${c}` })),
    });
    return doc.id;
  });
}

/**
 * Búsqueda de texto completo en español (Postgres). Un cliente solo ve audiencia TODOS;
 * el equipo ve también la documentación interna. Punto de extensión: híbrida con pgvector.
 */
export async function buscar(empresaId: string, consulta: string, rol: Rol, limite = 5) {
  const audiencias = rol === 'EQUIPO' ? ['TODOS', 'EQUIPO'] : ['TODOS'];
  return prisma.$queryRaw<{ contenido: string; rank: number }[]>`
    WITH q AS (
      SELECT websearch_to_tsquery('spanish', ${consulta}) AS estricta,
             -- cada lexema entre comillas: un carácter raro en la consulta no rompe to_tsquery
             to_tsquery('spanish', array_to_string(ARRAY(SELECT quote_literal(l) FROM unnest(tsvector_to_array(to_tsvector('spanish', ${consulta}))) l), ' | ')) AS amplia)
    SELECT contenido, ts_rank(tsv, q.amplia) AS rank
    FROM fragmentos, q
    WHERE empresa_id = ${empresaId} AND audiencia::text = ANY(${audiencias})
      AND (tsv @@ q.estricta OR tsv @@ q.amplia)
    ORDER BY (tsv @@ q.estricta) DESC, rank DESC
    LIMIT ${limite}`;
}
