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
      origin: process.env.FRONTEND_URL,
      credentials: true
    },
    transports: ["websocket"]
  });

  io.on("connection", socket => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token;

    if (!token) {
      logger.warn("Socket connection without token");
      socket.disconnect();
      return;
    }

    try {
      const tokenData = verify(token as string, authConfig.secret);
      logger.debug(JSON.stringify(tokenData), "io-onConnection: tokenData");
    } catch (error) {
      logger.error("Invalid socket token");
      socket.disconnect();
      return;
    }

    logger.info("Client Connected");

    socket.on("joinChatBox", (ticketId: string) => {
      socket.join(ticketId);
    });

    socket.on("joinNotification", () => {
      socket.join("notification");
    });

    socket.on("joinTickets", (status: string) => {
      socket.join(status);
    });

    socket.on("disconnect", () => {
      logger.info("Client disconnected");
    });
  });

  return io;
};

export const getIO = (): SocketIO => {
  if (!io) {
    throw new AppError("Socket IO not initialized");
  }
  return io;
};
