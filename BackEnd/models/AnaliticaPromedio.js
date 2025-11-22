// backend/models/AnaliticaPromedio.js
const mongoose = require('mongoose');

// Basado en tu "Consulta 3"
const analiticaPromedioSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camion' }, // Es el ID del Camión
    unidad: { type: String },
    velocidadPromedio: { type: Number },
    totalPings: { type: Number }
});

module.exports = mongoose.model('AnaliticaPromedio', analiticaPromedioSchema);