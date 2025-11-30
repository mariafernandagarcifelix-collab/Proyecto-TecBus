const mongoose = require("mongoose");

const historialBusquedaSchema = new mongoose.Schema({
  usuario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  ruta: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Ruta",
    required: true,
  },
  ubicacionOrigen: { // Donde estaba el estudiante al buscar
    lat: Number,
    lng: Number
  },
  horaBusqueda: { // Guardamos la hora en formato HH:MM para fácil comparación
    type: String, 
    required: true 
  }
}, { timestamps: true });

module.exports = mongoose.model("HistorialBusqueda", historialBusquedaSchema);