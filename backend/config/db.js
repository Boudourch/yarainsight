const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'mon_projet_pfe',
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
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