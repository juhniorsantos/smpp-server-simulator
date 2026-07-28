/**
 * Logging por nivel. Em teste de carga o log de cada PDU domina o tempo de
 * CPU: sao um JSON.stringify do pdu inteiro e uma escrita sincrona por
 * mensagem. Use LOG_LEVEL=silent (ou error) para medir throughput real.
 *
 *   LOG_LEVEL=debug   tudo, inclusive cada PDU (padrao)
 *   LOG_LEVEL=error   so erros
 *   LOG_LEVEL=silent  nada
 */
const LEVELS = { silent: 0, error: 1, warn: 2, debug: 3 }
const level = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.debug

const write = (fn, log) => fn(`[${new Date()}] - ${JSON.stringify(log)}`)

exports.log = (log) => { if (level >= LEVELS.debug) write(console.log, log) }
exports.logError = (log) => { if (level >= LEVELS.error) write(console.error, log) }
exports.logWarn = (log) => { if (level >= LEVELS.warn) write(console.warn, log) }
