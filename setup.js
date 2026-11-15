const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '.env');
const EXAMPLE_PATH = path.join(__dirname, '.env.example');

function question(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer)));
}

function formatEnvValue(value) {
  if (value == null) return '';
  const v = String(value);
  if (v === '') return '';
  if (/[\s#"']/ .test(v)) {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return v;
}

function parseExistingEnv(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function hasDiscordConfig(env) {
  const webhooks = (env.WEBHOOKS || '').trim();
  const botToken = (env.BOT_TOKEN || '').trim();
  const guildId = (env.GUILD_ID || '').trim();
  return webhooks.length > 0 || (botToken.length > 0 && guildId.length > 0);
}

function buildEnv(config) {
  const lines = [
    '# Discord Cloud - configuración generada por el asistente de consola',
    '# No compartas este archivo: contiene credenciales.',
    '',
    '# Opcion A: webhooks manuales (separados por coma). Recomendado 4-8 canales.',
    `WEBHOOKS=${formatEnvValue(config.WEBHOOKS || '')}`,
    '',
    '# Opcion B: bot que crea canales automaticamente (requiere permisos Manage Channels + Manage Webhooks)',
    `BOT_TOKEN=${formatEnvValue(config.BOT_TOKEN || '')}`,
    `GUILD_ID=${formatEnvValue(config.GUILD_ID || '')}`,
    `CHANNEL_PREFIX=${formatEnvValue(config.CHANNEL_PREFIX || 'cloud-chunk')}`,
    `NUM_CHANNELS=${formatEnvValue(config.NUM_CHANNELS || '8')}`,
    '',
    `PORT=${formatEnvValue(config.PORT || '3000')}`,
    `CHUNK_SIZE=${formatEnvValue(config.CHUNK_SIZE || '19922944')}`,
    '',
    '# Contraseña del panel:',
    '# - Déjalo vacío para crear la contraseña desde la web en el primer inicio (recomendado).',
    '# - O define aquí una contraseña fija.',
    `LOGIN_PASSWORD=${formatEnvValue(config.LOGIN_PASSWORD || '')}`,
    '',
    '# Token opcional para acceso por API (header x-api-key o ?key=)',
    `API_KEY=${formatEnvValue(config.API_KEY || '')}`,
    ''
  ];
  return lines.join('\n');
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('=== Asistente de configuración de Discord Cloud ===\n');

    let existing = {};
    if (fs.existsSync(ENV_PATH)) {
      const raw = fs.readFileSync(ENV_PATH, 'utf8');
      existing = parseExistingEnv(raw);
      if (hasDiscordConfig(existing)) {
        console.log('Se ha detectado una configuración de Discord existente en .env.');
        const ans = (await question(rl, '¿Quieres reconfigurarla? (s/N): ')).trim().toLowerCase();
        if (ans !== 's' && ans !== 'si' && ans !== 'sí') {
          console.log('Configuración existente conservada. No se realizaron cambios.');
          return;
        }
        console.log('');
      } else {
        console.log('Se ha encontrado .env pero no contiene una configuración de Discord válida.');
        console.log('Se iniciará la configuración.\n');
      }
    } else {
      console.log('No se encontró .env. Se iniciará la configuración inicial.\n');
    }

    console.log('Selecciona el método de almacenamiento en Discord:');
    console.log('  1) Bot automático (recomendado): el bot crea canales y webhooks');
    console.log('  2) Webhooks manuales: pegas las URLs de webhooks ya creados');
    let mode = '';
    while (mode !== '1' && mode !== '2') {
      mode = (await question(rl, 'Opción [1/2]: ')).trim();
      if (mode === '') mode = '1';
    }

    const config = {
      WEBHOOKS: '',
      BOT_TOKEN: '',
      GUILD_ID: '',
      CHANNEL_PREFIX: existing.CHANNEL_PREFIX || 'cloud-chunk',
      NUM_CHANNELS: existing.NUM_CHANNELS || '8',
      PORT: existing.PORT || '3000',
      CHUNK_SIZE: existing.CHUNK_SIZE || '19922944',
      LOGIN_PASSWORD: existing.LOGIN_PASSWORD || '',
      API_KEY: existing.API_KEY || ''
    };

    if (mode === '1') {
      console.log('\n--- Configuración por bot ---');
      console.log('Necesitas: token del bot y ID del servidor (GUILD_ID).');
      console.log('El bot debe tener permisos: Manage Channels y Manage Webhooks.\n');

      config.BOT_TOKEN = (await question(rl, 'Token del bot (BOT_TOKEN): ')).trim();
      config.GUILD_ID = (await question(rl, 'ID del servidor (GUILD_ID): ')).trim();
      const prefix = (await question(rl, `Prefijo de canales [${config.CHANNEL_PREFIX}]: `)).trim();
      if (prefix) config.CHANNEL_PREFIX = prefix;
      const num = (await question(rl, `Número de canales [${config.NUM_CHANNELS}]: `)).trim();
      if (num) config.NUM_CHANNELS = num;
      config.WEBHOOKS = '';

      if (!config.BOT_TOKEN || !config.GUILD_ID) {
        console.error('\n[ERROR] BOT_TOKEN y GUILD_ID son obligatorios para el modo bot.');
        process.exitCode = 1;
        return;
      }
    } else {
      console.log('\n--- Configuración por webhooks manuales ---');
      console.log('Pega las URLs de los webhooks separadas por coma.\n');
      config.WEBHOOKS = (await question(rl, 'WEBHOOKS: ')).trim();
      config.BOT_TOKEN = '';
      config.GUILD_ID = '';
      if (!config.WEBHOOKS) {
        console.error('\n[ERROR] Debes proporcionar al menos un webhook.');
        process.exitCode = 1;
        return;
      }
    }

    console.log('\n--- Ajustes opcionales ---');
    const port = (await question(rl, `Puerto web [${config.PORT}]: `)).trim();
    if (port) config.PORT = port;
    const chunk = (await question(rl, `Tamaño de chunk en bytes [${config.CHUNK_SIZE}]: `)).trim();
    if (chunk) config.CHUNK_SIZE = chunk;

    const setPass = (await question(rl, '¿Definir contraseña fija del panel ahora? (s/N): ')).trim().toLowerCase();
    if (setPass === 's' || setPass === 'si' || setPass === 'sí') {
      config.LOGIN_PASSWORD = (await question(rl, 'Contraseña del panel (LOGIN_PASSWORD): ')).trim();
    } else {
      config.LOGIN_PASSWORD = '';
      console.log('Se usará la configuración inicial desde la web en el primer acceso.');
    }

    const apiKey = (await question(rl, 'API_KEY opcional (Enter para omitir): ')).trim();
    config.API_KEY = apiKey;

    console.log('\n--- Resumen ---');
    if (mode === '1') {
      console.log('Modo: Bot automático');
      console.log(`BOT_TOKEN: ${config.BOT_TOKEN ? '[definido]' : '[vacío]'}`);
      console.log(`GUILD_ID: ${config.GUILD_ID}`);
      console.log(`CHANNEL_PREFIX: ${config.CHANNEL_PREFIX}`);
      console.log(`NUM_CHANNELS: ${config.NUM_CHANNELS}`);
    } else {
      const count = config.WEBHOOKS.split(',').map(s => s.trim()).filter(Boolean).length;
      console.log('Modo: Webhooks manuales');
      console.log(`WEBHOOKS: ${count} webhook(s) configurado(s)`);
    }
    console.log(`PORT: ${config.PORT}`);
    console.log(`CHUNK_SIZE: ${config.CHUNK_SIZE}`);
    console.log(`LOGIN_PASSWORD: ${config.LOGIN_PASSWORD ? '[definida]' : '[vacía, se configurará desde web]'}`);
    console.log(`API_KEY: ${config.API_KEY ? '[definida]' : '[vacía]'}`);

    const confirm = (await question(rl, '\n¿Guardar esta configuración en .env? (S/n): ')).trim().toLowerCase();
    if (confirm === 'n' || confirm === 'no') {
      console.log('Configuración cancelada. No se realizaron cambios.');
      return;
    }

    fs.writeFileSync(ENV_PATH, buildEnv(config), 'utf8');
    console.log(`\nConfiguración guardada en ${ENV_PATH}`);
    console.log('Puedes iniciar el servidor con: npm start  (o INICIAR.bat en Windows)');
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('Error en el asistente de configuración:', err);
  process.exit(1);
});
