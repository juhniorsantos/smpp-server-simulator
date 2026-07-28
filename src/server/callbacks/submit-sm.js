const { log } = require('../../utils/logger')

const pad = (n) => String(n).padStart(2, '0')

/** Data no formato YYMMDDhhmm exigido pelo corpo do delivery receipt. */
const receiptDate = (date) =>
  String(date.getFullYear()).slice(2) +
  pad(date.getMonth() + 1) +
  pad(date.getDate()) +
  pad(date.getHours()) +
  pad(date.getMinutes())

// Fracao de submit_sm rejeitados com ESME_RSYSERR (ex.: SUBMIT_ERROR_RATE=0.1).
// Rejeitado nao gera DLR, como num SMSC real. Padrao 0 mantem o comportamento.
const submitErrorRate = Number(process.env.SUBMIT_ERROR_RATE) || 0

// DLR_BARE=1: entrega o DLR so com os campos do PDU, sem corpo no
// short_message (como alguns SMSCs fazem). Util para testar a robustez do
// cliente contra receipt fora do formato da spec 5.2.18.
const dlrBare = process.env.DLR_BARE === '1'

module.exports = (session, pdu) => {
  log(pdu)

  if (Math.random() < submitErrorRate) {
    session.send(pdu.response({ command_status: 8 }))
    return
  }

  const messageId = Math.floor(new Date()).toString().substring(4)
  session.send(pdu.response({ message_id: messageId }))

  setTimeout(() => {
    const failed = Math.random() <= 0.1
    const now = receiptDate(new Date())

    // Um SMSC real entrega o receipt como texto no short_message, no formato
    // da seção 5.2.18 da spec SMPP 3.4. Sem isso o cliente nao consegue
    // correlacionar o DLR com a mensagem enviada.
    const receipt =
      `id:${messageId} sub:001 dlvrd:${failed ? '000' : '001'} ` +
      `submit date:${now} done date:${now} ` +
      `stat:${failed ? 'UNDELIV' : 'DELIVRD'} err:${failed ? '011' : '000'} text:`

    const dlr = {
      esm_class: 4,
      receipted_message_id: messageId,
      message_state: failed ? 5 : 2,
      source_addr: pdu.destination_addr,
      destination_addr: pdu.source_addr
    }

    if (!dlrBare) {
      dlr.short_message = { message: receipt }
    }

    session.deliver_sm(dlr)
  }, 2000)
}
