-- Panel web: filtro de números, usuarios y contenido original de los documentos.
-- (Se quitaron a mano los cambios que Prisma propone sobre fragmentos.tsv: esa columna se maneja en SQL.)

-- CreateEnum
CREATE TYPE "FiltroModo" AS ENUM ('TODOS', 'SOLO_LISTA', 'EXCLUIR_LISTA');

-- AlterTable
ALTER TABLE "documentos" ADD COLUMN     "contenido" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "filtro_modo" "FiltroModo" NOT NULL DEFAULT 'TODOS',
ADD COLUMN     "filtro_numeros" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_acceso" TIMESTAMP(3),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

