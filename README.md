# Discord Cloud

Sitio web privado que usa servidores/canales de Discord como almacenamiento. Los archivos se parten en chunks de ~19 MB y se suben a distintos canales mediante webhooks; al descargar se reensamblan.

## Configuración inicial (consola)

En el primer arranque, si no existe `.env`, el proyecto puede configurarse desde la consola (token del bot o webhooks y parámetros necesarios).

- Windows: ejecuta `INICIAR.bat` y sigue el asistente si no hay configuración.
- Manual: `npm install` y después `npm run setup` (o `node setup.js`).

El asistente genera `.env` con la configuración de Discord (`BOT_TOKEN` + `GUILD_ID` o `WEBHOOKS`), puerto, tamaño de chunk y opciones opcionales (`LOGIN_PASSWORD`, `API_KEY`).

## Modos de almacenamiento en Discord

**Opción automática (bot, recomendada):** crea un bot en Discord Developer Portal, invítalo al servidor con permisos `Manage Channels` y `Manage Webhooks`, e indica `BOT_TOKEN` y `GUILD_ID`. Al arrancar crea `NUM_CHANNELS` canales con prefijo `CHANNEL_PREFIX` y sus webhooks.

**Opción manual:** crea webhooks en canales de Discord y configúralos en `WEBHOOKS` (separados por coma). Recomendado usar 4-8 canales para distribuir carga y evitar rate limits.

## Inicio

```bash
npm install
npm run setup   # solo la primera vez o para reconfigurar
npm start
```
Abre `http://localhost:3000`. Si no definiste `LOGIN_PASSWORD`, la contraseña del panel se crea desde la web en el primer acceso.

## Notas

- Límite por chunk: `CHUNK_SIZE` (default 19922944 bytes ~19 MB).
- Discord permite hasta 25 MB por archivo en webhooks; 19 MB es seguro.
- Rate limit: se añade delay de 350 ms entre chunks.
- Metadata en `data/files.json`.
- API key opcional vía `API_KEY` (header `x-api-key` o query `?key=`).
