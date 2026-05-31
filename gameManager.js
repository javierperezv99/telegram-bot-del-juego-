class GestorJuego {
    constructor() {
        this.jugadores = new Map();
        this.palabraSecreta = "";
        this.impostorId = null;
        this.estado = 'ESPERA';
    }
}
module.exports = new GestorJuego();
