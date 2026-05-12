const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'mon_secret_jwt_pfe_2026';

const normalizeRole = (role) => {
    if (typeof role !== 'string') return '';
    return role.trim().toLowerCase();
};

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Accès non autorisé. Token requis.'
        });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({
                success: false,
                message: 'Token invalide ou expiré'
            });
        }

        req.user = {
            ...user,
            role: normalizeRole(user.role)
        };

        next();
    });
};

const isAdmin = (req, res, next) => {
    const role = normalizeRole(req.user?.role);

    if (role === 'admin') return next();

    return res.status(403).json({
        success: false,
        message: 'Accès refusé. Droits administrateur requis.'
    });
};

// ✅ Admin OR Manager
const isAdminOrManager = (req, res, next) => {
    const role = normalizeRole(req.user?.role);

    if (role === 'admin' || role === 'manager') return next();

    return res.status(403).json({
        success: false,
        message: 'Accès refusé. Droits administrateur ou manager requis.'
    });
};

const isNotBlocked = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const user = await User.getUserWithStatus(userId);

        if (user.statut === 'bloque') {
            return res.status(403).json({
                success: false,
                message: 'Compte bloqué. Veuillez contacter l\'administrateur.'
            });
        }

        next();
    } catch (error) {
        console.error('Erreur isNotBlocked:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
};

const isActiveOrInactive = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const user = await User.getUserWithStatus(userId);

        if (user.statut === 'bloque') {
            return res.status(403).json({
                success: false,
                message: 'Compte bloqué'
            });
        }

        req.user.statut = user.statut;
        req.user.jours_inactivite = user.jours_inactivite;

        next();
    } catch (error) {
        console.error('Erreur isActiveOrInactive:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
};

module.exports = {
    authenticateToken,
    isAdmin,
    isAdminOrManager, // export
    isNotBlocked,
    isActiveOrInactive
};