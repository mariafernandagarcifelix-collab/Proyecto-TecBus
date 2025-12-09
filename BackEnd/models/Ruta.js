// backend/models/Ruta.js

const mongoose = require("mongoose");

// Re-usamos el sub-documento GeoJSON
const pointSchema = new mongoose.Schema({
  type: { type: String, enum: ["Point"], required: true },
  coordinates: { type: [Number], required: true },
});

// Este es el sub-documento para las Paradas
const paradaSchema = new mongoose.Schema({
  nombre: { type: String },
  orden: { type: Number },
  ubicacion: { type: pointSchema }, //
  tiempoEstimado: { type: Number }, //
  tipo: { 
      type: String, 
      enum: ['trazo', 'parada_oficial'], 
      default: 'parada_oficial' 
  }
});

const rutaSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: true,
      unique: true, //
    },
    descripcion: { type: String },
    paradas: [paradaSchema], // Un arreglo de las paradas que definimos arriba
    distanciaTotal: { type: Number }, //
    tiempoEstimadoTotal: { type: Number }, //
    activa: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Ruta", rutaSchema);
