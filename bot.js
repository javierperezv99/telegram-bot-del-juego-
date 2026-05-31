/**
 * bot.js
 * Juego "Impostor de palabras" para Telegram (Node.js, node-telegram-bot-api)
 *
 * Requisitos:
 * - npm install node-telegram-bot-api
 * - Crear archivo .env con BOT_TOKEN=tu_token
 * - Tener words.json en la misma carpeta con el diccionario (array de palabras)
 *
 * Uso:
 * node bot.js
 *
 * Nota: Este archivo usa polling para poder probar en local.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Falta BOT_TOKEN en .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

/* ---------- Configuración ---------- */
const RONDAS_POR_TORNEO = 5;
const TIEMPO_POR_TURNO_MS = 60 * 1000; // 60 segundos
const VICTORIAS_FILE = path.join(__dirname, 'victorias.json');
const WORDS_FILE = path.join(__dirname, 'words.json');

/* ---------- Carga diccionario y victorias ---------- */
let palabras = [];
try {
  palabras = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf8'));
  if (!Array.isArray(palabras) || palabras.length === 0) {
    throw new Error('words.json debe contener un array de palabras');
  }
} catch (e) {
  console.error('Error cargando words.json:', e.message);
  process.exit(1);
}

let victorias = {};
try {
  if (fs.existsSync(VICTORIAS_FILE)) {
    victorias = JSON.parse(fs.readFileSync(VICTORIAS_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('No se pudo leer victorias.json, se iniciará vacío.');
  victorias = {};
}

/* ---------- Estado por chat (soporta múltiples grupos) ---------- */
const chats = new Map();
/*
Estructura por chatId:
{
  jugadores: Map<userId, {id, name}>,
  scores: Map<userId, number>,
  rondaActual: number,
  palabraSecreta: string,
  impostorId: number,
  respuestas: Map<userId, palabra>,
  votos: Map<votanteId, votadoId>,
  estado: 'ESPERA'|'REGISTRO'|'EN_RONDA'|'VOTACION',
  timeoutId: Timeout,
}
*/

/* ---------- Utilidades ---------- */
function guardarVictorias() {
  try {
    fs.writeFileSync(VICTORIAS_FILE, JSON.stringify(victorias, null, 2));
  } catch (e) {
    console.error('Error guardando victorias:', e.message);
  }
}

function obtenerChatState(chatId) {
  if (!chats.has(chatId)) {
    chats.set(chatId, {
      jugadores: new Map(),
      scores: new Map(),
      rondaActual: 0,
      palabraSecreta: null,
      impostorId: null,
      respuestas: new Map(),
      votos: new Map(),
      estado: 'ESPERA',
      timeoutId: null
    });
  }
  return chats.get(chatId);
}

function elegirPalabraUnica(chatState) {
  // Elegir palabra que no sea igual a ninguna usada recientemente en este chat
  // Para simplicidad, elegimos aleatoria; se puede mejorar con historial.
  return palabras[Math.floor(Math.random() * palabras.length)];
}

function resetParaNuevoTorneo(chatState) {
  chatState.scores = new Map();
  chatState.rondaActual = 0;
  chatState.palabraSecreta = null;
  chatState.impostorId = null;
  chatState.respuestas = new Map();
  chatState.votos = new Map();
  chatState.estado = 'ESPERA';
  if (chatState.timeoutId) {
    clearTimeout(chatState.timeoutId);
    chatState.timeoutId = null;
  }
}

/* ---------- Mensajes y botones ---------- */
const reglasTexto = `
📜 Reglas del juego:
1. Se elige una palabra secreta del diccionario.
2. Un jugador es impostor y no la conoce.
3. Cada jugador tiene 60 segundos para escribir una sola palabra.
4. No se pueden repetir palabras ni usar la palabra secreta.
5. El bot muestra quién dijo qué palabra.
6. Al final, todos votan quién creen que es el impostor.
7. Puntuación:
   - +2 puntos si votas correctamente.
   - +3 puntos si el impostor gana.
   - +1 punto por participar.
8. Después de ${RONDAS_POR_TORNEO} rondas, el jugador con más puntos obtiene 1 victoria.
9. El bot mostrará las victorias acumuladas y dará opción de reiniciar o terminar el torneo.
`;

/* ---------- Comandos y callbacks ---------- */

// Enviar reglas con botón "Empezar juego" (se puede llamar al arrancar o con /start)
function enviarReglas(chatId) {
  bot.sendMessage(chatId, reglasTexto, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Empezar juego', callback_data: 'EMPEZAR' }]
      ]
    }
  });
}

