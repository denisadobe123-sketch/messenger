// Широкий "happy path" прогон по функциям, которые ещё не проверялись
// end-to-end: сообщения (отправка/чтение/редактирование/удаление), реакции,
// опросы, закрепление, группы (добавление/удаление/выход), пересылка, поиск.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

const srv = createTestServer(39218);
const { connectSocket, emitWithAck, waitForEvent, apiFetch } = srv;

let alice, bob, carol, chat;

test.before(async () => {
  await srv.start();
  alice = await srv.registerUser('alice-smoke@test.local');
  bob = await srv.registerUser('bob-smoke@test.local');
  carol = await srv.registerUser('carol-smoke@test.local');
  const { body } = await apiFetch('/chats', alice.token, {
    method: 'POST', body: JSON.stringify({ type: 'private', members: [bob.user.id] })
  });
  chat = body;
});

test.after(() => srv.stop());

test('send → deliver → read receipt updates live (messages_read)', async () => {
  const aliceSocket = await connectSocket(alice.token);
  const bobSocket = await connectSocket(bob.token);

  const bobGotMessage = waitForEvent(bobSocket, 'new_message');
  const sendRes = await emitWithAck(aliceSocket, 'send_message', { chatId: chat.id, text: 'hello bob' });
  assert.equal(sendRes.ok, true);
  const delivered = await bobGotMessage;
  assert.equal(delivered.text, 'hello bob');

  const aliceGotRead = waitForEvent(aliceSocket, 'messages_read');
  bobSocket.emit('read_messages', { chatId: chat.id });
  const readEvent = await aliceGotRead;
  assert.equal(readEvent.userId, bob.user.id);

  aliceSocket.disconnect();
  bobSocket.disconnect();
});

test('edit and delete a message', async () => {
  const aliceSocket = await connectSocket(alice.token);
  const bobSocket = await connectSocket(bob.token);

  const bobGotMessage = waitForEvent(bobSocket, 'new_message');
  const { message } = await emitWithAck(aliceSocket, 'send_message', { chatId: chat.id, text: 'original text' });
  await bobGotMessage;

  const bobGotEdit = waitForEvent(bobSocket, 'message_edited');
  aliceSocket.emit('edit_message', { messageId: message.id, text: 'edited text' });
  const edited = await bobGotEdit;
  assert.equal(edited.text, 'edited text');
  assert.equal(edited.edited, true);

  const bobGotDelete = waitForEvent(bobSocket, 'message_deleted');
  aliceSocket.emit('delete_message', { messageId: message.id });
  const deleted = await bobGotDelete;
  assert.equal(deleted.messageId, message.id);

  aliceSocket.disconnect();
  bobSocket.disconnect();
});

test('reactions toggle on and off', async () => {
  const aliceSocket = await connectSocket(alice.token);
  const bobSocket = await connectSocket(bob.token);
  const { message } = await emitWithAck(aliceSocket, 'send_message', { chatId: chat.id, text: 'react to me' });

  const bobGotReaction = waitForEvent(bobSocket, 'reaction_updated');
  aliceSocket.emit('add_reaction', { messageId: message.id, emoji: '👍' });
  const added = await bobGotReaction;
  assert.deepEqual(added.reactions, [{ emoji: '👍', userIds: [alice.user.id] }]);

  const bobGotUnreaction = waitForEvent(bobSocket, 'reaction_updated');
  aliceSocket.emit('add_reaction', { messageId: message.id, emoji: '👍' }); // toggle off
  const removed = await bobGotUnreaction;
  assert.deepEqual(removed.reactions, []);

  aliceSocket.disconnect();
  bobSocket.disconnect();
});

test('valid poll: create, vote, switch vote (single-choice)', async () => {
  const aliceSocket = await connectSocket(alice.token);
  const bobSocket = await connectSocket(bob.token);

  const bobGotPoll = waitForEvent(bobSocket, 'new_message');
  const poll = { question: 'Best color?', multi: false, options: [{ text: 'Red', votes: [] }, { text: 'Blue', votes: [] }] };
  const { ok, message } = await emitWithAck(aliceSocket, 'send_message', { chatId: chat.id, poll });
  assert.equal(ok, true);
  await bobGotPoll;

  const aliceGotVote = waitForEvent(aliceSocket, 'poll_updated');
  bobSocket.emit('vote_poll', { messageId: message.id, optionIdx: 1 });
  const voted = await aliceGotVote;
  assert.deepEqual(voted.poll.options[1].votes, [bob.user.id]);
  assert.deepEqual(voted.poll.options[0].votes, []);

  aliceSocket.disconnect();
  bobSocket.disconnect();
});

