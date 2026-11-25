-- AlterTable
ALTER TABLE "empresas" ADD COLUMN "pausa_automatica" BOOLEAN NOT NULL DEFAULT true;

-- Etapa de pruebas: los chats de prueba quedaron pausados por mensajes escritos desde el número del asistente.
UPDATE "contactos" SET "modo" = 'BOT' WHERE "empresa_id" = 'blc' AND "modo" = 'HUMANO';
