const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const JWT_SECRET = process.env.JWT_SECRET || 'mon_secret_jwt_pfe_2026';

exports.register = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { nom, prenom, email, mot_de_passe, telephone } = req.body;

        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Cet email est deja utilise' });
        }

        const userId = await User.create({ nom, prenom, email, mot_de_passe, telephone });

        const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            success: true,
            message: 'Inscription reussie',
            token,
            user: { id: userId, nom, prenom, email, role: 'user' }
        });
    } catch (error) {
        console.error('Erreur inscription:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};

exports.login = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { email, mot_de_passe } = req.body;

        // 1. Chercher l'utilisateur
        const user = await User.findByEmail(email);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
        }

        // 2. Verifier mot de passe
        const isValidPassword = await User.verifyPassword(mot_de_passe, user.mot_de_passe);
        if (!isValidPassword) {
            return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
        }

        // 3. Mettre a jour tous les statuts (pour etre a jour)
        await User.updateAllUsersStatus();

        // 4. Recuperer l'utilisateur avec son statut calcule
        const userWithStatus = await User.getUserWithStatus(user.id);
        
        // 5. Verifier si compte bloque
        if (userWithStatus.statut === 'bloque') {
            return res.status(403).json({ 
                success: false, 
                message: 'Compte bloque. Veuillez contacter l\'administrateur.',
                statut: 'bloque'
            });
        }

        // 6. Mettre a jour la derniere connexion
        await User.updateLastLogin(user.id);

        // 7. Creer le token JWT avec role
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                statut: userWithStatus.statut 
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // 8. Preparer la reponse
        const responseData = {
            success: true,
            message: 'Connexion reussie',
            token,
            user: {
                id: user.id,
                nom: user.nom,
                prenom: user.prenom,
                email: user.email,
                telephone: user.telephone,
                role: user.role,
                statut: userWithStatus.statut,
                jours_inactivite: userWithStatus.jours_inactivite
            }
        };

        // 9. Ajouter un avertissement si compte inactif
        if (userWithStatus.statut === 'inactif') {
            responseData.warning = `Compte inactif depuis ${userWithStatus.jours_inactivite} jours. Connectez-vous pour le reactiver.`;
        }

        console.log('Connexion reussie pour:', email, 'Role:', user.role);
        res.json(responseData);

    } catch (error) {
        console.error('Erreur connexion:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};

// NOUVELLE FONCTION: Verifier le statut d'un utilisateur connecte
exports.checkStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Mettre a jour les statuts
        await User.updateAllUsersStatus();
        
        // Recuperer user avec statut
        const user = await User.getUserWithStatus(userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouve' });
        }
        
        const response = {
            success: true,
            statut: user.statut,
            jours_inactivite: user.jours_inactivite,
            derniere_connexion: user.derniere_connexion,
            date_inscription: user.date_inscription
        };
        
        // Ajouter message personnalise
        if (user.statut === 'actif') {
            response.message = `Compte actif. Derniere activite il y a ${user.jours_inactivite} jours.`;
        } else if (user.statut === 'inactif') {
            response.message = `Compte inactif depuis ${user.jours_inactivite} jours. Connectez-vous pour le reactiver.`;
            response.warning = true;
        } else if (user.statut === 'bloque') {
            response.message = 'Compte bloque. Contactez l\'administrateur.';
        }
        
        res.json(response);
        
    } catch (error) {
        console.error('Erreur checkStatus:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};

// NOUVELLE FONCTION: Rafraichir le token avec nouveau statut
exports.refreshToken = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Mettre a jour les statuts
        await User.updateAllUsersStatus();
        
        // Recuperer user avec statut
        const user = await User.getUserWithStatus(userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouve' });
        }
        
        // Verifier si bloque
        if (user.statut === 'bloque') {
            return res.status(403).json({ 
                success: false, 
                message: 'Compte bloque',
                statut: 'bloque'
            });
        }
        
        // Creer nouveau token
        const newToken = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                statut: user.statut 
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token: newToken,
            user: {
                id: user.id,
                nom: user.nom,
                prenom: user.prenom,
                email: user.email,
                role: user.role,
                statut: user.statut,
                jours_inactivite: user.jours_inactivite
            }
        });
        
    } catch (error) {
        console.error('Erreur refreshToken:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};