// Manejo de callback queries (botones inline)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const userName = query.from.first_name || query.from.username || String(userId);
  const data = query.data;
  const chatState = obtenerChatState(chatId);

  try {
    if (data === 'EMPEZAR') {
      // Poner en modo registro
      chatState.estado = 'REGISTRO';
      chatState.jugadores = chatState.jugadores || new Map();
      chatState.scores = chatState.scores || new Map();
      chatState.rondaActual = 0;
      chatState.respuestas = new Map();
      chatState.votos = new Map();

      await bot.sendMessage(chatId, '🎮 Juego iniciado. Pulsa "🙋 Unirse al juego" para participar.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🙋 Unirse al juego', callback_data: 'JOIN' }],
            [{ text: '▶️ Iniciar torneo (mínimo 3 jugadores)', callback_data: 'INICIAR_TORNEO' }]
          ]
        }
      });
    } else if (data === 'JOIN') {
      if (!chatState.jugadores.has(userId)) {
        chatState.jugadores.set(userId, { id: userId, name: userName });
        if (!chatState.scores.has(userId)) chatState.scores.set(userId, 0);
        if (!victorias[userId]) victorias[userId] = 0;
        await bot.sendMessage(chatId, `✅ ${userName} se ha unido al juego.`);
      } else {
        await bot.answerCallbackQuery(query.id, { text: 'Ya estás registrado.' });
      }
    } else if (data === 'INICIAR_TORNEO') {
      if (chatState.jugadores.size < 3) {
        await bot.answerCallbackQuery(query.id, { text: 'Se necesitan al menos 3 jugadores para iniciar.' });
        return;
      }
      // Reiniciar scores y comenzar torneo
      chatState.rondaActual = 0;
      chatState.scores = new Map(Array.from(chatState.jugadores.keys()).map(id => [id, 0]));
      chatState.estado = 'EN_RONDA';
      await bot.sendMessage(chatId, '🏁 Torneo iniciado. Se jugarán ' + RONDAS_POR_TORNEO + ' rondas.');
      iniciarSiguienteRonda(chatId);
    } else if (data === 'REINICIAR_TORNEO') {
      // Reiniciar scores y rondas
      resetParaNuevoTorneo(chatState);
      // Mantener jugadores y victorias
      chatState.jugadores = chatState.jugadores || new Map();
      chatState.scores = new Map(Array.from(chatState.jugadores.keys()).map(id => [id, 0]));
      chatState.estado = 'EN_RONDA';
      await bot.sendMessage(chatId, '🔄 Reiniciando torneo. Preparando primera ronda...');
      iniciarSiguienteRonda(chatId);
    } else if (data === 'TERMINAR_JUEGO') {
      // Guardar victorias y mostrar ranking final
      guardarVictorias();
      let texto = '⏹ Juego terminado. Victorias acumuladas:\n';
      for (let [id, player] of chatState.jugadores) {
        texto += `- ${player.name}: ${victorias[id] || 0}\n`;
      }
      await bot.sendMessage(chatId, texto);
      resetParaNuevoTorneo(chatState);
    } else if (data && data.startsWith('VOTO_')) {
      // Voto privado: data = VOTO_<chatId>_<votadoId>
      // Este callback puede venir de mensajes privados; manejamos en on('callback_query') globalmente.
      const parts = data.split('_');
      if (parts.length === 3) {
        const votadoId = Number(parts[2]);
        // Guardar voto en el chatState correspondiente
        // We need to find which chat this vote belongs to. We encoded chatId in the button label earlier.
        // For simplicity we will search chats map for a chatState that contains the votante as player and is in VOTACION state.
        let targetChatId = null;
        for (let [cId, state] of chats.entries()) {
          if (state.estado === 'VOTACION' && state.jugadores.has(userId)) {
            targetChatId = cId;
            break;
          }
        }
        if (!targetChatId) {
          await bot.answerCallbackQuery(query.id, { text: 'No hay votación activa para ti.' });
          return;
        }
        const targetState = obtenerChatState(targetChatId);
        targetState.votos.set(userId, votadoId);
        await bot.answerCallbackQuery(query.id, { text: 'Voto registrado.' });

        // Si todos votaron, cerrar votación
        if (targetState.votos.size === targetState.jugadores.size) {
          if (targetState.timeoutId) {
            clearTimeout(targetState.timeoutId);
            targetState.timeoutId = null;
          }
          procesarResultadosVotacion(targetChatId);
        }
      }
    }
  } catch (err) {
    console.error('Error en callback_query:', err);
  }
});

