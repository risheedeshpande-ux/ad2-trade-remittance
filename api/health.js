/* Vercel function: /api/health — see server/app.js */
module.exports = require('../server/app').route('health');
