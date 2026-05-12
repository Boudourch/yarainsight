const User = require('../models/User');
const crypto = require('crypto');
const transporter = require('../config/mailer');

// ========== VERIFIER UTILISATEUR CONNECTE ==========
exports.verifyUser = async (req, res) => {
    try {
        const userId = req.user.id;
        
        await User.updateAllUsersStatus();
        
        const user = await User.getUserWithStatus(userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Utilisateur non trouve' 
            });
        }
        
        res.json({
            success: true,
            user: {
                id: user.id,
                nom: user.nom,
                prenom: user.prenom,
                email: user.email,
                telephone: user.telephone,
                role: user.role,
                statut: user.statut,
                jours_inactivite: user.jours_inactivite
            }
        });
        
    } catch (error) {
        console.error('Erreur verifyUser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur' 
        });
    }
};

// ========== RECUPERER TOUS LES UTILISATEURS ==========
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.getAllUsers();
        res.json({ 
            success: true, 
            users 
        });
    } catch (error) {
        console.error('Erreur getAllUsers:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur' 
        });
    }
};

// ========== BLOQUER UN UTILISATEUR ==========
exports.bloquerUser = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vous ne pouvez pas vous bloquer vous-meme' 
            });
        }
        
        await User.bloquerUser(id);
        
        console.log(`Utilisateur ${id} bloque par admin ${req.user.id}`);
        
        res.json({ 
            success: true, 
            message: 'Utilisateur bloque avec succes' 
        });
    } catch (error) {
        console.error('Erreur bloquerUser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur' 
        });
    }
};

// ========== DEBLOQUER UN UTILISATEUR ==========
exports.debloquerUser = async (req, res) => {
    try {
        const { id } = req.params;
        
        await User.debloquerUser(id);
        
        console.log(`Utilisateur ${id} debloque par admin ${req.user.id}`);
        
        res.json({ 
            success: true, 
            message: 'Utilisateur debloque avec succes' 
        });
    } catch (error) {
        console.error('Erreur debloquerUser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur' 
        });
    }
};

// ========== METTRE A JOUR TOUS LES STATUTS ==========
exports.updateAllStatuses = async (req, res) => {
    try {
        const result = await User.updateAllUsersStatus();
        
        res.json({ 
            success: true, 
            message: 'Statuts mis a jour',
            affectedRows: result.affectedRows
        });
    } catch (error) {
        console.error('Erreur updateAllStatuses:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur' 
        });
    }
};

// ========== STATISTIQUES ==========
exports.getUserStats = async (req, res) => {
    try {
        const users = await User.getAllUsers();
        
        const stats = {
            total: users.length,
            actifs: users.filter(u => u.statut === 'actif').length,
            inactifs: users.filter(u => u.statut === 'inactif').length,
            bloques: users.filter(u => u.statut === 'bloque').length,
            admins: users.filter(u => u.role === 'admin').length,
            users_normaux: users.filter(u => u.role === 'user').length
        };
        
        res.json({ 
            success: true, 
            stats 
        });
    } catch (error) {
        console.error('Erreur getUserStats:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur' 
        });
    }
};

// ========== AJOUTER UN UTILISATEUR (ADMIN/MANAGER) ==========
exports.addUser = async (req, res) => {
    try {
        const { nom, prenom, email, mot_de_passe, telephone, role } = req.body;
        
        console.log('Tentative ajout user:', email);
        
        // Champs obligatoires
        if (!nom || !prenom || !email || !mot_de_passe) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nom, prenom, email et mot de passe sont requis' 
            });
        }
        
        // Email déjà utilisé ?
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cet email existe deja' 
            });
        }
        
        // Génère token de vérification
        const verification_token = crypto.randomBytes(32).toString('hex');
        const verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        // Crée user avec statut inactif + token
        const userId = await User.createWithToken({ 
            nom, 
            prenom, 
            email, 
            mot_de_passe, 
            telephone: telephone || null,
            role: role || 'user',
            verification_token,
            verification_expires
        });

        // Envoie email de confirmation
        const confirmLink = `http://localhost:5001/api/auth/verify-email/${verification_token}`;

        await transporter.sendMail({
            from: `"Yara Insights" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Confirmez votre compte Yara Insights",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 30px; border: 1px solid #e0e0e0; border-radius: 10px;">
                    <h2 style="color: #E8B84B;">Bienvenue sur Yara Insights, ${prenom} ! 👋</h2>
                    <p style="color: #444;">Un compte a été créé pour vous. Cliquez ci-dessous pour confirmer votre email et activer votre compte :</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${confirmLink}" 
                           style="background-color: #E8B84B; color: #000; padding: 14px 28px; 
                                  border-radius: 8px; text-decoration: none; font-size: 16px; 
                                  display: inline-block; font-weight: bold;">
                            ✅ Confirmer mon compte
                        </a>
                    </div>
                    <p style="color: #888; font-size: 13px;">Ce lien expire dans <strong>24 heures</strong>.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #aaa; font-size: 12px; text-align: center;">© 2026 Yara Insights — Tous droits réservés</p>
                </div>
            `
        });
        
        console.log('Utilisateur ajoute et email envoye:', email);
        
        res.json({ 
            success: true, 
            message: 'Utilisateur créé, email de confirmation envoyé',
            userId: userId 
        });
        
    } catch (error) {
        console.error('Erreur addUser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur: ' + error.message 
        });
    }
};

// ========== SUPPRIMER UN UTILISATEUR ==========
exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log('Tentative suppression user ID:', id);
        
        if (!id || isNaN(id)) {
            return res.status(400).json({ 
                success: false, 
                message: 'ID utilisateur invalide' 
            });
        }
        
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vous ne pouvez pas vous supprimer vous-meme' 
            });
        }
        
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Utilisateur non trouve' 
            });
        }
        
        await User.deleteUser(id);
        
        console.log('Utilisateur supprime ID:', id);
        
        res.json({ 
            success: true, 
            message: 'Utilisateur supprime avec succes' 
        });
        
    } catch (error) {
        console.error('Erreur deleteUser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur: ' + error.message 
        });
    }
};