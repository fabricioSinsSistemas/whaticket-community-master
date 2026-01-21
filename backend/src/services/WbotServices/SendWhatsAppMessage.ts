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

  // deixa só dígitos (ex: +55 (11) 99999-9999 => 5511999999999)
  const digits = String(number).replace(/\D/g, "");
  if (!digits) return "";

  return `${digits}@c.us`;
};

const getQuotedMessageId = (quotedMsg?: any): string | undefined => {
  // whatsapp-web.js geralmente usa quotedMsg.id._serialized
  const id = quotedMsg?.id?._serialized || quotedMsg?.id;
  if (!id) return undefined;
  return String(id);
};

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: SendMessageParams): Promise<void> => {
  try {
    const wbot = getWbot(ticket.whatsappId);

    const chatId = normalizeChatId(ticket?.contact?.number);

    if (!chatId) {
      logger.warn(
        `ERR_SENDING_WAPP_MSG | chatId inválido | ticketId=${ticket?.id}`
      );
      throw new AppError("ERR_SENDING_WAPP_MSG", 400);
    }

    if (!body || !body.trim()) {
      logger.warn(
        `ERR_SENDING_WAPP_MSG | mensagem vazia | chatId=${chatId} | ticketId=${ticket?.id}`
      );
      throw new AppError("ERR_SENDING_WAPP_MSG", 400);
    }

    const quotedMessageId = getQuotedMessageId(quotedMsg);

    // Retry leve (reconexões do WhatsApp Web são comuns)
    const maxRetries = 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (quotedMessageId) {
          await wbot.sendMessage(chatId, body, { quotedMessageId });
        } else {
          await wbot.sendMessage(chatId, body);
        }
        return;
      } catch (err: any) {
        const msg = err?.message ?? err;

        logger.warn(
          `SendWhatsAppMessage falhou ${attempt}/${maxRetries} | chatId=${chatId} | ticketId=${ticket?.id} | err=${msg}`
        );

        if (attempt >= maxRetries) throw err;

        await delay(800);
      }
    }
  } catch (err: any) {
    logger.warn({
      message: "ERR_SENDING_WAPP_MSG",
      statusCode: 400,
      error: err?.message ?? err
    });

    throw new AppError("ERR_SENDING_WAPP_MSG", 400);
  }
};

export default SendWhatsAppMessage;
