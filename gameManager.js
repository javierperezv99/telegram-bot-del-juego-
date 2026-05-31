class GestorJuego {
    constructor() {
        // Mapa principal para guardar el estado independiente de cada grupo (chatId)
        this.chats = new Map(); 
    }

    // Función para obtener (o crear) el estado de una partida en un grupo específico
    getChatState(chatId) {
        // Si el grupo no existe en la memoria, le creamos una estructura en blanco
        if (!this.chats.has(chatId)) {
            this.chats.set(chatId, {
                jugadores: new Map(),  // Guarda a los jugadores unidos: ID -> { id, name }
                scores: new Map(),     // Puntuación de cada jugador: ID -> Puntos
                rondaActual: 0,        // Controla en qué ronda va el juego (de 1 a 5)
                palabraSecreta: "",    // La palabra que todos (menos el impostor) deben saber
                impostorId: null,      // El ID de Telegram del impostor actual
                respuestas: new Map(), // Para verificar quién ya habló en su turno
                votos: new Map(),      // Registro de las votaciones: votanteId -> votadoId
                estado: 'ESPERA',      // Estados posibles: ESPERA, REGISTRO, EN_RONDA, VOTACION
                timeoutId: null,       // Temporizador para controlar el tiempo límite (60s)
                colaJugadores: [],     // Lista ordenada para controlar los turnos
                indiceTurno: 0         // Saber a quién le toca hablar
            });
        }
        
        // Devolvemos el estado actual de ese grupo
        return this.chats.get(chatId);
    }
}

// Exportamos una única instancia (Singleton) para que todo el bot comparta la misma memoria
module.exports = new GestorJuego();
