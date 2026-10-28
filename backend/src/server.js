import { app } from './app.js'
import { config } from './config.js'
import { database } from './database.js'
import { migrate } from './schema.js'

const server = await (async () => {
  try {
    await migrate(database)
    return app.listen(config.port, config.host, () => {
      console.log(`Backend disponível na porta ${config.port}.`)
    })
  } catch (error) {
    console.error('Não foi possível preparar o banco de dados:', error)
    await database.end()
    process.exit(1)
  }
})()

server.on('error', (error) => {
  console.error('Não foi possível iniciar o servidor HTTP:', error)
  process.exitCode = 1
})

function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando o backend...`)
  server.close(async () => {
    await database.end()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
