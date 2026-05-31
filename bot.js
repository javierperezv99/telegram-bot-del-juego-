require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Diccionario = require('./dictionary');
const juego = require('./gameManager');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Comando de inicio
bot.start((ctx) => ctx.reply('🤖 Bot de Spyfall activo. Usa /jugar en tu grupo para comenzar el registro.'));

// Comando para abrir registro
bot.command('jugar', (ctx) => {
    const state = juego.getChatState(ctx.chat.id);
    state.estado = 'REGISTRO';
    state.jugadores.clear();
    state.scores.clear();
    state.rondaActual = 0;
    
    ctx.reply('🚪 Registro abierto. ¡Pulsen el botón para unirse!', Markup.inlineKeyboard([
        Markup.button.callback('🙋 Unirse', 'unirse')
    ]));
});

// Acción cuando alguien pulsa "Unirse"
bot.action('unirse', (ctx) => {
    const state = juego.getChatState(ctx.chat.id);
    if (state.estado !== 'REGISTRO') return ctx.answerCbQuery('El registro está cerrado.');
    
    state.jugadores.set(ctx.from.id, { id: ctx.from.id, name: ctx.from.first_name });
    ctx.answerCbQuery('✅ Te has unido al juego.');
    ctx.reply(`✅ ${ctx.from.first_name} se ha unido al juego. (${state.jugadores.size} registrados)`);
});

// Comando para iniciar el juego (requiere al menos 3 jugadores)
bot.command('iniciar', (ctx) => {
    const state = juego.getChatState(ctx.chat.id);
    if (state.jugadores.size < 2) return ctx.reply('⚠️ Necesitas al menos 3 jugadores para jugar Spyfall.');
    if (state.estado !== 'REGISTRO') return ctx.reply('⚠️ Debes usar /jugar primero para abrir el registro.');

    // Inicializamos puntuaciones a 0
    state.jugadores.forEach((_, id) => state.scores.set(id, 0));
    
    iniciarSiguienteRonda({ chat: { id: ctx.chat.id } }); // Pasamos un ctx simulado
});

// Función para preparar y lanzar una nueva ronda
function iniciarSiguienteRonda(ctxMock) {
    const chatId = ctxMock.chat.id;
    const state = juego.getChatState(chatId);
    
    state.rondaActual++;
    state.estado = 'EN_RONDA';
    state.votos.clear();
    state.respuestas.clear();

    // Asignación de palabra e impostor
    state.palabraSecreta = Diccionario.obtenerPalabra();
    const ids = Array.from(state.jugadores.keys());
    state.impostorId = ids[Math.floor(Math.random() * ids.length)];

    // Crear la cola de turnos
    state.colaJugadores = Array.from(state.jugadores.values());
    state.indiceTurno = 0;

    // Enviar mensajes privados
    state.jugadores.forEach((player, id) => {
        const msg = (id === state.impostorId) ? '🤫 Eres el IMPOSTOR.' : `🤫 Palabra secreta: ${state.palabraSecreta}`;
        bot.telegram.sendMessage(id, msg).catch(() => {
            bot.telegram.sendMessage(chatId, `⚠️ No pude enviarle el mensaje privado a ${player.name}. ¿Inició el bot en privado?`);
        });
    });

    bot.telegram.sendMessage(chatId, `🏁 **Comienza la Ronda ${state.rondaActual} de 5.**`);
    ejecutarTurno(chatId);
}

// Función que gestiona el turno de cada jugador
function ejecutarTurno(chatId) {
    const state = juego.getChatState(chatId);
    
    if (state.indiceTurno < state.colaJugadores.length) {
        const jugadorActual = state.colaJugadores[state.indiceTurno];
        bot.telegram.sendMessage(chatId, `📢 Es el turno de **${jugadorActual.name}**. Escribe tu palabra (Tienes 60s).`);
        
        // Temporizador de turno
        state.timeoutId = setTimeout(() => {
            bot.telegram.sendMessage(chatId, `⏳ Tiempo agotado para ${jugadorActual.name}.`);
            state.indiceTurno++;
            ejecutarTurno(chatId);
        }, 60000);
    } else {
        iniciarVotacion(chatId);
    }
}


// Escuchador de texto para el jugador en turno con auto-borrado de errores
bot.on('text', (ctx) => {
    if (ctx.chat.type === 'private') return;

    const state = juego.getChatState(ctx.chat.id);
    
    if (state.estado === 'EN_RONDA' && state.colaJugadores && state.indiceTurno < state.colaJugadores.length) {
        const jugadorEsperado = state.colaJugadores[state.indiceTurno];
        
        if (ctx.from.id === jugadorEsperado.id) {
            const palabraIntento = ctx.message.text.trim();

            if (palabraIntento.split(/\s+/).length > 1) {
                ctx.deleteMessage().catch(() => {}); 
                return ctx.reply(`⚠️ ${ctx.from.first_name}, solo puedes decir **UNA** palabra. Inténtalo de nuevo.`);
            }

            if (palabraIntento.toLowerCase() === state.palabraSecreta.toLowerCase()) {
                ctx.deleteMessage().catch(() => {}); 
                return ctx.reply(`🚫 ¡No puedes decir la palabra secreta! Tu mensaje fue eliminado por seguridad. Di otra cosa.`);
            }

            const respuestasPrevias = Array.from(state.respuestas.values()).map(p => p.toLowerCase());
            if (respuestasPrevias.includes(palabraIntento.toLowerCase())) {
                ctx.deleteMessage().catch(() => {}); 
                return ctx.reply(`🔄 Alguien ya dijo esa palabra. ¡Piensa en otra!`);
            }

            clearTimeout(state.timeoutId);
            state.respuestas.set(ctx.from.id, palabraIntento);
            ctx.reply(`✅ ${ctx.from.first_name} ha hablado.`);
            state.indiceTurno++;
            ejecutarTurno(ctx.chat.id);
        }
    }
});


