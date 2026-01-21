import qrCode from "qrcode-terminal";
import { Client, LocalAuth } from "whatsapp-web.js";
import { getIO } from "./socket";
import Whatsapp from "../models/Whatsapp";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";
import { handleMessage } from "../services/WbotServices/wbotMessageListener";

interface Session extends Client {
  id?: number;
}

const sessions: Session[] = [];

const syncUnreadMessages = async (wbot: Session) => {
  try {
    console.log('[WPP] Sincronizando mensagens não lidas...');
    
    const chats = await wbot.getChats();
    console.log(`[WPP] Total de chats: ${chats.length}`);

    let processed = 0;
    let errors = 0;

    for (const chat of chats) {
      try {
        // Verificar se chat é válido
        if (!chat || !chat.id) {
          console.warn('[WPP] Chat inválido encontrado, pulando...');
          continue;
        }

        // Verificar unreadCount de forma segura
        const unreadCount = chat.unreadCount || 0;
        
        if (unreadCount > 0) {
          console.log(`[WPP] Chat ${chat.id.user} tem ${unreadCount} mensagens não lidas`);
          
          try {
            const unreadMessages = await chat.fetchMessages({
              limit: Math.min(unreadCount, 50) // Limitar para não sobrecarregar
            });

            for (const msg of unreadMessages) {
              try {
                await handleMessage(msg, wbot);
              } catch (msgError) {
                console.warn(`[WPP] Erro ao processar mensagem no chat ${chat.id.user}:`, msgError.message);
              }
            }

            // Tentar marcar como visto (com timeout)
            try {
              await chat.sendSeen();
              console.log(`[WPP] Chat ${chat.id.user} marcado como visto`);
            } catch (sendSeenError) {
              console.warn(`[WPP] Não foi possível marcar chat ${chat.id.user} como visto:`, sendSeenError.message);
              // Não falha - continua com outros chats
            }

            processed++;
          } catch (fetchError) {
            console.warn(`[WPP] Erro ao buscar mensagens do chat ${chat.id.user}:`, fetchError.message);
            errors++;
          }
        }
      } catch (chatError) {
        console.warn(`[WPP] Erro ao processar chat:`, chatError.message);
        errors++;
        continue;
      }
    }

    console.log(`[WPP] Sincronização completa: ${processed} chats processados, ${errors} erros`);
    
  } catch (error) {
    console.error('[WPP] ERRO CRÍTICO em syncUnreadMessages:', error.message);
    // NÃO propaga o erro - não queremos quebrar o WhatsApp por causa disso
  }
};

export const initWbot = async (whatsapp: Whatsapp): Promise<Session> => {
  return new Promise((resolve, reject) => {
    try {
      const io = getIO();
      const sessionName = whatsapp.name;
      let sessionCfg;

      if (whatsapp && whatsapp.session) {
        sessionCfg = JSON.parse(whatsapp.session);
      }

      const args: String = process.env.CHROME_ARGS || "";

      const wbot: Session = new Client({
        session: sessionCfg,
        authStrategy: new LocalAuth({ clientId: "bd_" + whatsapp.id }),
        puppeteer: {
          // Caminho do Chromium para Nixpacks
          executablePath: process.env.CHROME_BIN || 
                         process.env.CHROMIUM_PATH || 
                         "/nix/var/nix/profiles/default/bin/chromium" || 
                         undefined,
          // @ts-ignore
          browserWSEndpoint: process.env.CHROME_WS || undefined,
          // Argumentos corrigidos para Nixpacks
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--single-process',
            ...(args ? args.split(" ") : []) // Mantém args existentes se houver
          ]
        }
      });

      wbot.initialize();

      wbot.on("qr", async qr => {
        logger.info("Session:", sessionName);
        qrCode.generate(qr, { small: true });
        await whatsapp.update({ qrcode: qr, status: "qrcode", retries: 0 });

        const sessionIndex = sessions.findIndex(s => s.id === whatsapp.id);
        if (sessionIndex === -1) {
          wbot.id = whatsapp.id;
          sessions.push(wbot);
        }

        io.emit("whatsappSession", {
          action: "update",
          session: whatsapp
        });
      });

      wbot.on("authenticated", async session => {
        logger.info(`Session: ${sessionName} AUTHENTICATED`);
      });

      wbot.on("auth_failure", async msg => {
        console.error(
          `Session: ${sessionName} AUTHENTICATION FAILURE! Reason: ${msg}`
        );

        if (whatsapp.retries > 1) {
          await whatsapp.update({ session: "", retries: 0 });
        }

        const retry = whatsapp.retries;
        await whatsapp.update({
          status: "DISCONNECTED",
          retries: retry + 1
        });

        io.emit("whatsappSession", {
          action: "update",
          session: whatsapp
        });

        reject(new Error("Error starting whatsapp session."));
      });

      wbot.on("ready", async () => {
        logger.info(`Session: ${sessionName} READY`);

        await whatsapp.update({
          status: "CONNECTED",
          qrcode: "",
          retries: 0
        });

        io.emit("whatsappSession", {
          action: "update",
          session: whatsapp
        });

        const sessionIndex = sessions.findIndex(s => s.id === whatsapp.id);
        if (sessionIndex === -1) {
          wbot.id = whatsapp.id;
          sessions.push(wbot);
        }

        wbot.sendPresenceAvailable();
        
        // Sincronização em segundo plano para não travar
        setTimeout(() => {
          syncUnreadMessages(wbot).catch(err => {
            console.warn('[WPP] Erro não crítico na sincronização:', err.message);
          });
        }, 3000); // Espera 3 segundos após o ready

        resolve(wbot);
      });
    } catch (err) {
      logger.error(err);
    }
  });
};

export const getWbot = (whatsappId: number): Session => {
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);

  if (sessionIndex === -1) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  return sessions[sessionIndex];
};

export const removeWbot = (whatsappId: number): void => {
  try {
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
    if (sessionIndex !== -1) {
      sessions[sessionIndex].destroy();
      sessions.splice(sessionIndex, 1);
    }
  } catch (err) {
    logger.error(err);
  }
};
