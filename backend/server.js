const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes       = require('./routes/authRoutes');
const countryRoutes    = require('./routes/countryRoutes');
const userRoutes       = require('./routes/userRoutes');
const predictionRoutes = require('./routes/predictionRoutes');

// Preload prediction engine at startup
require('./predictionEngine');

const app  = express();
const PORT = 5001;

app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Routes
app.use('/api/auth',        authRoutes);
app.use('/api/countries',   countryRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/predictions', predictionRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.listen(PORT, () => {
    console.log(' Serveur démarré sur http://localhost:' + PORT);
    console.log(' Auth        → /api/auth');
    console.log(' Countries   → /api/countries');
    console.log(' Users       → /api/users');
    console.log(' Predictions → /api/predictions/africa');
});