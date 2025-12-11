const mongoose = require('mongoose');

const estadisticaSchema = new mongoose.Schema({
  // Identificador compuesto (Unidad + Fecha) para saber qué documento actualizar
  claveDiaria: { type: String, required: true, unique: true }, // Ej: "UNIDAD-20_2023-11-15"
  
  numeroUnidad: { type: String, required: true },
  fecha: { type: Date, required: true }, // La fecha sin hora (00:00:00)
  
  // Métricas acumulativas
  distanciaTotal: { type: Number, default: 0 }, // En Metros
  velocidadMaxima: { type: Number, default: 0 }, // Km/h
  totalPuntosReportados: { type: Number, default: 0 }, // Para calcular calidad de señal
  
  ultimaActualizacion: { type: Date, default: Date.now }
});

// Índices para reportes rápidos (Ej: "Dame el kilometraje de la semana pasada")
estadisticaSchema.index({ numeroUnidad: 1, fecha: 1 });

module.exports = mongoose.model('EstadisticaDiaria', estadisticaSchema);