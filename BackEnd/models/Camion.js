// backend/models/Camion.js

const mongoose = require('mongoose');

// Este es el sub-documento para GeoJSON que definiste
const pointSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['Point'],
        required: true
    },
    coordinates: {
        type: [Number], // [longitud, latitud]
        required: true
    }
});

const camionSchema = new mongoose.Schema({
    numeroUnidad: { type: String, required: true },
    placa: { type: String, required: true, unique: true },
    modelo: { type: String },
    año: { type: Number },
    capacidad: { type: Number },
    estado: {
        type: String,
        enum: ['activo', 'mantenimiento', 'inactivo'], //
        default: 'activo'
    },
    // Referencias a otras colecciones
    conductorActual: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Referencia a tu modelo 'User'
        required: false
    },
    rutaAsignada: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Ruta' // Referencia al modelo 'Ruta' que crearemos
    },
    // Datos en tiempo real
    ubicacionActual: {
        type: pointSchema,
        index: '2dsphere' // ¡Importante! Esto activa las búsquedas geoespaciales
    },
    ultimaActualizacion: { type: Date },
    velocidad: { type: Number }, //
    direccion: { type: Number } //
}, {
    timestamps: true // Añade createdAt y updatedAt
});

module.exports = mongoose.model('Camion', camionSchema);