/* ---------- Flujo de rondas ---------- */

async function iniciarSiguienteRonda(chatId) {
  const chatState = obtenerChatState(chatId);
  chatState.rondaActual += 1;
  chatState.respuestas = new Map();
  chatState.votos = new Map();
  chatState.palabraSecreta = elegirPalabraUnica(chatState);
  // Elegir impostor aleatorio
  const jugadoresIds = Array.from(chatState.jugadores.keys());
  chatState.impostorId = jugadoresIds[Math.floor(Math.random() * jugadoresIds.length)];
  chatState.estado = 'EN_RONDA';

  // Enviar mensajes privados: palabra a todos menos impostor; IMPOSTOR al impostor
  for (let [id, player] of chatState.jugadores) {
    try {
      if (id === chatState.impostorId) {
        await bot.sendMessage(id, '🔴 Eres el IMPOSTOR. No conoces la palabra secreta. Observa las pistas y trata de engañar.');
      } else {
        await bot.sendMessage(id, `🔑 Palabra secreta de la ronda ${chatState.rondaActual}: *${chatState.palabraSecreta}*`, { parse_mode: 'Markdown' });
      }
    } catch (e) {
      // Si no se puede enviar privado (usuario no inició chat con bot), avisar en grupo
      console.warn(`No se pudo enviar privado a ${id}:`, e.message);
      await bot.sendMessage(chatId, `⚠️ No pude enviar mensaje privado a ${player.name}. Pídele que inicie una conversación conmigo para recibir la palabra.`);
    }
  }

  // Avisar en grupo que comienza la fase de respuestas
  await bot.sendMessage(chatId, `✍️ Ronda ${chatState.rondaActual}: cada jugador tiene ${TIEMPO_POR_TURNO_MS / 1000} segundos para enviar UNA sola palabra en este chat. No repitas palabras ni uses la palabra secreta.`);

  // Iniciar temporizador para finalizar fase de respuestas
  if (chatState.timeoutId) clearTimeout(chatState.timeoutId);
  chatState.timeoutId = setTimeout(() => {
    finalizarFaseRespuestas(chatId);
  }, TIEMPO_POR_TURNO_MS);

  // Nota: las respuestas se recogen en el listener de mensajes (ver abajo)
}

