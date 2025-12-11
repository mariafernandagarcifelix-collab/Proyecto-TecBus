// BackEnd/scripts/simulacion_demo.js
require("dotenv").config({ path: "../.env" }); // Ajusta la ruta si es necesario
const mongoose = require("mongoose");
const io = require("socket.io-client");
const Ruta = require("../models/Ruta"); // Asegúrate que la ruta al modelo sea correcta

// ================= CONFIGURACIÓN DE LA DEMO =================
const SOCKET_URL = "http://localhost:5000"; // Tu servidor local
const TICK_RATE = 800; // 1 segundo real = 1 "tick" de movimiento

// ⚠️ PEGA AQUÍ TUS IDs DE MONGODB ⚠️
const ID_CAMION = "693920e7df59303114b2d967"; // ID del camión a mover
const ID_RUTA_1_ROCHIN = "69250b1419e3a2b85600b669"; // ID Ruta Ida
const ID_RUTA_2_BRECHA = "691f582b02e69c1b396ef17a"; // ID Ruta Vuelta (o la 2da ruta)
// ============================================================

const NOMBRE_RUTA_1 = "Ruta Rochin-Tec";
const NOMBRE_RUTA_2 = "Ruta Tec-La Brecha";
const TEXTO_FINAL = "Jornada Finalizada";

const socket = io(SOCKET_URL);

async function iniciarSimulacion() {
  console.log("🎬 --- INICIANDO DEMOSTRACIÓN TECBUS ---");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ BD Conectada.");

  try {
    const r1 = await Ruta.findById(ID_RUTA_1);
    const r2 = await Ruta.findById(ID_RUTA_2);
    if (!r1 || !r2) throw new Error("Rutas no encontradas");

    const puntosR1 = extraerPuntos(r1);
    const puntosR2 = extraerPuntos(r2);

    // ==========================================
    // FASE 1: RUTA 1 (00:01 - Duración aprox 50s)
    // ==========================================
    console.log("\n🚍 FASE 1: Iniciando Ruta 1 [En Servicio]");
    // Usamos 'recorrerRuta' ajustado para durar 50 ticks aprox
    await recorrerRuta(puntosR1, "En Servicio", ID_RUTA_1, 50); 

    // ==========================================
    // FASE 2: LLEGADA (00:01:50 - Duración 10s)
    // ==========================================
    console.log("\n🛑 FASE 2: Llegada al TEC [Abordando] (10s)");
    
    // 1. Cambiar estado y disparar alerta
    const ultimoPuntoR1 = puntosR1[puntosR1.length - 1];
    socket.emit("driverLocationUpdate", {
        camionId: ID_CAMION,
        location: ultimoPuntoR1,
        heading: 0,
        estado: "Abordando",
        velocidad: 0,
        rutaId: ID_RUTA_1,
        // DATOS PARA NOTIFICACIÓN PREDICTIVA:
        triggerPrediction: true,
        userId: ID_ESTUDIANTE_MARIA,
        userName: NOMBRE_ESTUDIANTE
    });

    // 2. Esperar 10 segundos
    await esperar(10000); 

    // ==========================================
    // FASE 3: RUTA 2 (00:02:00 - Duración aprox 50s)
    // ==========================================
    console.log("\n🚍 FASE 3: Iniciando Ruta 2 [En Servicio]");
    await recorrerRuta(puntosR2, "En Servicio", ID_RUTA_2, 50);

    // ==========================================
    // FASE 4: FIN (00:02:50 - Fin)
    // ==========================================
    console.log("\n🏁 FASE 4: Fin del trayecto [Fuera de Servicio]");
    const ultimoPuntoR2 = puntosR2[puntosR2.length - 1];
    
    socket.emit("driverLocationUpdate", {
        camionId: ID_CAMION,
        location: ultimoPuntoR2,
        heading: 0,
        estado: "Fuera de Servicio",
        velocidad: 0,
        rutaId: ID_RUTA_2
    });
    
    console.log("\n✅ DEMOSTRACIÓN FINALIZADA.");
    process.exit(0);

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

// --- FUNCIONES ---

async function recorrerRuta(puntos, estado, rutaId, pasosObjetivo) {
    return new Promise(resolve => {
        let i = 0;
        // Calculamos cuántos puntos saltar para que dure 'pasosObjetivo' ticks
        const salto = Math.max(1, Math.floor(puntos.length / pasosObjetivo));
        
        const intervalo = setInterval(() => {
            if (i >= puntos.length) {
                clearInterval(intervalo);
                resolve();
                return;
            }
            
            const p = puntos[i];
            const vel = Math.floor(Math.random() * (50 - 20) + 20); // 20-50 km/h
            
            socket.emit("driverLocationUpdate", {
                camionId: ID_CAMION,
                location: p,
                heading: 0,
                estado: estado,
                velocidad: vel,
                rutaId: rutaId 
            });
            
            process.stdout.write("."); // Feedback visual
            i += salto;
        }, TICK_RATE);
    });
}

function extraerPuntos(rutaDoc) {
    return rutaDoc.paradas
        .filter(p => p.ubicacion && p.ubicacion.coordinates)
        .map(p => ({
            lat: p.ubicacion.coordinates[1],
            lng: p.ubicacion.coordinates[0]
        }));
}

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 🔥 ENCENDEMOS EL MOTOR
iniciarSimulacion();