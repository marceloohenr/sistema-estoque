import { readFileSync } from 'node:fs'

function environmentSecret(variable, fileVariable) {
  const directValue = process.env[variable]
  if (directValue) return directValue
  const filePath = process.env[fileVariable]
  return filePath ? readFileSync(filePath, 'utf8').trim() : undefined
}

const port = Number(process.env.PORT ?? 3000)
const sessionSecret = environmentSecret('SESSION_SECRET', 'SESSION_SECRET_FILE')
const nodeEnv = process.env.NODE_ENV ?? 'development'
const appOriginValue = process.env.APP_ORIGIN ?? 'http://localhost:5173'
const databaseUrl = environmentSecret('DATABASE_URL', 'DATABASE_URL_FILE')

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('A variável PORT deve conter uma porta válida entre 1 e 65535.')
}

if (!databaseUrl) {
  throw new Error('A variável DATABASE_URL é obrigatória para iniciar o backend.')
}

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET deve conter pelo menos 32 caracteres.')
}

let appOrigin
try {
  const parsedOrigin = new URL(appOriginValue)
  if (
    parsedOrigin.origin !== appOriginValue.replace(/\/$/, '') ||
    (nodeEnv === 'production' && parsedOrigin.protocol !== 'https:')
  ) {
    throw new Error()
  }
  appOrigin = parsedOrigin.origin
} catch {
  throw new Error('APP_ORIGIN deve ser uma origem válida (sem caminho); em produção, use HTTPS.')
}

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port,
  databaseUrl,
  sessionSecret,
  appOrigin,
  nodeEnv,
  trustProxy: process.env.TRUST_PROXY === 'true',
}