async function finalizarFaseRespuestas(chatId) {
  const chatState = obtenerChatState(chatId);
  chatState.estado = 'VOTACION';
  if (chatState.timeoutId) {
    clearTimeout(chatState.timeoutId);
    chatState.timeoutId = null;
  }

  // Mostrar en grupo quién dijo qué (si no respondió, marcar "sin respuesta")
  let texto = `📝 Respuestas de la ronda ${chatState.rondaActual}:\n`;
  for (let [id, player] of chatState.jugadores) {
    const resp = chatState.respuestas.get(id);
    texto += `- ${player.name}: ${resp ? resp : '_sin respuesta_'}\n`;
  }
  await bot.sendMessage(chatId, texto, { parse_mode: 'Markdown' });

  // Iniciar votación privada: enviar a cada jugador botones con los nombres de los jugadores
  for (let [id, player] of chatState.jugadores) {
    try {
      const keyboard = [];
      for (let [id2, player2] of chatState.jugadores) {
        keyboard.push([{ text: player2.name, callback_data: `VOTO_${chatId}_${id2}` }]);
      }
      await bot.sendMessage(id, '🗳️ Vota quién crees que es el impostor (pulsa el nombre):', {
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (e) {
      console.warn(`No se pudo enviar votación privada a ${id}:`, e.message);
      await bot.sendMessage(chatId, `⚠️ No pude enviar la votación privada a ${player.name}.`);
    }
  }

  // Poner timeout para cerrar votación si no todos votan
  chatState.timeoutId = setTimeout(() => {
    procesarResultadosVotacion(chatId);
  }, 30 * 1000); // 30 segundos para votar
}

function procesarResultadosVotacion(chatId) {
  const chatState = obtenerChatState(chatId);
  if (chatState.timeoutId) {
    clearTimeout(chatState.timeoutId);
    chatState.timeoutId = null;
  }

  // Contar votos
  const conteo = new Map(); // votadoId -> cantidad
  for (let [votante, votado] of chatState.votos) {
    conteo.set(votado, (conteo.get(votado) || 0) + 1);
  }

  // Determinar si hay mayoría absoluta
  const totalJugadores = chatState.jugadores.size;
  let mayorVotos = 0;
  let candidato = null;
  for (let [votado, cantidad] of conteo) {
    if (cantidad > mayorVotos) {
      mayorVotos = cantidad;
      candidato = votado;
    }
  }

  let resultadoTexto = `🗳️ Resultados de la votación (ronda ${chatState.rondaActual}):\n`;
  if (!candidato) {
    resultadoTexto += 'No hubo votos. Gana el impostor por defecto.\n';
  } else {
    resultadoTexto += `- Jugador con más votos: ${chatState.jugadores.get(candidato).name} (${mayorVotos} votos)\n`;
  }

  // Determinar ganador de la ronda
  let impostorGana = false;
  if (!candidato) {
    impostorGana = true;
  } else {
    // Mayoría absoluta = más de la mitad
    if (mayorVotos > totalJugadores / 2) {
      // Si el candidato es el impostor -> los demás ganan
      if (candidato === chatState.impostorId) {
        impostorGana = false;
      } else {
        impostorGana = true;
      }
    } else {
      // Sin mayoría -> impostor gana
      impostorGana = true;
    }
  }

  // Aplicar puntuaciones
  // +1 por participar a todos que enviaron respuesta (o participaron en la ronda)
  for (let [id, player] of chatState.jugadores) {
    if (chatState.respuestas.has(id)) {
      chatState.scores.set(id, (chatState.scores.get(id) || 0) + 1);
    }
  }

  if (impostorGana) {
    // impostor +3
    chatState.scores.set(chatState.impostorId, (chatState.scores.get(chatState.impostorId) || 0) + 3);
    resultadoTexto += `\n🔴 El impostor (${chatState.jugadores.get(chatState.impostorId).name}) gana la ronda.\n`;
  } else {
    // jugadores que votaron correctamente +2
    for (let [votante, votado] of chatState.votos) {
      if (votado === chatState.impostorId) {
        chatState.scores.set(votante, (chatState.scores.get(votante) || 0) + 2);
      }
    }
    resultadoTexto += `\n✅ Los jugadores descubrieron al impostor (${chatState.jugadores.get(chatState.impostorId).name}).\n`;
  }

  // Mostrar puntuaciones actuales
  resultadoTexto += '\n📊 Puntuaciones actuales:\n';
  for (let [id, player] of chatState.jugadores) {
    resultadoTexto += `- ${player.name}: ${chatState.scores.get(id) || 0}\n`;
  }

  bot.sendMessage(chatId, resultadoTexto).then(() => {
    // Si se completaron RONDAS_POR_TORNEO, finalizar torneo
    if (chatState.rondaActual >= RONDAS_POR_TORNEO) {
      finalizarTorneo(chatId);
    } else {
      // Iniciar siguiente ronda tras breve pausa
      setTimeout(() => {
        iniciarSiguienteRonda(chatId);
      }, 3000);
    }
  }).catch(err => console.error('Error enviando resultados:', err));
}

function finalizarTorneo(chatId) {
  const chatState = obtenerChatState(chatId);
  // Determinar ganador por score
  let ganadorId = null;
  let maxScore = -Infinity;
  for (let [id, score] of chatState.scores) {
    if (score > maxScore) {
      maxScore = score;
      ganadorId = id;
    }
  }
  if (ganadorId === null) {
    bot.sendMessage(chatId, 'El torneo terminó sin participantes válidos.');
    resetParaNuevoTorneo(chatState);
    return;
  }

  // Sumar victoria
  victorias[ganadorId] = (victorias[ganadorId] || 0) + 1;
  guardarVictorias();

  // Mostrar resultados finales
  let texto = `🏆 Ganador del torneo: ${chatState.jugadores.get(ganadorId).name} con ${maxScore} puntos\n\nVictorias acumuladas:\n`;
  for (let [id, player] of chatState.jugadores) {
    texto += `- ${player.name}: ${victorias[id] || 0}\n`;
  }

  bot.sendMessage(chatId, texto, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Reiniciar', callback_data: 'REINICIAR_TORNEO' }],
        [{ text: '⏹ Terminar', callback_data: 'TERMINAR_JUEGO' }]
      ]
    }
  });

  // Reiniciar scores para próximo torneo (pero mantener victorias)
  resetParaNuevoTorneo(chatState);
}

