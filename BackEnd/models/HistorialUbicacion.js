// backend/models/HistorialUbicacion.js
const mongoose = require("mongoose");

// Tu DB planea una colección 'historialUbicaciones'
const historialUbicacionSchema = new mongoose.Schema({
  camionId: { type: mongoose.Schema.Types.ObjectId, ref: "Camion" },
  timestamp: { type: Date, default: Date.now },
  velocidad: { type: Number },
  ubicacion: {
    type: { type: String, enum: ["Point"], required: true },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
});

module.exports = mongoose.model("HistorialUbicacion", historialUbicacionSchema);
