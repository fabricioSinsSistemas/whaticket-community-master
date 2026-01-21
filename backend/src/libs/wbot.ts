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
  let chats: any[] = [];

  try {
    chats = await wbot.getChats();
  } catch (err: any) {
    logger.warn(
      `Could not fetch chats to sync unread messages. Err: ${err?.message ?? err}`
    );
    return;
  }

  /* eslint-disable no-restricted-syntax */
  /* eslint-disable no-await-in-loop */

  for (const chat of chats) {
    try {
      if (!chat) continue;

      const unreadCount = Number(chat.unreadCount ?? 0);
      if (!unreadCount || unreadCount <= 0) continue;

      let unreadMessages: any[] = [];
      try {
        unreadMessages = await chat.fetchMessages({ limit: unreadCount });
      } catch (errFetch: any) {
        logger.warn(
          `Could not fetch unread messages for chat. Err: ${errFetch?.message ?? errFetch}`
        );
        continue;
      }

      for (const msg of unreadMessages) {
        try {
          await handleMessage(msg, wbot);
        } catch (errHandle: any) {
          logger.warn(
            `Error handling unread message (ignored). Err: ${errHandle?.message ?? errHandle}`
          );
        }
      }

      // só chama se existir e estiver conectado o suficiente
      if (typeof chat.sendSeen === "function") {
        try {
          await chat.sendSeen();
        } catch (errSeen: any) {
          logger.warn(
            `Could not mark messages as read. Maybe whatsapp session disconnected? Err: ${errSeen?.message ?? errSeen}`
          );
        }
      } else {
        // evita o erro "reading 'sendSeen'"
        logger.warn("chat.sendSeen is not available (ignored).");
      }
    } catch (errLoop: any) {
      logger.warn(
        `syncUnreadMessages loop error (ignored). Err: ${errLoop?.message ?? errLoop}`
      );
    }
  }
};


export const initWbot = async (whatsapp: Whatsapp): Promise<Session> => {
  return new Promise((resolve, reject) => {
    try {
      const io = getIO();
      const sessionName = whatsapp.name;
      let sessionCfg: any;

      // OBS: em versões atuais do whatsapp-web.js, "session" + LocalAuth não é o caminho ideal.
      // Mantive para não quebrar seu projeto, mas "LocalAuth" já gerencia persistência.
      if (whatsapp && whatsapp.session) {
        try {
          sessionCfg = JSON.parse(whatsapp.session);
        } catch (e) {
          sessionCfg = undefined;
        }
      }

      const args: string = process.env.CHROME_ARGS || "";

      const wbot: Session = new Client({
        // Mantém compatibilidade com seu projeto (mesmo usando LocalAuth).
        // @ts-ignore
        session: sessionCfg,
        authStrategy: new LocalAuth({ clientId: "bd_" + whatsapp.id }),

        puppeteer: {
          // Caminho do Chromium para ambientes Nixpacks/Coolify
          executablePath:
            process.env.CHROME_BIN ||
            process.env.CHROMIUM_PATH ||
            "/nix/var/nix/profiles/default/bin/chromium",

          // @ts-ignore
          browserWSEndpoint: process.env.CHROME_WS || undefined,

          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu",
            "--single-process",
            ...(args ? args.split(" ") : [])
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

      wbot.on("authenticated", async () => {
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

        try {
          // mantém o comportamento atual do seu projeto
          // (não muda a lógica de presença)
          // @ts-ignore
          wbot.sendPresenceAvailable();
        } catch (e) {
          // não é crítico
        }

        await syncUnreadMessages(wbot);

        resolve(wbot);
      });
    } catch (err) {
      logger.error(err);
      reject(err as any);
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
