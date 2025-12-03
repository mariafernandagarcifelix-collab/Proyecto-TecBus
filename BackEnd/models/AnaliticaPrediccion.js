// backend/models/AnaliticaPrediccion.js
const mongoose = require("mongoose");

// Basado en tu "Consulta 4"
const prediccionSchema = new mongoose.Schema({
  ruta: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Ruta" 
  },
  hora: { type: String },
});

const analiticaPrediccionSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Es el ID del Estudiante
  nombreEstudiante: { type: String },
  prediccion: prediccionSchema,
  viajesAnalizados: { type: Number },
});

module.exports = mongoose.model(
  "AnaliticaPrediccion",
  analiticaPrediccionSchema
);
