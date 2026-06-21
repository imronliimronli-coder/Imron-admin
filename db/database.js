const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'bot.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#4fd1c5',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    is_blocked INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_groups (
    user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, group_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT,
    file_path TEXT,
    file_type TEXT,
    buttons TEXT,
    target TEXT DEFAULT 'all',
    target_group_id INTEGER,
    status TEXT DEFAULT 'sent',
    scheduled_at DATETIME,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS button_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    button_text TEXT,
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
  )
`);

const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins').get().count;
if (adminCount === 0) {
  db.prepare(`
    INSERT INTO admins (username, password, role)
    VALUES (?, ?, ?)
  `).run('admin', process.env.ADMIN_PASSWORD || 'admin123', 'super_admin');
}

module.exports = db;
