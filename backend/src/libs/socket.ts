io = new SocketIO(httpServer, {
  cors: {
    origin: "http://tcckg88kco4c08c4kwk4ksss.76.13.70.6.sslip.io",  // ← DOMÍNIO DO FRONTEND
    credentials: true
  },
  transports: ["websocket", "polling"],  // ← AMBOS
  allowEIO3: true
});
