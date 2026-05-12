const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'mon_secret_jwt_pfe_2026';

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, message: 'Non autorise' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Token invalide' });
    }
};

router.get('/', authMiddleware, async (req, res) => {
    try {
        console.log('Recuperation des pays...');
        
        const [countries] = await db.execute('SELECT * FROM liste_pays');
        
        console.log('Nombre de pays trouves:', countries.length);
        
        if (countries.length === 0) {
            console.log('Aucun pays trouve dans la table liste_pays');
        }
        
        res.json(countries);
        
    } catch (error) {
        console.error('Erreur SQL:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur: ' + error.message 
        });
    }
});

module.exports = router;