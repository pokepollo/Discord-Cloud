# Discord Cloud - Tutorial de configuración

Cloud privado que usa canales de Discord como almacenamiento: los archivos se dividen en chunks (~19 MB), se suben a webhooks/canales y se reensamblan al descargar. Incluye panel web, login, subida paralela, enlaces compartidos, herramientas de diagnóstico y calibración automática de concurrencia.

## Requisitos
- Windows (probado) o cualquier sistema con Node.js.
- Node.js 18+ (incluye `fetch` nativo).
- Un servidor de Discord donde puedas crear canales/webhooks o añadir un bot.
- Conexión a internet.

## Instalación y configuración inicial (consola)
1. Descomprime el proyecto en una carpeta.
2. Ejecuta `INICIAR.bat` (Windows) o manualmente:
   ```bash
   npm install
   npm run setup   # asistente de consola: token del bot o webhooks y parámetros necesarios
   npm start
   ```
3. Abre `http://localhost:3000`.

En el primer arranque sin `.env`, `INICIAR.bat` lanza automáticamente el asistente de consola para configurar el token del bot (o webhooks) y el resto de parámetros necesarios. Puedes volver a ejecutarlo con `npm run setup`.

## Primer inicio (contraseña del panel)
- Si `LOGIN_PASSWORD` queda vacío, la primera vez verás la pantalla **Configuración inicial** para crear la contraseña del panel desde la web.
- La contraseña se guarda localmente como hash en `data/config.json`.
- Si prefieres una contraseña fija, puedes definirla durante el asistente de consola (`LOGIN_PASSWORD`) o en `.env`.

## Configurar almacenamiento en Discord

### Opción A: Webhooks manuales
1. En tu servidor de Discord crea 4-8 canales de texto (ej. `cloud-1` a `cloud-8`).
2. En cada canal: **Editar canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL**.
3. En `.env`, pega las URLs separadas por coma:
   ```env
   WEBHOOKS=https://discord.com/api/webhooks/ID/TOKEN,https://discord.com/api/webhooks/ID/TOKEN
   ```
4. Reinicia el servidor.

### Opción B: Bot automático (recomendado)
1. Crea una aplicación/bot en https://discord.com/developers/applications y copia el **token del bot** (`BOT_TOKEN`).
2. Activa el modo desarrollador en Discord y copia el **ID del servidor** (`GUILD_ID`).
3. Invita el bot al servidor con permisos **Manage Channels** y **Manage Webhooks**.
4. En `.env`:
   ```env
   BOT_TOKEN=tu_token
   GUILD_ID=id_del_servidor
   CHANNEL_PREFIX=cloud-chunk
   NUM_CHANNELS=8
   ```
5. Reinicia el servidor: el bot creará los canales y webhooks automáticamente.

## Variables de `.env`
- `WEBHOOKS`: lista de webhooks (opción A).
- `BOT_TOKEN`, `GUILD_ID`: credenciales del bot (opción B).
- `NUM_CHANNELS`: canales a crear/usar (4-8 recomendado).
- `PORT`: puerto web (por defecto 3000).
- `CHUNK_SIZE`: tamaño de chunk en bytes (por defecto 19922944, ~19 MB).
- `LOGIN_PASSWORD`: contraseña fija opcional; vacío = configuración inicial desde web.
- `API_KEY`: token opcional para API (`x-api-key` o `?key=`).

## Uso del panel
- **Archivos**: subir (drag & drop), descargar, renombrar/editar etiquetas y notas, borrar (elimina también en Discord), crear enlaces compartidos con expiración.
- **Compartir**: genera enlaces públicos servidos por tu servidor (`/s/<token>`). Puedes copiarlos o revocarlos.
- **Herramientas**:
  - **Concurrencia de subida**: modo **Por defecto (4)** o **Automático**. "Calibrar automático" envía chunks de prueba a Discord, mide rendimiento, limpia los mensajes de prueba y selecciona la mejor concurrencia.
  - **Health Scanner & Auto-Diagnóstico**: verifica integridad/disponibilidad de todos los chunks y latencia.
  - Exportar índice/enlaces, limpiar temporales, distribución por tipo.

## Concurrencia de subida
- **Por defecto (4)**: 4 chunks en paralelo, estable.
- **Automático**: usa la concurrencia recomendada por la última calibración real contra Discord.
- Más concurrencia puede acelerar archivos grandes pero aumenta riesgo de rate limits (`429`) y uso de memoria/red. Recomendado 4 con 8 canales; recalibra si cambian las condiciones.

## Despliegue en VPS/servidor
- Abre el puerto configurado en el firewall.
- Usa un dominio/IP pública para que los enlaces compartidos sean accesibles externamente.
- Para producción, considera ejecutar detrás de un reverse proxy (HTTPS) y como servicio.
- No borres `data/files.json` ni los canales/mensajes de Discord: son el índice y el almacenamiento.

## Publicación en GitHub / seguridad
- No subas `.env`, `data/config.json`, `data/files.json` con datos reales, `data/settings.json`, ni `tmp/`.
- Incluye `.env.example` y mantén `data/` vacío (o con archivos de ejemplo). El `.gitignore` del proyecto ya excluye lo sensible.
- Cambia cualquier token/contraseña expuesto previamente.

## Limitaciones
- Depende de Discord y sus límites/políticas; no es almacenamiento garantizado a largo plazo.
- Los enlaces de adjuntos de Discord pueden cambiar o expirar según políticas de la plataforma; usa el Health Scanner para vigilar integridad.
- Subidas muy grandes (hasta 2 GB) tardan según conexión y rate limits.
