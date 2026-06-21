const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db/database');
const { sendToUser } = require('../bot');
const { executeBroadcast } = require('../scheduler');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function detectFileType(mimetype) {
  if (mimetype.startsWith('image/')) return 'photo';
  if (mimetype.startsWith('video/')) return 'video';
  return 'document';
}

router.get('/stats', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const activeUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_blocked = 0').get().count;
  const blockedUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_blocked = 1').get().count;
  const totalBroadcasts = db.prepare(`SELECT COUNT(*) as count FROM broadcasts WHERE status = 'sent'`).get().count;
  const scheduledCount = db.prepare(`SELECT COUNT(*) as count FROM broadcasts WHERE status = 'scheduled'`).get().count;
  const todayUsers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE date(joined_at) = date('now')`).get().count;

  res.json({ totalUsers, activeUsers, blockedUsers, totalBroadcasts, scheduledCount, todayUsers });
});

router.get('/stats/daily-growth', (req, res) => {
  const rows = db.prepare(`
    SELECT date(joined_at) as day, COUNT(*) as count
    FROM users
    WHERE joined_at >= date('now', '-13 days')
    GROUP BY day
    ORDER BY day ASC
  `).all();

  const result = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = rows.find(r => r.day === key);
    result.push({ day: key, count: found ? found.count : 0 });
  }
  res.json(result);
});

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY joined_at DESC').all();
  const groupLinks = db.prepare('SELECT * FROM user_groups').all();

  const usersWithGroups = users.map(u => ({
    ...u,
    groupIds: groupLinks.filter(gl => gl.user_id === u.id).map(gl => gl.group_id)
  }));

  res.json(usersWithGroups);
});

router.post('/users/:id/toggle-block', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  const newStatus = user.is_blocked ? 0 : 1;
  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(newStatus, req.params.id);
  res.json({ success: true, is_blocked: newStatus });
});

router.delete('/users/:id', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/users/:id/groups', (req, res) => {
  const { groupIds } = req.body;
  const userId = req.params.id;

  db.prepare('DELETE FROM user_groups WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)');
  for (const gid of (groupIds || [])) {
    insert.run(userId, gid);
  }

  res.json({ success: true });
});

router.get('/groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups ORDER BY name ASC').all();
  const counts = db.prepare(`
    SELECT group_id, COUNT(*) as count FROM user_groups GROUP BY group_id
  `).all();

  const groupsWithCounts = groups.map(g => ({
    ...g,
    memberCount: (counts.find(c => c.group_id === g.id) || {}).count || 0
  }));

  res.json(groupsWithCounts);
});

router.post('/groups', (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Guruh nomi kiritilishi kerak' });

  try {
    const result = db.prepare('INSERT INTO groups (name, color) VALUES (?, ?)').run(name.trim(), color || '#4fd1c5');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'Bu nomli guruh allaqachon mavjud' });
  }
});

router.delete('/groups/:id', (req, res) => {
  db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/admins', (req, res) => {
  const admins = db.prepare('SELECT id, username, role, created_at FROM admins ORDER BY created_at ASC').all();
  res.json(admins);
});

router.post('/admins', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Login va parol kerak' });

  try {
    const result = db.prepare(`
      INSERT INTO admins (username, password, role) VALUES (?, ?, ?)
    `).run(username.trim(), password, role === 'super_admin' ? 'super_admin' : 'admin');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'Bu login allaqachon band' });
  }
});

router.delete('/admins/:id', (req, res) => {
  const totalAdmins = db.prepare('SELECT COUNT(*) as count FROM admins').get().count;
  if (totalAdmins <= 1) {
    return res.status(400).json({ error: 'Oxirgi adminni o\'chirib bo\'lmaydi' });
  }
  db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fayl tanlanmagan' });

  res.json({
    success: true,
    filePath: req.file.path,
    fileType: detectFileType(req.file.mimetype),
    originalName: req.file.originalname
  });
});

router.get('/broadcasts', (req, res) => {
  const broadcasts = db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC').all();

  const withClickCounts = broadcasts.map(b => {
    const clicks = db.prepare('SELECT COUNT(*) as count FROM button_clicks WHERE broadcast_id = ?').get(b.id).count;
    return { ...b, clickCount: clicks };
  });

  res.json(withClickCounts);
});

router.delete('/broadcasts/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Topilmadi' });
  if (item.status !== 'scheduled') {
    return res.status(400).json({ error: 'Faqat rejalashtirilgan xabarlarni bekor qilish mumkin' });
  }
  db.prepare('DELETE FROM broadcasts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/broadcast', async (req, res) => {
  const { message, userIds, groupId, buttons, filePath, fileType, scheduledAt, adminUsername } = req.body;

  if (!message && !filePath) {
    return res.status(400).json({ error: 'Xabar matni yoki fayl bo\'lishi kerak' });
  }

  const buttonsJson = buttons && buttons.length > 0 ? JSON.stringify(buttons) : null;

  let target = 'all';
  if (groupId) target = 'group';
  else if (userIds && userIds.length > 0) target = 'selected';

  if (scheduledAt) {
    const result = db.prepare(`
      INSERT INTO broadcasts (message, file_path, file_type, buttons, target, target_group_id, status, scheduled_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
    `).run(message || null, filePath || null, fileType || null, buttonsJson, target, groupId || null, scheduledAt, adminUsername || 'admin');

    return res.json({ success: true, scheduled: true, id: result.lastInsertRowid });
  }

  let targets;
  if (groupId) {
    targets = db.prepare(`
      SELECT u.* FROM users u
      JOIN user_groups ug ON ug.user_id = u.id
      WHERE ug.group_id = ? AND u.is_blocked = 0
    `).all(groupId);
  } else if (userIds && userIds.length > 0) {
    targets = db.prepare(`
      SELECT * FROM users WHERE id IN (${userIds.map(() => '?').join(',')}) AND is_blocked = 0
    `).all(...userIds);
  } else {
    targets = db.prepare('SELECT * FROM users WHERE is_blocked = 0').all();
  }

  const insertResult = db.prepare(`
    INSERT INTO broadcasts (message, file_path, file_type, buttons, target, target_group_id, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'sending', ?)
  `).run(message || null, filePath || null, fileType || null, buttonsJson, target, groupId || null, adminUsername || 'admin');

  const broadcastId = insertResult.lastInsertRowid;

  let sentCount = 0;
  let failedCount = 0;

  for (const user of targets) {
    const result = await sendToUser(user.telegram_id, {
      message,
      filePath,
      fileType,
      buttons,
      broadcastId
    });
    if (result.success) sentCount++;
    else failedCount++;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  db.prepare(`
    UPDATE broadcasts SET status = 'sent', sent_count = ?, failed_count = ? WHERE id = ?
  `).run(sentCount, failedCount, broadcastId);

  res.json({ success: true, sentCount, failedCount, total: targets.length });
});

module.exports = router;
