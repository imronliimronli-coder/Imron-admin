const cron = require('node-cron');
const db = require('./db/database');
const { sendToUser } = require('./bot');

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString();

    const dueItems = db.prepare(`
      SELECT * FROM broadcasts
      WHERE status = 'scheduled' AND scheduled_at <= ?
    `).all(now);

    for (const item of dueItems) {
      await executeBroadcast(item);
    }
  });

  console.log('Rejalashtiruvchi (scheduler) ishga tushdi...');
}

async function executeBroadcast(item) {
  db.prepare(`UPDATE broadcasts SET status = 'sending' WHERE id = ?`).run(item.id);

  let targets;
  if (item.target === 'group' && item.target_group_id) {
    targets = db.prepare(`
      SELECT u.* FROM users u
      JOIN user_groups ug ON ug.user_id = u.id
      WHERE ug.group_id = ? AND u.is_blocked = 0
    `).all(item.target_group_id);
  } else {
    targets = db.prepare('SELECT * FROM users WHERE is_blocked = 0').all();
  }

  const buttons = item.buttons ? JSON.parse(item.buttons) : null;
  let sentCount = 0;
  let failedCount = 0;

  for (const user of targets) {
    const result = await sendToUser(user.telegram_id, {
      message: item.message,
      filePath: item.file_path,
      fileType: item.file_type,
      buttons,
      broadcastId: item.id
    });

    if (result.success) sentCount++;
    else failedCount++;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  db.prepare(`
    UPDATE broadcasts
    SET status = 'sent', sent_count = ?, failed_count = ?
    WHERE id = ?
  `).run(sentCount, failedCount, item.id);

  console.log(`Rejalashtirilgan xabar #${item.id} yuborildi: ${sentCount} ta, xato: ${failedCount} ta`);
}

module.exports = { startScheduler,
