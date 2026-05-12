const express = require('express');
const router = express.Router();
const engine = require('../predictionEngine');

router.get('/africa', (req, res) => {
  try {
    res.json({
      success: true,
      data: engine.getAll(),
      statistics: engine.getStats(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/africa/stats', (req, res) => {
  try {
    res.json({ success: true, data: engine.getStats() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/africa/top', (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || 2025;
    const n = parseInt(req.query.n, 10) || 10;

    if (year < 2019 || year > 2030) {
      return res.status(400).json({ success: false, error: 'Year must be 2019-2030' });
    }

    res.json({ success: true, year, data: engine.getTopN(year, n) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/country/:name', (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const data = engine.getCountry(name);

    if (!data) {
      return res.status(404).json({ success: false, error: `"${name}" not found` });
    }

    res.json({ success: true, country: name, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/africa/report', (req, res) => {
  try {
    const report = engine.getReport();
    res.json({
      success: true,
      ...report,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/all', (req, res) => {
  try {
    res.json({
      success: true,
      data: engine.getAll(),
      statistics: engine.getStats(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;