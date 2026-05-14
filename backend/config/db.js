const mysql = require('mysql2');

const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: 'yara*INSIGHTS*2026',
    database: 'mon_projet_pfe',
    port: 3306
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('Erreur de connexion a MySQL:', err.message);
    } else {
        console.log('Connexion a MySQL reussie');
        console.log('Base de donnees: mon_projet_pfe');
        connection.release();
    }
});

module.exports = pool.promise();