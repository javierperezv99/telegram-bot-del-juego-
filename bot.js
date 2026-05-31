require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Diccionario = require('./dictionary');
const juego = require('./gameManager');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('Bot iniciado. Usa /jugar para empezar.'));

bot.command('jugar', (ctx) => {
    juego.estado = 'REGISTRO';
    juego.jugadores.clear();
    ctx.reply('Registro abierto. Pulsa para unirte:', Markup.inlineKeyboard([
        Markup.button.callback('🙋 Unirse', 'unirse')
    ]));
});

bot.action('unirse', (ctx) => {
    juego.jugadores.set(ctx.from.id, { nombre: ctx.from.first_name });
    ctx.reply(`${ctx.from.first_name} se ha unido.`);
});

bot.command('iniciar', (ctx) => {
    juego.estado = 'JUEGO';
    juego.palabraSecreta = Diccionario.obtenerPalabra();
    const ids = Array.from(juego.jugadores.keys());
    juego.impostorId = ids[Math.floor(Math.random() * ids.length)];

    juego.jugadores.forEach((data, id) => {
        const msg = (id === juego.impostorId) ? '🤫 Eres el IMPOSTOR.' : `🤫 Palabra secreta: ${juego.palabraSecreta}`;
        bot.telegram.sendMessage(id, msg).catch(() => {});
    });
    ctx.reply('Partida iniciada. 60 segundos para hablar.');
    
    setTimeout(() => ctx.reply('¡Tiempo terminado! Hora de votar.'), 60000);
});
// Función para generar botones de votación
function iniciarVotacion(ctx) {
    const botones = [];
    juego.jugadores.forEach((data, id) => {
        // Creamos un botón por cada jugador (excepto el que vota, que se añadiría luego)
        botones.push([Markup.button.callback(`Votar por ${data.nombre}`, `voto_${id}`)]);
    });

    juego.jugadores.forEach((data, id) => {
        bot.telegram.sendMessage(id, '¿Quién crees que es el impostor?', Markup.inlineKeyboard(botones));
    });
}

// Y dentro del setTimeout, llama a la función:
setTimeout(() => {
    juego.estado = 'VOTACION';
    ctx.reply('¡Tiempo terminado! Hora de votar. Revisa tu chat privado.');
    iniciarVotacion(ctx);
}, 60000);

// Manejador del voto (cuando alguien pulsa el botón)
bot.action(/voto_(.+)/, (ctx) => {
    const votadoId = ctx.match[1];
    const votanteId = ctx.from.id;
    juego.votos.set(votanteId, votadoId);
    ctx.answerCbQuery('¡Voto registrado!');
    ctx.editMessageText('✅ Voto registrado. Esperando a los demás...');
});


bot.on('text', (ctx) => {
    if (juego.estado === 'JUEGO' && juego.jugadores.has(ctx.from.id)) {
        ctx.reply(`${ctx.from.first_name} dice: ${ctx.message.text}`);
    }
});

bot.launch();
