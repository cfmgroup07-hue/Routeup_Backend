const mongoose = require('mongoose');
const { isConfigured: isCloudinaryConfigured, checkPdfDeliveryEnabled } = require('./cloudinary');

const statusIcon = (ok) => (ok ? '✓' : '✗');
const statusLabel = (ok) => (ok ? 'CONNECTED' : 'NOT CONNECTED');

const maskValue = (value) => {
  if (!value) return 'missing';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
};

const checkEnv = (key, placeholderValues = []) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) return false;
  return !placeholderValues.some((p) => value === p);
};

const getEmailStatus = () => {
  const hasHost = checkEnv('EMAIL_HOST');
  const hasUser = checkEnv('EMAIL_USER');
  const hasPass = checkEnv('EMAIL_PASS');
  if (hasHost && hasUser && hasPass) {
    return {
      ok: true,
      detail: `${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT || 465} (${process.env.EMAIL_USER})`,
    };
  }
  if (hasHost || hasUser) {
    return { ok: false, detail: 'partial config — will use Ethereal test mail' };
  }
  return { ok: false, detail: 'not configured — will use Ethereal test mail' };
};

const getRazorpayStatus = () => {
  const hasKey = checkEnv('RAZORPAY_KEY_ID', ['rzp_test_placeholder_key_id']);
  const hasSecret = checkEnv('RAZORPAY_KEY_SECRET');
  return {
    ok: hasKey && hasSecret,
    detail: hasKey ? maskValue(process.env.RAZORPAY_KEY_ID) : 'keys missing',
  };
};

const getMongoStatus = () => {
  const state = mongoose.connection.readyState;
  const stateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  if (state !== 1) {
    return { ok: false, detail: stateMap[state] || 'unknown' };
  }

  const { host, name, port } = mongoose.connection;
  return {
    ok: true,
    detail: `${host}${port ? `:${port}` : ''} / db: ${name}`,
  };
};

const logLine = (service, ok, detail = '') => {
  const icon = statusIcon(ok);
  const label = statusLabel(ok);
  const padded = service.padEnd(18, ' ');
  console.log(`  ${icon} ${padded} ${label}${detail ? `  →  ${detail}` : ''}`);
};

const printStartupReport = async ({ port, allowedOrigins = [], io = null }) => {
  const mongo = getMongoStatus();
  const email = getEmailStatus();
  const razorpay = getRazorpayStatus();
  const jwtOk = checkEnv('JWT_SECRET');
  const clientUrl = process.env.CLIENT_URL || '(default origins)';
  const socketClients = io?.engine?.clientsCount ?? 0;
  const pdfDelivery = isCloudinaryConfigured ? await checkPdfDeliveryEnabled() : { ok: false, detail: 'Cloudinary not configured' };

  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  RouteUp Backend — Connection Status');
  console.log('══════════════════════════════════════════════════════');
  logLine('HTTP Server', true, `http://localhost:${port}`);
  logLine('MongoDB', mongo.ok, mongo.detail);
  logLine('Socket.io', Boolean(io), io ? `${socketClients} client(s) online` : 'not initialized');
  logLine('JWT Auth', jwtOk, jwtOk ? 'secret configured' : 'JWT_SECRET missing');
  logLine('Razorpay', razorpay.ok, razorpay.detail);
  logLine('Cloudinary', isCloudinaryConfigured, isCloudinaryConfigured ? process.env.CLOUDINARY_CLOUD_NAME : 'uploads will fail');
  logLine('Cloudinary PDFs', pdfDelivery.ok, pdfDelivery.detail);
  logLine('Email (SMTP)', email.ok, email.detail);
  logLine('CORS / Frontend', allowedOrigins.length > 0, `${allowedOrigins.length} origin(s) allowed`);
  console.log('──────────────────────────────────────────────────────');
  console.log(`  CLIENT_URL: ${clientUrl}`);
  console.log(`  NODE_ENV:   ${process.env.NODE_ENV || 'development'}`);
  console.log('══════════════════════════════════════════════════════');
  console.log('');
};

const printSocketConnection = (socket, io) => {
  const adminRoom = io.sockets.adapter.rooms.get('admin_room');
  const adminCount = adminRoom ? adminRoom.size : 0;
  const total = io.engine?.clientsCount ?? io.sockets.sockets.size;
  console.log(
    `[Socket] + connect  id=${socket.id}  transport=${socket.conn?.transport?.name || 'unknown'}  total=${total}  admin_room=${adminCount}`
  );
};

const printSocketDisconnection = (socket, io, reason) => {
  const total = io.sockets.sockets.size;
  console.log(`[Socket] - disconnect  id=${socket.id}  reason=${reason || 'unknown'}  total=${total}`);
};

const printSocketAdminJoin = (socket) => {
  console.log(`[Socket]   joined admin_room  id=${socket.id}`);
};

module.exports = {
  printStartupReport,
  printSocketConnection,
  printSocketDisconnection,
  printSocketAdminJoin,
  logLine,
};
