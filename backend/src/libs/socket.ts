import { Server as SocketIO } from "socket.io";
import { Server } from "http";
import { verify } from "jsonwebtoken";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";
import authConfig from "../config/auth";

let io: SocketIO;

export const initIO = (httpServer: Server): SocketIO => {
  io = new SocketIO(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://tcckg88kco4c08c4kwk4ksss.76.13.70.6.sslip.io",
      credentials: true,
      methods: ["GET", "POST"]
    },
    // ADICIONE ESTAS CONFIGURAÇÕES:
    transports: ["websocket", "polling"],  // ← IMPORTANTE
    allowEIO3: true,  // Para compatibilidade
    pingTimeout: 60000,
    pingInterval: 25000,
    cookie: false
  });

  io.on("connection", socket => {
    const { token } = socket.handshake.query;
    
    // Permite conexão sem token inicial (para login)
    if (!token || token === "null") {
      logger.info("Client connected without token (pre-login)");
      socket.emit("connection", "connected without auth");
      return socket;
    }
    
    let tokenData = null;
    try {
      tokenData = verify(token.toString(), authConfig.secret);
      logger.debug(JSON.stringify(tokenData), "io-onConnection: tokenData");
    } catch (error) {
      logger.error(JSON.stringify(error), "Error decoding token");
      socket.disconnect();
      return io;
    }

    logger.info("Client Connected");
    socket.on("joinChatBox", (ticketId: string) => {
      logger.info("A client joined a ticket channel");
      socket.join(ticketId);
    });

    socket.on("joinNotification", () => {
      logger.info("A client joined notification channel");
      socket.join("notification");
    });

    socket.on("joinTickets", (status: string) => {
      logger.info(`A client joined to ${status} tickets channel.`);
      socket.join(status);
    });

    socket.on("disconnect", () => {
      logger.info("Client disconnected");
    });

    return socket;
  });
  return io;
};

export const getIO = (): SocketIO => {
  if (!io) {
    throw new AppError("Socket IO not initialized");
  }
  return io;
};