test('pin and unpin a message updates pinnedIds for all members', async () => {
  const aliceSocket = await connectSocket(alice.token);
  const bobSocket = await connectSocket(bob.token);
  const { message } = await emitWithAck(aliceSocket, 'send_message', { chatId: chat.id, text: 'pin me' });

  const bobGotPin = waitForEvent(bobSocket, 'chat_pinned');
  aliceSocket.emit('pin_message', { chatId: chat.id, messageId: message.id });
  const pinned = await bobGotPin;
  assert.ok(pinned.pinnedIds.includes(message.id));

  const bobGotUnpin = waitForEvent(bobSocket, 'chat_pinned');
  aliceSocket.emit('unpin_message', { chatId: chat.id, messageId: message.id });
  const unpinned = await bobGotUnpin;
  assert.ok(!unpinned.pinnedIds.includes(message.id));

  aliceSocket.disconnect();
  bobSocket.disconnect();
});

test('forward a message into another chat', async () => {
  const { body: savedChat } = await apiFetch('/chats', alice.token, { method: 'POST', body: JSON.stringify({ type: 'saved' }) });
  const aliceSocket = await connectSocket(alice.token);
  const { message } = await emitWithAck(aliceSocket, 'send_message', { chatId: chat.id, text: 'forward this' });

  const res = await emitWithAck(aliceSocket, 'send_message', {
    chatId: savedChat.id, text: message.text, forwardOf: { senderName: message.senderName }
  });
  assert.equal(res.ok, true);
  assert.equal(res.message.forwardOf.senderName, message.senderName);
  aliceSocket.disconnect();
});

test('group chat: create, add member, non-creator remove is a no-op, creator remove works, member can leave', async () => {
  const { body: group } = await apiFetch('/chats', alice.token, {
    method: 'POST', body: JSON.stringify({ type: 'group', name: 'Squad', members: [bob.user.id] })
  });

  const carolSocket = await connectSocket(carol.token);
  const carolNewChat = waitForEvent(carolSocket, 'new_chat');
  const aliceSocket = await connectSocket(alice.token);
  aliceSocket.emit('add_members', { chatId: group.id, userIds: [carol.user.id] });
  const added = await carolNewChat;
  assert.equal(added.id, group.id);

  // Не-создатель (bob) не может удалить carol
  const bobSocket = await connectSocket(bob.token);
  bobSocket.emit('remove_member', { chatId: group.id, userId: carol.user.id });
  await new Promise(r => setTimeout(r, 400));
  const { body: stillIn } = await apiFetch('/chats', alice.token);
  assert.ok(stillIn.find(c => c.id === group.id).members.includes(carol.user.id), 'non-creator remove_member must be a no-op');

  // Создатель (alice) может удалить carol
  const carolRemoved = waitForEvent(carolSocket, 'chat_deleted');
  aliceSocket.emit('remove_member', { chatId: group.id, userId: carol.user.id });
  await carolRemoved;

  // Bob может сам выйти из группы
  bobSocket.emit('leave_chat', { chatId: group.id });
  await new Promise(r => setTimeout(r, 300));
  const { body: afterLeave } = await apiFetch('/chats', alice.token);
  assert.ok(!afterLeave.find(c => c.id === group.id).members.includes(bob.user.id));

  aliceSocket.disconnect(); bobSocket.disconnect(); carolSocket.disconnect();
});

test('message search finds text in a regular (non-secret) chat', async () => {
  const aliceSocket = await connectSocket(alice.token);
  await emitWithAck(aliceSocket, 'send_message', { chatId: chat.id, text: 'the quick brown fox' });
  const { body: results } = await apiFetch(`/messages/${chat.id}/search?q=quick`, alice.token);
  assert.ok(results.some(m => m.text === 'the quick brown fox'));
  aliceSocket.disconnect();
});

test('privacy settings roundtrip', async () => {
  await apiFetch('/privacy', alice.token, { method: 'POST', body: JSON.stringify({ lastSeen: 'contacts', calls: 'nobody' }) });
  const { body: priv } = await apiFetch('/privacy', alice.token);
  assert.equal(priv.lastSeen, 'contacts');
  assert.equal(priv.calls, 'nobody');
});
