const User = require('../models/User');
const crypto = require('crypto');
const transporter = require('../config/mailer');

// Email wrapper template
function emailWrapper(content) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:30px;border:1px solid #e0e0e0;border-radius:10px;background:#fff;">
        ${content}
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="color:#aaa;font-size:12px;text-align:center;">© 2026 Yara Insights — All rights reserved</p>
    </div>`;
}

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
        const { nom, prenom, email, telephone, role } = req.body;
        const creatorRole = req.user.role; // 'admin' or 'manager'
        
        console.log(`Attempting to add user: ${email} by ${creatorRole}`);
        
        // Check required fields
        if (!nom || !prenom || !email) {
            return res.status(400).json({ 
                success: false, 
                message: 'First name, last name and email are required' 
            });
        }
        
        // Manager can only create 'user' role
        if (creatorRole === 'manager' && role && role !== 'user') {
            return res.status(403).json({ 
                success: false, 
                message: 'Manager can only create regular users' 
            });
        }
        
        // Check if email already exists
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'This email is already used' 
            });
        }
        
        // Generate temporary password (8 characters)
        const tempPassword = Math.random().toString(36).slice(-8);
        
        // Generate verification token
        const verification_token = crypto.randomBytes(32).toString('hex');
        const verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        // Create user with temporary password and verification token
        const userId = await User.createWithToken({ 
            nom, 
            prenom, 
            email, 
            mot_de_passe: tempPassword,
            telephone: telephone || null,
            role: role || 'user',
            verification_token,
            verification_expires
        });
        
        // Send confirmation email with temporary password
        const confirmLink = `http://localhost:5001/api/auth/verify-email/${verification_token}`;
        
        await transporter.sendMail({
            from: `"Yara Insights" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Your Yara Insights account has been created',
            html: emailWrapper(`
                <h2 style="color:#E8B84B;">Welcome to Yara Insights, ${prenom}! </h2>
                <p>An account has been created for you by <strong>${creatorRole === 'admin' ? 'an administrator' : 'a manager'}</strong>.</p>
                
                <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0;">
                    <p style="margin:5px 0;"><strong> Email:</strong> ${email}</p>
                    <p style="margin:5px 0;"><strong> Temporary password:</strong> <span style="background:#E8B84B;padding:3px 8px;border-radius:5px;font-weight:bold;">${tempPassword}</span></p>
                    <p style="margin:5px 0;"><strong> Role:</strong> ${role || 'user'}</p>
                </div>
                
                <p>Click below to confirm your email and activate your account:</p>
                <div style="text-align:center;margin:30px 0;">
                    <a href="${confirmLink}" 
                       style="background:#E8B84B;color:#000;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;display:inline-block;font-weight:bold;">
                         Confirm my account
                    </a>
                </div>
                <p style="color:#888;font-size:13px;">This link expires in <strong>24 hours</strong>.</p>
                <p style="color:#888;font-size:13px;">After confirmation, you can log in and change your password.</p>
            `)
        });
        
        console.log(`User created: ${email} by ${creatorRole}, confirmation email sent`);
        
        res.json({ 
            success: true, 
            message: `User created successfully. A confirmation email has been sent to ${email}.`,
            userId: userId 
        });
        
    } catch (error) {
        console.error('Error addUser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + error.message 
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