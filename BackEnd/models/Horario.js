// backend/models/Horario.js

const mongoose = require("mongoose");

// Este es el sub-documento para las Salidas Programadas
const salidaSchema = new mongoose.Schema({
  hora: { type: String, required: true }, // ej: "07:00"
  camionAsignado: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Camion", 
    required: true//
  },
  conductorAsignado: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true //
  },
});

const horarioSchema = new mongoose.Schema(
  {
    ruta: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ruta", //
      required: true,
    },
    diaSemana: {
      type: String,
      required: true,
      enum: [
        "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo",
        "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"
      ], 
    },
    salidas: [salidaSchema]
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Horario", horarioSchema);
