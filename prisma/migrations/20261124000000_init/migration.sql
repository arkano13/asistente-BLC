-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('CLIENTE', 'EQUIPO');

-- CreateEnum
CREATE TYPE "Modo" AS ENUM ('BOT', 'HUMANO');

-- CreateEnum
CREATE TYPE "Direccion" AS ENUM ('ENTRANTE', 'SALIENTE');

-- CreateEnum
CREATE TYPE "Audiencia" AS ENUM ('TODOS', 'EQUIPO');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('CONFIRMADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoEscalamiento" AS ENUM ('ABIERTO', 'CERRADO');

-- CreateTable
CREATE TABLE "empresas" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "wa_activo" BOOLEAN NOT NULL DEFAULT true,
    "modelo" TEXT,
    "esfuerzo" TEXT,
    "zona_horaria" TEXT NOT NULL DEFAULT 'America/Tegucigalpa',
    "perfil" JSONB NOT NULL DEFAULT '{}',
    "horario" JSONB NOT NULL DEFAULT '{}',
    "avisar_a" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wa_auth" (
    "empresa_id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,

    CONSTRAINT "wa_auth_pkey" PRIMARY KEY ("empresa_id","clave")
);

-- CreateTable
CREATE TABLE "contactos" (
    "id" UUID NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "telefono" TEXT,
    "nombre" TEXT,
    "rol" "Rol" NOT NULL DEFAULT 'CLIENTE',
    "modo" "Modo" NOT NULL DEFAULT 'BOT',
    "resumen" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contactos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "contacto_id" UUID NOT NULL,
    "direccion" "Direccion" NOT NULL,
    "contenido" TEXT NOT NULL,
    "wa_id" TEXT,
    "procesado" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos" (
    "id" UUID NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "audiencia" "Audiencia" NOT NULL DEFAULT 'TODOS',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fragmentos" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "documento_id" UUID NOT NULL,
    "audiencia" "Audiencia" NOT NULL,
    "contenido" TEXT NOT NULL,
    "tsv" tsvector,

    CONSTRAINT "fragmentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" UUID NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "contacto_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ NOT NULL,
    "fin" TIMESTAMPTZ NOT NULL,
    "servicio" TEXT NOT NULL,
    "notas" TEXT,
    "estado" "EstadoCita" NOT NULL DEFAULT 'CONFIRMADA',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "contacto_id" UUID NOT NULL,
    "interes" TEXT NOT NULL,
    "email" TEXT,
    "presupuesto" TEXT,
    "notas" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'nuevo',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalamientos" (
    "id" UUID NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "contacto_id" UUID NOT NULL,
    "motivo" TEXT NOT NULL,
    "estado" "EstadoEscalamiento" NOT NULL DEFAULT 'ABIERTO',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalamientos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contactos_empresa_id_jid_key" ON "contactos"("empresa_id", "jid");

-- CreateIndex
CREATE INDEX "mensajes_contacto_id_id_idx" ON "mensajes"("contacto_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mensajes_empresa_id_wa_id_key" ON "mensajes"("empresa_id", "wa_id");

-- CreateIndex
CREATE INDEX "fragmentos_empresa_id_idx" ON "fragmentos"("empresa_id");

-- AddForeignKey
ALTER TABLE "wa_auth" ADD CONSTRAINT "wa_auth_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactos" ADD CONSTRAINT "contactos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_contacto_id_fkey" FOREIGN KEY ("contacto_id") REFERENCES "contactos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fragmentos" ADD CONSTRAINT "fragmentos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fragmentos" ADD CONSTRAINT "fragmentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_contacto_id_fkey" FOREIGN KEY ("contacto_id") REFERENCES "contactos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contacto_id_fkey" FOREIGN KEY ("contacto_id") REFERENCES "contactos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalamientos" ADD CONSTRAINT "escalamientos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalamientos" ADD CONSTRAINT "escalamientos_contacto_id_fkey" FOREIGN KEY ("contacto_id") REFERENCES "contactos"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Fuera de Prisma: búsqueda de texto completo en español.
ALTER TABLE "fragmentos" DROP COLUMN IF EXISTS "tsv";
ALTER TABLE "fragmentos" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('spanish', "contenido")) STORED;
CREATE INDEX "fragmentos_tsv_idx" ON "fragmentos" USING gin ("tsv");

-- Fuera de Prisma: un horario no puede tener dos citas confirmadas; mensajes pendientes por contacto.
CREATE UNIQUE INDEX "citas_horario_uq" ON "citas" ("empresa_id", "inicio") WHERE "estado" = 'CONFIRMADA';
CREATE INDEX "mensajes_pendientes_idx" ON "mensajes" ("contacto_id") WHERE "direccion" = 'ENTRANTE' AND NOT "procesado";