/* ---------- Recepción de mensajes en grupo (respuestas de palabras) ---------- */
bot.on('message', (msg) => {
  // Ignorar mensajes que no sean en grupos o supergroups
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  if (chatType !== 'group' && chatType !== 'supergroup') return;

  const chatState = obtenerChatState(chatId);
  if (!chatState || chatState.estado !== 'EN_RONDA') return;

  const userId = msg.from.id;
  if (!chatState.jugadores.has(userId)) return; // solo jugadores registrados

  // Validar que el jugador no haya respondido ya
  if (chatState.respuestas.has(userId)) {
    bot.sendMessage(chatId, `${msg.from.first_name}, ya enviaste tu palabra para esta ronda.`);
    return;
  }

  // Tomar texto y validar
  const texto = (msg.text || '').trim();
  if (!texto) {
    bot.sendMessage(chatId, `${msg.from.first_name}, envía una palabra válida.`);
    return;
  }

  // Aceptar solo una palabra (sin espacios)
  if (texto.split(/\s+/).length !== 1) {
    bot.sendMessage(chatId, `${msg.from.first_name}, solo puedes enviar UNA palabra.`);
    return;
  }

  const palabra = texto.toLowerCase();

  // No aceptar la palabra secreta
  if (palabra === (chatState.palabraSecreta || '').toLowerCase()) {
    bot.sendMessage(chatId, `${msg.from.first_name}, no puedes usar la palabra secreta.`);
    return;
  }

  // No aceptar palabras repetidas entre jugadores
  for (let [id, resp] of chatState.respuestas) {
    if (resp.toLowerCase() === palabra) {
      bot.sendMessage(chatId, `${msg.from.first_name}, esa palabra ya fue usada por otro jugador.`);
      return;
    }
  }

  // Guardar respuesta
  chatState.respuestas.set(userId, palabra);
  bot.sendMessage(chatId, `${msg.from.first_name} ha enviado su palabra.`);

  // Si todos respondieron, finalizar fase de respuestas inmediatamente
  if (chatState.respuestas.size === chatState.jugadores.size) {
    if (chatState.timeoutId) {
      clearTimeout(chatState.timeoutId);
      chatState.timeoutId = null;
    }
    finalizarFaseRespuestas(chatId);
  }
});

/* ---------- Comando /start para grupos y privados ---------- */
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  // Enviar reglas y botón
  enviarReglas(chatId);
});

/* ---------- Manejo de errores y cierre ---------- */
process.once('SIGINT', () => {
  console.log('Cerrando bot...');
  guardarVictorias();
  bot.stopPolling();
  process.exit(0);
});
process.once('SIGTERM', () => {
  console.log('Cerrando bot...');
  guardarVictorias();
  bot.stopPolling();
  process.exit(0);
});

console.log('Bot iniciado con polling. Usa /start en el grupo para mostrar reglas.');
