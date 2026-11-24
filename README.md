# Asistente WhatsApp BLC (multi-empresa)

Asistente de WhatsApp para ventas, soporte, información y, si la empresa lo activa, citas. Atiende a clientes y al equipo. Está pensado para replicarse en varias empresas. Se basa en el enfoque de `hotelbot`.

La agenda es opcional por empresa: el agente solo ofrece `consultar_disponibilidad` y `agendar_cita` si `horario.dias` tiene franjas. En BLC no está activa, porque las reuniones las coordina el equipo.

Stack: Node 22 + TypeScript, Express 5, Prisma 7 + PostgreSQL, Redis + BullMQ, Baileys 7 y Claude Haiku 5.5. Despliegue en Railway.

## Procesos

| Proceso | Comando | Qué hace |
|---|---|---|
| `core` | `npm run start:core` | Worker del agente (Claude + herramientas) y API administrativa |
| `gateway` | `npm run start:gateway` | Sockets de Baileys, uno por empresa; recibe y envía mensajes |

Se comunican por Redis: la cola `inbound` lleva los chats con mensajes pendientes y la cola `outbound.<empresa>` lleva las respuestas.

## Local

```bash
cp .env.example .env          # completa ANTHROPIC_API_KEY y ADMIN_API_KEY
npm install                   # también genera el cliente de Prisma
docker compose up -d postgres redis
npm run build && npm run db:migrate && npm run seed   # seed = cargar-empresa blc
npm run dev:core              # terminal 1
npm run dev:gateway           # terminal 2
```

Para vincular WhatsApp, abre `GET /empresas/blc/qr.png` con el header `x-api-key` y escanéalo desde WhatsApp > Dispositivos vinculados.

Para probar sin WhatsApp:

```bash
curl -X POST localhost:3000/empresas/blc/simular \
  -H "x-api-key: $ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"telefono":"573000000000","texto":"Hola, ¿qué servicios tienen?"}'
```

## Empresas (multi-empresa)

Cada empresa es una carpeta `empresas/<id>/`:

- `empresa.json`: nombre, zona horaria, perfil (identidad, personalidad, reglas, prohibiciones, mensajes oficiales) y horarios. Las claves que empiezan con `_` son notas.
- `conocimiento/*.md`: cada `# Título` es un documento. Si el archivo lleva `<!-- audiencia: EQUIPO -->`, solo lo ve el equipo. No se ponen precios.

`npm run cargar-empresa <id>` sincroniza la carpeta con la base de datos. Es idempotente y reemplaza el conocimiento anterior.

## Atención humana desde el mismo WhatsApp

- El agente pausa un chat (modo `HUMANO`) cuando escala con `escalar_a_humano`, y además lo marca como no leído en el teléfono. También lo pausa cuando una persona escribe en ese chat desde el teléfono o WhatsApp Web: todo lo que sale del número sin haberlo enviado el bot cuenta como intervención humana.
- En modo `HUMANO` el agente no responde ni hace seguimientos. Los mensajes se siguen guardando en el historial.
- Para devolver el chat al agente, la persona escribe `/bot` en ese chat. El comando se borra para todos al instante y el agente retoma con lo que llegue después.
- `/pausa` pausa el agente sin escribirle nada al cliente.
- También se puede devolver desde la API con `POST /empresas/:id/contactos/:contactoId/devolver-al-bot`.
- Las reacciones, los borrados y las ediciones que salen del número no cuentan como intervención. Tampoco los mensajes de más de 24 h que llegan al resincronizar.

## Protecciones

- Cada mensaje se recorta a 4.000 caracteres, y el agente atiende como máximo 40 mensajes por chat cada 10 minutos. El resto se guarda pero no genera respuesta.
- Las notas de voz, imágenes y documentos sin texto llegan como un aviso, y el agente pide que se lo escriban.
- Si Claude falla después de 3 intentos, el chat queda como no leído para que lo vea el equipo.
- Cuando un cliente llega primero por LID y después por número, se reconoce como el mismo contacto.
- La API compara la clave en tiempo constante y no devuelve detalles internos cuando hay un error 500. El core no arranca si falta `ANTHROPIC_API_KEY`.

## Railway

Un solo repositorio con cuatro servicios en el mismo proyecto:

1. **Postgres** y **Redis**, ambos plugins administrados.
2. **core**, con start command `npm run db:migrate && npm run start:core`.
3. **gateway**, con start command `npm run start:gateway`. Usa **una sola réplica** por shard. Si dos instancias se cruzan (por ejemplo, durante un redeploy), un lock en Redis (`wa:lock:<empresa>`) hace que solo una conecte el número. La otra reintenta cada 30 s.

Variables de entorno: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`, `ANTHROPIC_API_KEY` y `ADMIN_API_KEY`. No hace falta volumen, porque la sesión de WhatsApp se guarda en Postgres.

## API

| Método | Ruta | Uso |
|---|---|---|
| PUT | `/empresas/:id` | Alta o edición de una empresa (perfil, horario, modelo) |
| GET | `/empresas/:id/whatsapp` · `/qr.png` | Estado y QR de vinculación |
| POST | `/empresas/:id/conocimiento` | Cargar un documento (`TODOS` o `EQUIPO`) |
| GET | `/empresas/:id/escalamientos` | Bandeja de conversaciones pasadas a humano |
| POST | `/empresas/:id/contactos/:contactoId/devolver-al-bot` | Cerrar el escalamiento |
| PATCH | `/empresas/:id/contactos/:contactoId` | Cambiar rol (`CLIENTE` / `EQUIPO`) |
| POST | `/empresas/:id/simular` | Conversar sin WhatsApp (pruebas de la fase F9) |

El manual técnico completo está en el Claude Doc del proyecto.
