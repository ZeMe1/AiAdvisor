import { pool } from '../server/db.mjs';

async function elevate() {
  const username = process.argv[2] || process.env.ADMIN_USERNAME;
  if (!username) {
    console.error('Ошибка: укажите логин пользователя для назначения роли Администратора.');
    console.error('Пример: node scripts/elevate-user.mjs 240103199');
    process.exit(1);
  }

  const cleanUsername = String(username).trim();
  const { rows } = await pool.query('SELECT id, username, role FROM users WHERE username = $1', [cleanUsername]);

  if (rows.length === 0) {
    await pool.query(
      'INSERT INTO users (username, role) VALUES ($1, $2)',
      [cleanUsername, 'Administrator']
    );
    console.log(`Пользователь ${cleanUsername} создан и назначен Администратором.`);
  } else {
    await pool.query('UPDATE users SET role = $1 WHERE username = $2', ['Administrator', cleanUsername]);
    console.log(`Пользователь ${cleanUsername} успешно повышен до роли Администратора.`);
  }

  await pool.end();
  process.exit(0);
}

elevate().catch((err) => {
  console.error('Ошибка при повышении роли:', err);
  process.exit(1);
});
