import { pool } from './server/db.mjs';

async function elevate() {
  // First, insert them if they don't exist yet (with a dummy password hash, they will override it or it doesn't matter since they login via SDU)
  const username = '240103199';
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  if (rows.length === 0) {
    await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
      [username, 'dummy', 'Administrator']
    );
    console.log('User created and elevated to Administrator');
  } else {
    await pool.query('UPDATE users SET role = $1 WHERE username = $2', ['Administrator', username]);
    console.log('User elevated to Administrator');
  }
  process.exit(0);
}

elevate().catch(console.error);
