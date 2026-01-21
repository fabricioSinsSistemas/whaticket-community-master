import { getWbot } from "../../libs/wbot";
import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

interface SendMessageParams {
  body: string;
  ticket: Ticket;
  quotedMsgId?: string;
}

/**
 * Normaliza o número para o formato aceito pelo WhatsApp
 */
const normalizeChatId = (number?: string | null): string => {
  if (!number) return "";

  let chatId = String(number).replace(/\D/g, "");

  // WhatsApp individual
  if (!chatId.endsWith("@c.us") && !chatId.endsWith("@g.us")) {
    chatId = `${chatId}@c.us`;
  }

  return chatId;
};

const delay = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsgId
}: SendMessageParams): Promise<void> => {
  try {
    const wbot = getWbot(ticket.whatsappId);

    if (!wbot) {
      throw new AppError("ERR_WAPP_NOT_INITIALIZED");
    }

    const rawNumber =
      ticket.contact?.number ||
      ticket.contact?.whatsappId ||
      ticket.contactId;

    const chatId = normalizeChatId(rawNumber);

    if (!chatId) {
      logger.warn(
        `ERR_SENDING_WAPP_MSG | chatId inválido | ticketId=${ticket.id}`
      );
      throw new AppError("ERR_SENDING_WAPP_MSG", 400);
    }

    if (!body || !body.trim()) {
      logger.warn(
        `ERR_SENDING_WAPP_MSG | mensagem vazia | chatId=${chatId} | ticketId=${ticket.id}`
      );
      throw new AppError("ERR_SENDING_WAPP_MSG", 400);
    }

    // Retry simples para casos de reconexão do WhatsApp Web
    const maxRetries = 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await wbot.sendMessage(chatId, body, quotedMsgId ? {
          quotedMessageId: quotedMsgId
        } : undefined);

        return; // sucesso
      } catch (err: any) {
        const msg = err?.message ?? err;

        logger.warn(
          `SendWhatsAppMessage tentativa ${attempt}/${maxRetries} falhou | chatId=${chatId} | ticketId=${ticket.id} | err=${msg}`
        );

        if (attempt >= maxRetries) {
          throw err;
        }

        // pequeno delay antes de tentar novamente
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
