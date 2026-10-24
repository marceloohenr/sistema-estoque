import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg

export const database = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 5000,
})

database.on('error', (error) => {
  console.error('Erro inesperado na conexão com o banco de dados:', error)
})
