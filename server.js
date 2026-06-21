require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db/database');
const { initBot } = require('./bot');
const { startScheduler } = require('./scheduler');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error('XATOLIK: .env faylida BOT_TOKEN to\'g\'ri kiritilmagan!');
  console.error('@BotFather dan token oling va .env fayliga qo\'ying.');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

const sessions = new Map();

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND password = ?').get(username, password);

  if (admin) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { username: admin.username, role: admin.role });
    res.json({ success: true, token, username: admin.username, role: admin.role });
  } else {
    res.status(401).json({ success: false, error: 'Login yoki parol noto\'g\'ri' });
  }
});

app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const session = sessions.get(token);

  if (!session) {
    return res.status(401).json({ error: 'Avtorizatsiyadan o\'tilmagan' });
  }

  req.adminUsername = session.username;
  req.adminRole = session.role;
  next();
});

app.use('/api/admins', (req, res, next) => {
  if (req.method !== 'GET' && req.adminRole !== 'super_admin') {
    return res.status(403).json({ error: 'Faqat super-admin adminlarni boshqarishi mumkin' });
  }
  next();
});

app.use('/api/broadcast', (req, res, next) => {
  if (req.body) req.body.adminUsername = req.adminUsername;
  next();
});

app.use('/api', apiRoutes);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.listen(PORT, () => {
  console.log(`Admin panel ishlamoqda: http://localhost:${PORT}`);
  initBot(BOT_TOKEN);
  startScheduler();
});
