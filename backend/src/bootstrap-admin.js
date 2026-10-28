import { readFileSync } from 'node:fs'
import { config } from './config.js'
import { database } from './database.js'
import { migrate } from './schema.js'
import { hashPassword } from './security.js'

try {
  if (process.env.SEED_USERS === 'true') {
    throw new Error('Desative SEED_USERS antes de executar o bootstrap de produção.')
  }
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim()
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase()
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  const password =
    process.env.BOOTSTRAP_ADMIN_PASSWORD ??
    (process.env.BOOTSTRAP_ADMIN_PASSWORD_FILE
      ? readFileSync(process.env.BOOTSTRAP_ADMIN_PASSWORD_FILE, 'utf8').trim()
      : undefined)
  if (
    !name ||
    !username ||
    !/^[a-z0-9._-]{3,50}$/.test(username) ||
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !password ||
    password.length < 12 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new Error(
      'Defina BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD (mínimo 12 caracteres).',
    )
  }

  await migrate(database)
  const result = await database.query(
    `INSERT INTO users (name,username,email,password_hash,role,must_change_password)
     VALUES ($1,$2,$3,$4,'admin',FALSE) ON CONFLICT DO NOTHING RETURNING id`,
    [name, username, email, await hashPassword(password)],
  )
  if (!result.rowCount)
    throw new Error('O usuário ou e-mail informado já existe; nenhum administrador foi criado.')
  console.log(`Administrador @${username} criado com sucesso.`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await database.end()
}