// Desplegar menú de votación
function iniciarVotacion(chatId) {
    const state = juego.getChatState(chatId);
    state.estado = 'VOTACION';

    const botones = [];
    state.jugadores.forEach((player, id) => {
        // Enlazar el voto al chatId específico
        botones.push([Markup.button.callback(`Votar por ${player.name}`, `votar_${chatId}_${id}`)]);
    });

    state.jugadores.forEach((player, id) => {
        bot.telegram.sendMessage(id, '🚨 ¡Es hora de votar! ¿Quién es el impostor?', Markup.inlineKeyboard(botones)).catch(() => {});
    });

    bot.telegram.sendMessage(chatId, '🏁 Fase de charla terminada. Tienen 60 segundos para votar en sus chats privados.');

    state.timeoutId = setTimeout(() => {
        procesarVotacion(chatId);
    }, 60000);
}

// Manejador de botones de votación
bot.action(/votar_(-?\d+)_(.+)/, (ctx) => {
    const chatId = parseInt(ctx.match[1]); // ID del grupo donde se originó el juego
    const votadoId = parseInt(ctx.match[2]);
    const votanteId = ctx.from.id;

    const state = juego.getChatState(chatId);
    if (state.estado !== 'VOTACION') return ctx.answerCbQuery('La votación ya terminó.');

    state.votos.set(votanteId, votadoId);
    ctx.answerCbQuery('✅ Voto registrado');
    ctx.editMessageText('✅ Voto registrado. Esperando a los demás...');

    // Si todos votaron, adelantar resultados
    if (state.votos.size === state.jugadores.size) {
        clearTimeout(state.timeoutId);
        procesarVotacion(chatId);
    }
});

// Procesar resultados, sumar puntos y revelar al impostor
function procesarVotacion(chatId) {
    const state = juego.getChatState(chatId);
    state.estado = 'ESPERA'; // Pausa

    // 1. Contar votos
    let conteo = {};
    state.votos.forEach(votadoId => {
        conteo[votadoId] = (conteo[votadoId] || 0) + 1;
    });

    // 2. Buscar al más votado
    let maxVotos = 0;
    let acusadoId = null;
    for (let id in conteo) {
        if (conteo[id] > maxVotos) {
            maxVotos = conteo[id];
            acusadoId = parseInt(id);
        }
    }

    const impostorId = state.impostorId;
    const impostorObj = state.jugadores.get(impostorId);
    const impostorName = impostorObj ? impostorObj.name : "Desconocido";

    // 3. Regla de mayoría absoluta (más de la mitad de los jugadores)
    const mayoriaAbsoluta = Math.floor(state.jugadores.size / 2) + 1;
    let resultadoTxt = "";

    if (maxVotos >= mayoriaAbsoluta) {
        if (acusadoId === impostorId) {
            resultadoTxt = `🎉 **¡El grupo acertó!** El impostor era **${impostorName}**.\n(Ganan los jugadores que acertaron: +2 pts)`;
            // Dar puntos a los que acertaron
            state.votos.forEach((votado, votante) => {
                if (votado === impostorId) {
                    state.scores.set(votante, (state.scores.get(votante) || 0) + 2);
                }
            });
        } else {
            const inocente = state.jugadores.get(acusadoId).name;
            resultadoTxt = `❌ **Fallaron.** Acusaron a ${inocente}, pero el verdadero impostor era **${impostorName}**.\n(Gana el impostor: +3 pts)`;
            state.scores.set(impostorId, (state.scores.get(impostorId) || 0) + 3);
        }
    } else {
        resultadoTxt = `🤷 **Sin consenso.** No hubo mayoría absoluta en los votos. El impostor sale impune. Era **${impostorName}**.\n(Gana el impostor: +3 pts)`;
        state.scores.set(impostorId, (state.scores.get(impostorId) || 0) + 3);
    }

    // Puntos extra (+1) por participar (haber dado una respuesta en su turno)
    state.respuestas.forEach((_, userId) => {
        state.scores.set(userId, (state.scores.get(userId) || 0) + 1);
    });

    // 4. Mostrar marcador y avanzar
    bot.telegram.sendMessage(chatId, `${resultadoTxt}\n\n📊 **Marcador actual:**\n${mostrarMarcador(state)}`);

    setTimeout(() => {
        if (state.rondaActual < 5) {
            iniciarSiguienteRonda({ chat: { id: chatId } });
        } else {
            anunciarGanadorFinal(chatId);
        }
    }, 8000); // 8 segundos de descanso antes de la siguiente ronda
}

// Función auxiliar para formatear el marcador
function mostrarMarcador(state) {
    let texto = "";
    state.scores.forEach((score, id) => {
        const nombre = state.jugadores.get(id).name;
        texto += `• ${nombre}: ${score} pts\n`;
    });
    return texto;
}

// Finalizar el torneo y declarar al campeón
function anunciarGanadorFinal(chatId) {
    const state = juego.getChatState(chatId);
    let ganador = [...state.scores.entries()].reduce((a, b) => a[1] > b[1] ? a : b);
    const nombreGanador = state.jugadores.get(ganador[0]).name;

    bot.telegram.sendMessage(chatId, `🏆 **¡FIN DEL TORNEO!** 🏆\n\nEl ganador absoluto es **${nombreGanador}** con ${ganador[1]} puntos.\n\nPara jugar un torneo nuevo, utilicen /jugar.`);
    
    // Limpieza de estado final
    state.estado = 'ESPERA';
    state.jugadores.clear();
}

bot.launch();
