// backend/models/Horario.js

const mongoose = require("mongoose");

// Este es el sub-documento para las Salidas Programadas
const salidaSchema = new mongoose.Schema({
  hora: { type: String, required: true }, // ej: "07:00"
  camionAsignado: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Camion", //
  },
  conductorAsignado: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", //
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
        "lunes",
        "martes",
        "miercoles",
        "jueves",
        "viernes",
        "sabado",
        "domingo",
      ], //
    },
    salidas: [salidaSchema],
    agencia: { type: String },
    validoDesde: { type: Date, default: Date.now },
    validoHasta: { type: Date },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Horario", horarioSchema);
