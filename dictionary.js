const fs = require('fs');
const palabras = JSON.parse(fs.readFileSync('words.json', 'utf8'));
let usadas = new Set();

module.exports = {
    obtenerPalabra: () => {
        if (usadas.size >= palabras.length) usadas.clear();
        let options = palabras.filter(p => !usadas.has(p));
        let seleccion = options[Math.floor(Math.random() * options.length)];
        usadas.add(seleccion);
        return seleccion;
    }
};
