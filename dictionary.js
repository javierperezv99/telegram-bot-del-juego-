const fs = require('fs');

// Leemos el archivo JSON de forma síncrona al iniciar el bot
const palabras = JSON.parse(fs.readFileSync('words.json', 'utf8'));

// Usamos un Set para guardar las palabras que ya salieron y no repetirlas
let usadas = new Set();

module.exports = {
    obtenerPalabra: () => {
        // Si ya usamos todas las palabras del diccionario, vaciamos el historial para empezar de nuevo
        if (usadas.size >= palabras.length) {
            usadas.clear();
        }
        
        // Filtramos las palabras para quedarnos solo con las que no están en el Set de "usadas"
        let opcionesDisponibles = palabras.filter(p => !usadas.has(p));
        
        // Elegimos una al azar de las disponibles
        let seleccion = opcionesDisponibles[Math.floor(Math.random() * opcionesDisponibles.length)];
        
        // La marcamos como usada para las próximas rondas
        usadas.add(seleccion);
        
        return seleccion;
    }
};
