import type { GroundedChunk, Timings } from '../types/scientific-rag';

export interface AssistantMessageInput {
  content: string;
  citations: string[];
  grounded_chunks: GroundedChunk[];
  timings: Timings;
}

export interface SavedExchange {
  session_id: string;
  user_message_id: string;
  assistant_message_id: string;
}

/** What the RAG pipeline needs from chat sessions (implemented by ChatSessionsService). */
export interface SessionStorePort {
  /** The session if it belongs to the user; otherwise 404 `session not found`. */
  assertOwned(sessionId: string, userId: string): Promise<void>;
  /**
   * Stores one question/answer pair. `sessionId` null ➔ a new session titled after the question.
   */
  saveExchange(
    userId: string,
    sessionId: string | null,
    question: string,
    answer: AssistantMessageInput,
  ): Promise<SavedExchange>;
}

export const SESSION_STORE = Symbol('SESSION_STORE');
