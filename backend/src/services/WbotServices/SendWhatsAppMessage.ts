import { getWbot } from "../../libs/wbot";
import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

interface SendMessageParams {
  body: string;
  ticket: Ticket;
  quotedMsg?: any; // mantém compatível com ApiController/MessageController
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const normalizeChatId = (number?: string | null): string => {
  if (!number) return "";
  const digits = String(number).replace(/\D/g, "");
  if (!digits) return "";
  return `${digits}@c.us`;
};

const getQuotedMessageId = (quotedMsg?: any): string | undefined => {
  const id = quotedMsg?.id?._serialized || quotedMsg?.id;
  if (!id) return undefined;
  return String(id);
};

const isMarkedUnreadBug = (err: any): boolean => {
  const msg = String(err?.message || err || "");
  return msg.includes("markedUnread") || msg.includes("Cannot read properties of undefined (reading 'markedUnread')");
};

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: SendMessageParams): Promise<void> => {
  const chatId = normalizeChatId(ticket?.contact?.number);

  if (!chatId) {
    logger.warn(`ERR_SENDING_WAPP_MSG | chatId inválido | ticketId=${ticket?.id}`);
    throw new AppError("ERR_SENDING_WAPP_MSG", 400);
  }

  if (!body || !body.trim()) {
    logger.warn(`ERR_SENDING_WAPP_MSG | mensagem vazia | chatId=${chatId} | ticketId=${ticket?.id}`);
    throw new AppError("ERR_SENDING_WAPP_MSG", 400);
  }

  const quotedMessageId = getQuotedMessageId(quotedMsg);

  try {
    const wbot = getWbot(ticket.whatsappId);

    // Retry leve (reconexões do WhatsApp Web são comuns)
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // (Opcional) “aquecimento” do chat antes de enviar — ajuda a evitar objetos undefined em alguns casos
        let chat: any = null;
        try {
          chat = await wbot.getChatById(chatId);
        } catch {
          // Se não conseguir obter chat, segue com wbot.sendMessage normalmente
        }

        const options: any = {};
        if (quotedMessageId) options.quotedMessageId = quotedMessageId;

        if (chat?.sendMessage) {
          await chat.sendMessage(body, options);
        } else {
          await wbot.sendMessage(chatId, body, options);
        }

        return;
      } catch (err: any) {
        const msg = err?.message ?? err;

        logger.warn(
          `SendWhatsAppMessage falhou ${attempt}/${maxRetries} | chatId=${chatId} | ticketId=${ticket?.id} | err=${msg}`
        );

        // Erro específico do WhatsApp Web / whatsapp-web.js (markedUnread)
        // Normalmente é intermitente; vale tentar novamente após pequeno delay.
        if (isMarkedUnreadBug(err)) {
          // aumenta um pouco o delay nas tentativas desse bug
          await delay(1200);
        } else {
          await delay(800);
        }

        if (attempt >= maxRetries) throw err;
      }
    }
  } catch (err: any) {
    // NÃO perca o erro real no log (isso ajuda muito no debug)
    logger.warn({
      message: "ERR_SENDING_WAPP_MSG",
      statusCode: 400,
      ticketId: ticket?.id,
      chatId,
      error: err?.message ?? err
    });

    throw new AppError("ERR_SENDING_WAPP_MSG", 400);
  }
};

export default SendWhatsAppMessage;
