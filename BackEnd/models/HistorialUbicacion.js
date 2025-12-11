const mongoose = require('mongoose');

const historialSchema = new mongoose.Schema({
  camionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Camion',
    required: true
  },
  numeroUnidad: String,
  ubicacion: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: [Number]
  },
  velocidad: Number,
  timestamp: { type: Date, default: Date.now } // Hora exacta del reporte
});

// Índice por tiempo para borrar datos viejos automáticamente (TTL)
// Ejemplo: Borrar historial después de 30 días para ahorrar espacio
historialSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 }); 

module.exports = mongoose.model('HistorialUbicacion', historialSchema, 'historialUbicaciones');