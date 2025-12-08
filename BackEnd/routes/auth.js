// backend/routes/auth.js

const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Importamos nuestro Modelo de Usuario
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- RUTA DE REGISTRO (POST /api/auth/register) ---
router.post('/register', async (req, res) => {
    try {
        const { nombre, email, password } = req.body;

        // 1. Validar que los datos estén
        if (!nombre || !email || !password) {
            return res.status(400).json({ message: 'Por favor, introduce todos los campos.' });
        }
        
        // 2. Revisar si el usuario ya existe (basado en tu PDF)
        const userExists = await User.findOne({ email: email });
        if (userExists) {
            return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
        }

        // 3. Encriptar la contraseña (basado en tu PDF "Hash")
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Crear el nuevo usuario (tipo 'estudiante' por defecto)
        // Usamos el Schema que definimos en tu PDF
        const newUser = new User({
            nombre: nombre,
            email: email,
            password: hashedPassword,
            tipo: 'estudiante', // Por defecto al registrarse
            estudiante: { // Llenamos los datos de estudiante
                matricula: "PENDIENTE", // El admin puede llenar esto después
                carrera: "PENDIENTE"
            }
        });

        // 5. Guardar en la Base de Datos
        const savedUser = await newUser.save();

        // 6. Enviar una respuesta exitosa
        res.status(201).json({ 
            message: '¡Usuario registrado exitosamente!',
            userId: savedUser._id 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// --- RUTA DE LOGIN (POST /api/auth/login) ---
// (La creamos ahora para tenerla lista)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Revisar si el usuario existe
        const user = await User.findOne({ email: email });
        if (!user) {
            return res.status(400).json({ message: 'Credenciales incorrectas.' });
        }

        // 2. Comparar la contraseña
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Credenciales incorrectas.' });
        }

        // 3. Crear un Token (JWT)
        const token = jwt.sign(
            { id: user._id, tipo: user.tipo }, // Guardamos el ID y el ROL en el token
            process.env.JWT_SECRET || 'secreto_de_respaldo', // (Deberíamos añadir JWT_SECRET al .env)
            { expiresIn: '1d' } // El token expira en 1 día
        );

        // 4. Enviar el token al frontend
        // res.json({
        //     token: token,
        //     user: {
        //         id: user._id,
        //         nombre: user.nombre,
        //         email: user.email,
        //         tipo: user.tipo
        //     }
        // });
        res.json({
            token: token,
            user: {
                id: user._id,
                nombre: user.nombre,
                email: user.email,
                tipo: user.tipo,
                // 👇 ESTO ES LO NUEVO: Enviamos los datos específicos del rol
                conductor: user.conductor,
                estudiante: user.estudiante,
                administrador: user.administrador
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});


module.exports = router;