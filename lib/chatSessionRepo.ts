/** Chat session repository for persisting AI chat history. */

import type { AiChatTurn } from './aiClient';
import { ensureDatabaseAsync } from './db';

function isoNow(): string {
  return new Date().toISOString();
}

export interface ChatSession {
  id: number;
  recipe_id: number;
  servings: number;
  session_key: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
}

export interface ChatHistory {
  session: ChatSession;
  messages: ChatMessage[];
}

/** Generate a unique session key for a recipe + servings combination */
function generateSessionKey(recipeId: number, servings: number): string {
  return `chat_${recipeId}_${servings}_${Date.now()}`;
}

/** Get or create a chat session for a recipe and servings */
export async function getOrCreateChatSession(
  recipeId: number,
  servings: number
): Promise<ChatSession> {
  const db = await ensureDatabaseAsync();

  // Generate a session key
  const sessionKey = generateSessionKey(recipeId, servings);

  // Check if session exists
  const existing = await db.getFirstAsync<ChatSession>(
    'SELECT * FROM chat_sessions WHERE recipe_id = ? AND servings = ? ORDER BY updated_at DESC LIMIT 1',
    [recipeId, servings]
  );

  if (existing) {
    // Update the session's updated_at
    await db.runAsync('UPDATE chat_sessions SET updated_at = ?, session_key = ? WHERE id = ?', [
      isoNow(),
      sessionKey,
      existing.id,
    ]);
    return { ...existing, session_key: sessionKey, updated_at: isoNow() };
  }

  // Create new session
  const result = await db.runAsync(
    'INSERT INTO chat_sessions (recipe_id, servings, session_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [recipeId, servings, sessionKey, isoNow(), isoNow()]
  );

  const newSession = await db.getFirstAsync<ChatSession>(
    'SELECT * FROM chat_sessions WHERE id = ?',
    [Number(result.lastInsertRowId)]
  );

  if (!newSession) {
    throw new Error('Failed to create chat session');
  }

  return newSession;
}

/** Save a message to a chat session */
export async function saveChatMessage(
  sessionId: number,
  role: 'user' | 'assistant',
  text: string
): Promise<ChatMessage> {
  const db = await ensureDatabaseAsync();

  const result = await db.runAsync(
    'INSERT INTO chat_messages (session_id, role, text, created_at) VALUES (?, ?, ?, ?)',
    [sessionId, role, text, isoNow()]
  );

  const message = await db.getFirstAsync<ChatMessage>('SELECT * FROM chat_messages WHERE id = ?', [
    Number(result.lastInsertRowId),
  ]);

  if (!message) {
    throw new Error('Failed to save chat message');
  }

  // Update session updated_at
  await db.runAsync('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [isoNow(), sessionId]);

  return message;
}

/** Load all messages for a session */
export async function loadChatMessages(sessionId: number): Promise<ChatMessage[]> {
  const db = await ensureDatabaseAsync();

  return db.getAllAsync<ChatMessage>(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId]
  );
}

/** Load chat history for a recipe and servings */
export async function loadChatHistory(
  recipeId: number,
  servings: number
): Promise<ChatHistory | null> {
  const db = await ensureDatabaseAsync();

  // Get the most recent session for this recipe and servings
  const session = await db.getFirstAsync<ChatSession>(
    'SELECT * FROM chat_sessions WHERE recipe_id = ? AND servings = ? ORDER BY updated_at DESC LIMIT 1',
    [recipeId, servings]
  );

  if (!session) {
    return null;
  }

  const messages = await loadChatMessages(session.id);

  return {
    session,
    messages,
  };
}

/** Delete a chat session and all its messages */
export async function deleteChatSession(sessionId: number): Promise<void> {
  const db = await ensureDatabaseAsync();

  await db.runAsync('DELETE FROM chat_messages WHERE session_id = ?', [sessionId]);
  await db.runAsync('DELETE FROM chat_sessions WHERE id = ?', [sessionId]);
}

/** Delete all chat sessions for a recipe */
export async function deleteChatSessionsForRecipe(recipeId: number): Promise<void> {
  const db = await ensureDatabaseAsync();

  // Get all session IDs for this recipe
  const sessions = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM chat_sessions WHERE recipe_id = ?',
    [recipeId]
  );

  // Delete all messages for these sessions
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => '?').join(',');
    await db.runAsync(
      `DELETE FROM chat_messages WHERE session_id IN (${placeholders})`,
      sessionIds
    );
    await db.runAsync(`DELETE FROM chat_sessions WHERE id IN (${placeholders})`, sessionIds);
  }
}

/** Convert ChatMessage to AiChatTurn for AI calls */
export function chatMessageToAiTurn(message: ChatMessage): AiChatTurn {
  return {
    role: message.role,
    text: message.text,
  };
}

/** Convert AiChatTurn to ChatMessage for storage */
export function aiTurnToChatMessage(
  turn: AiChatTurn,
  session_id: number
): Omit<ChatMessage, 'id' | 'created_at'> {
  return {
    session_id,
    role: turn.role,
    text: turn.text,
  };
}
