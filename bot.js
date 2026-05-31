require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Diccionario = require('./dictionary');
const juego = require('./gameManager');

const bot = new Telegraf(process.env.BOT_TOKEN);

let colaJugadores = [];
let indiceTurno = 0;
let rondaActual = 1;
let scores = new Map();
let timer;

bot.start((ctx) => ctx.reply('Bot de Spyfall listo. Usa /jugar para comenzar.'));

bot.command('jugar', (ctx) => {
    juego.estado = 'REGISTRO';
    juego.jugadores.clear();
    rondaActual = 1;
    ctx.reply('Registro abierto. Pulsa para unirte:', Markup.inlineKeyboard([
        Markup.button.callback('🙋 Unirse', 'unirse')
    ]));
});

bot.action('unirse', (ctx) => {
    juego.jugadores.set(ctx.from.id, { nombre: ctx.from.first_name });
    ctx.reply(`${ctx.from.first_name} se ha unido.`);
});

bot.command('iniciar', (ctx) => {
    if (juego.jugadores.size < 2) return ctx.reply('Necesitas al menos 2 jugadores.');
    
    // Inicializar scores al inicio de la partida
    juego.jugadores.forEach((_, id) => scores.set(id, 0));
    iniciarRonda(ctx);
});

function iniciarRonda(ctx) {
    juego.estado = 'JUEGO';
    juego.palabraSecreta = Diccionario.obtenerPalabra();
    const ids = Array.from(juego.jugadores.keys());
    juego.impostorId = ids[Math.floor(Math.random() * ids.length)];
    colaJugadores = Array.from(juego.jugadores.entries());
    indiceTurno = 0;

    juego.jugadores.forEach((data, id) => {
        const msg = (id === juego.impostorId) ? '🤫 Eres el IMPOSTOR.' : `🤫 Palabra secreta: ${juego.palabraSecreta}`;
        bot.telegram.sendMessage(id, msg).catch(() => {});
    });

    ctx.reply(`🏁 Comienza la Ronda ${rondaActual}.`);
    ejecutarTurno(ctx);
}

function ejecutarTurno(ctx) {
    if (indiceTurno < colaJugadores.length) {
        const [id, data] = colaJugadores[indiceTurno];
        ctx.reply(`📢 Es el turno de ${data.nombre}. (Tienes 60s)`);
        
        timer = setTimeout(() => {
            ctx.reply(`⏳ Tiempo agotado para ${data.nombre}.`);
            indiceTurno++;
            ejecutarTurno(ctx);
        }, 60000);
    } else {
        iniciarVotacion(ctx);
    }
}

bot.on('text', (ctx) => {
    if (juego.estado === 'JUEGO' && colaJugadores[indiceTurno] && ctx.from.id === colaJugadores[indiceTurno][0]) {
        clearTimeout(timer);
        ctx.reply(`${ctx.from.first_name} ha hablado.`);
        indiceTurno++;
        ejecutarTurno(ctx);
    }
});

function iniciarVotacion(ctx) {
    juego.estado = 'VOTACION';
    ctx.reply('🏁 Ronda terminada. Voten en privado quién es el impostor.');
    // Aquí puedes añadir la lógica de botones que definimos anteriormente
    
    setTimeout(() => {
        rondaActual++;
        if (rondaActual <= 5) {
            iniciarRonda(ctx);
        } else {
            anunciarGanador(ctx);
        }
    }, 10000); // 10 segundos para votar antes de pasar a la siguiente ronda
}

function anunciarGanador(ctx) {
    let ganador = [...scores.entries()].reduce((a, b) => a[1] > b[1] ? a : b);
    ctx.reply(`🏆 ¡Juego terminado! El ganador es ${juego.jugadores.get(ganador[0]).nombre} con ${ganador[1]} puntos.`);
}

bot.launch();
