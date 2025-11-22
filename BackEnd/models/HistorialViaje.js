// backend/models/HistorialViaje.js
const mongoose = require("mongoose");

// Tu DB planea una colección 'historialViajes'
const historialViajeSchema = new mongoose.Schema({
  estudianteId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  ruta: { type: String }, // Simplificado por ahora
  horaProgramada: { type: String }, // ej: "07:00"
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("HistorialViaje", historialViajeSchema);
