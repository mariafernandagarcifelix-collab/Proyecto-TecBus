// backend/models/Notificacion.js

const mongoose = require("mongoose");

// Este es el sub-documento para 'relacionCon' que diseñaste
const relacionSchema = new mongoose.Schema({
  tipo: {
    type: String,
    enum: ["ruta", "camion", "usuario"], //
  },
  id: {
    type: mongoose.Schema.Types.ObjectId,
    // (No podemos hacer 'ref' dinámico, así que guardamos el ID)
  },
});

const notificacionSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      required: true,
      enum: ["alerta", "aviso", "incidente", "recordatorio"], //
    },
    titulo: {
      type: String,
      required: true, //
    },
    mensaje: {
      type: String, //
    },
    relacionCon: {
      type: relacionSchema, //
    },
    prioridad: {
      type: String,
      enum: ["baja", "media", "alta", "urgente"], //
      default: "media",
    },camionId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Camion' 
    },
    // (Omitimos 'destinatarios' por ahora para simplificar,
    // ya que las alertas de incidentes son para todos)
  },
  {
    timestamps: true, // Esto crea 'createdAt' (fechaCreacion) y 'updatedAt'
  }
);

module.exports = mongoose.model("Notificacion", notificacionSchema);
