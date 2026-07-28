const { fork } = require('node:child_process')
const os = require('node:os')
const { log, logWarn, logError } = require('./src/utils/logger')

const basePort = Number(process.env.PORT) || 2775

/**
 * Numero de processos. Node e single-threaded, entao um processo satura em um
 * core sob carga. Cada worker escuta na sua PROPRIA porta (basePort + n):
 *
 *   WORKERS=1  -> 2775                       (comportamento antigo, padrao)
 *   WORKERS=4  -> 2775, 2776, 2777, 2778
 *   WORKERS=0  -> um por core disponivel
 *
 * child_process.fork em vez de cluster, e portas separadas em vez de porta
 * compartilhada, por dois motivos:
 *  - a lib smpp herda de tls.Server mesmo em conexao plana (smpp.js:167), o
 *    que quebra o handoff de socket que o modulo cluster aplica a QUALQUER
 *    listen() feito dentro de um worker;
 *  - SO_REUSEPORT com balanceamento nao existe no macOS (ENOTSUP).
 *
 * Uma conexao SMPP fica presa ao processo que a aceitou de qualquer forma.
 * Para saturar mais de um core, conecte cada cliente/broker a uma porta
 * diferente - um cliente unico numa unica conexao nao ganha nada com isso.
 */
const requested = process.env.WORKERS === '0'
  ? (os.availableParallelism?.() || os.cpus().length)
  : Number(process.env.WORKERS) || 1

const SIGNALS = { SIGINT: 2, SIGTERM: 15 }
const RESTART_DELAY_MS = 1000

if (process.env.SMPP_SIM_ROLE === 'worker') {
  const server = require('./src/server')
  const port = Number(process.env.WORKER_PORT) || basePort

  server.listen(port, () => log(`SMPP Server listening on ${port} (pid ${process.pid})`))
  server.on('error', (err) => logError(err))

  Object.keys(SIGNALS).forEach(signal =>
    process.on(signal, () => {
      logWarn(`Gracefully shutting down the process: #${process.pid}. Exited by signal ${signal}`)
      server.close()
      process.exit(0)
    })
  )
} else if (requested === 1) {
  // Um worker so: roda inline, sem processo extra (comportamento original).
  const server = require('./src/server')

  server.listen(basePort, () => log(`SMPP Server listening on ${basePort} (pid ${process.pid})`))
  server.on('error', (err) => logError(err))

  Object.keys(SIGNALS).forEach(signal =>
    process.on(signal, () => {
      logWarn(`Gracefully shutting down the process: #${process.pid}. Exited by signal ${signal}`)
      server.close()
      process.exit(0)
    })
  )
} else {
  log(`SMPP Server starting ${requested} workers on ports ${basePort}-${basePort + requested - 1}`)

  let shuttingDown = false
  const children = new Map()

  const spawn = (port) => {
    const child = fork(__filename, [], {
      env: { ...process.env, SMPP_SIM_ROLE: 'worker', WORKER_PORT: port },
    })
    children.set(port, child)

    child.on('exit', (code, signal) => {
      children.delete(port)
      if (shuttingDown) return
      logWarn(`Worker on port ${port} died (${signal || code}). Restarting in ${RESTART_DELAY_MS}ms.`)
      // Delay evita tempestade de respawn se o worker morrer no boot.
      setTimeout(() => { if (!shuttingDown) spawn(port) }, RESTART_DELAY_MS)
    })
  }

  for (let i = 0; i < requested; i++) spawn(basePort + i)

  Object.keys(SIGNALS).forEach(signal =>
    process.on(signal, () => {
      shuttingDown = true
      logWarn(`Shutting down ${children.size} workers. Exited by signal ${signal}`)
      for (const child of children.values()) child.kill(signal)
      process.exit(0)
    })
  )
}
