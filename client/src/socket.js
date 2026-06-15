import { io } from 'socket.io-client';
import { SOCKET_URL } from './api.js';

let socket = null;

export function getSocket() {
  return socket;
}

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io(SOCKET_URL, { auth: { token } });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
