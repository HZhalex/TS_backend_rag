import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  isValidObjectId,
  Model,
  Types,
} from 'mongoose';
import { decodeCursor, encodeCursor, Page } from '../common/pagination';
import { logEvent } from '../common/request-context';
import {
  MessageDto,
  SessionDto,
  SessionSummaryDto,
} from './dto/chat-session.dto';
import { ChatMessage } from './schemas/chat-message.schema';
import {
  ChatSession,
  ChatSessionDocument,
} from './schemas/chat-session.schema';
import type {
  AssistantMessageInput,
  SavedExchange,
  SessionStorePort,
} from './session-store.port';

export const SESSION_NOT_FOUND = 'session not found';
export const DEFAULT_TITLE = 'New chat';
export const TITLE_MAX = 120;
export const AUTO_TITLE_CHARS = 60;
export const MAX_MESSAGES = 200;

interface SessionCursor {
  u: string;
  id: string;
}

const isCursor = (v: unknown): v is SessionCursor =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as SessionCursor).u === 'string' &&
  !Number.isNaN(Date.parse((v as SessionCursor).u)) &&
  isValidObjectId((v as SessionCursor).id);

/** Unicode-aware length (an emoji counts as one character). */
const charLength = (s: string) => Array.from(s).length;

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Trimmed title of 1–120 characters, else 400 `invalid title`. */
export function validTitle(raw: string): string {
  const t = raw.trim();
  if (!t || charLength(t) > TITLE_MAX)
    throw new BadRequestException('invalid title');
  return t;
}

/** First 60 characters of the question, whitespace collapsed. */
export function titleFromQuestion(q: string): string {
  const flat = q.replace(/\s+/g, ' ').trim();
  return (
    Array.from(flat).slice(0, AUTO_TITLE_CHARS).join('').trim() || DEFAULT_TITLE
  );
}

function toSummary(
  s: ChatSessionDocument | (ChatSession & { _id: Types.ObjectId }),
): SessionSummaryDto {
  return {
    id: s._id.toString(),
    title: s.title,
    message_count: s.message_count,
    created_at: s.created_at.toISOString(),
    updated_at: s.updated_at.toISOString(),
  };
}

function toMessage(m: ChatMessage & { _id: Types.ObjectId }): MessageDto {
  const out: MessageDto = {
    id: m._id.toString(),
    role: m.role,
    content: m.content,
    created_at: m.created_at.toISOString(),
  };
  if (m.role === 'assistant') {
    out.citations = m.citations ?? [];
    out.grounded_chunks = m.grounded_chunks ?? [];
    if (m.timings) out.timings = m.timings;
  }
  return out;
}

@Injectable()
export class ChatSessionsService implements SessionStorePort {
  constructor(
    @InjectModel(ChatSession.name)
    private readonly sessions: Model<ChatSession>,
    @InjectModel(ChatMessage.name)
    private readonly messages: Model<ChatMessage>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async list(
    userId: string,
    limit: number,
    cursor?: string,
    q?: string,
  ): Promise<Page<SessionSummaryDto>> {
    const filter: Record<string, unknown> = {
      user_id: new Types.ObjectId(userId),
    };
    if (q?.trim())
      filter.title = { $regex: escapeRegex(q.trim()), $options: 'i' };
    if (cursor) {
      const c = decodeCursor(cursor, isCursor);
      const u = new Date(c.u);
      filter.$or = [
        { updated_at: { $lt: u } },
        { updated_at: u, _id: { $lt: new Types.ObjectId(c.id) } },
      ];
    }
    const rows = await this.sessions
      .find(filter)
      .sort({ updated_at: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toSummary),
      next_cursor:
        rows.length > limit && last
          ? encodeCursor({
              u: last.updated_at.toISOString(),
              id: last._id.toString(),
            })
          : null,
    };
  }

  async create(userId: string, title?: string): Promise<SessionSummaryDto> {
    const explicit = title === undefined ? null : validTitle(title);
    const s = await this.sessions.create({
      user_id: new Types.ObjectId(userId),
      title: explicit ?? DEFAULT_TITLE,
      title_is_default: explicit === null,
    });
    logEvent('SESSION_CREATED', { session_id: s._id.toString() });
    return toSummary(s);
  }

  async get(userId: string, id: string): Promise<SessionDto> {
    const s = await this.findOwned(id, userId);
    const recent = await this.messages
      .find({ session_id: s._id })
      .sort({ created_at: -1, _id: -1 })
      .limit(MAX_MESSAGES)
      .lean();
    return {
      id: s._id.toString(),
      title: s.title,
      created_at: s.created_at.toISOString(),
      updated_at: s.updated_at.toISOString(),
      messages: recent.reverse().map(toMessage),
    };
  }

  async rename(
    userId: string,
    id: string,
    title: string,
  ): Promise<SessionSummaryDto> {
    const t = validTitle(title);
    if (!isValidObjectId(id)) throw new NotFoundException(SESSION_NOT_FOUND);
    const s = await this.sessions.findOneAndUpdate(
      { _id: id, user_id: new Types.ObjectId(userId) },
      { $set: { title: t, title_is_default: false } },
      { new: true },
    );
    if (!s) throw new NotFoundException(SESSION_NOT_FOUND);
    logEvent('SESSION_RENAMED', { session_id: id });
    return toSummary(s);
  }

  /** Idempotent: unknown ids and other users' sessions are silently ignored. */
  async remove(userId: string, id: string): Promise<void> {
    if (!isValidObjectId(id)) return;
    const res = await this.sessions.deleteOne({
      _id: id,
      user_id: new Types.ObjectId(userId),
    });
    if (res.deletedCount) {
      await this.messages.deleteMany({ session_id: new Types.ObjectId(id) });
      logEvent('SESSION_DELETED', { session_id: id });
    }
  }

  async assertOwned(sessionId: string, userId: string): Promise<void> {
    await this.findOwned(sessionId, userId);
  }

  /** One question/answer pair in a single transaction (new session when `sessionId` is null). */
  async saveExchange(
    userId: string,
    sessionId: string | null,
    question: string,
    answer: AssistantMessageInput,
  ): Promise<SavedExchange> {
    const db = await this.connection.startSession();
    try {
      let saved: SavedExchange | null = null;
      await db.withTransaction(async () => {
        saved = await this.writeExchange(
          db,
          userId,
          sessionId,
          question,
          answer,
        );
      });
      if (!saved) throw new Error('transaction produced no result');
      return saved;
    } finally {
      await db.endSession();
    }
  }

  private async writeExchange(
    db: ClientSession,
    userId: string,
    sessionId: string | null,
    question: string,
    answer: AssistantMessageInput,
  ): Promise<SavedExchange> {
    const uid = new Types.ObjectId(userId);
    let session: ChatSessionDocument;
    if (sessionId) {
      const found = await this.sessions
        .findOne({ _id: sessionId, user_id: uid })
        .session(db);
      if (!found) throw new NotFoundException(SESSION_NOT_FOUND);
      session = found;
    } else {
      [session] = await this.sessions.create(
        [
          {
            user_id: uid,
            title: titleFromQuestion(question),
            title_is_default: false,
          },
        ],
        { session: db },
      );
    }
    const now = Date.now();
    const [userMsg, assistantMsg] = await this.messages.insertMany(
      [
        {
          session_id: session._id,
          role: 'user',
          content: question,
          created_at: new Date(now),
        },
        {
          session_id: session._id,
          role: 'assistant',
          content: answer.content,
          citations: answer.citations,
          grounded_chunks: answer.grounded_chunks,
          timings: answer.timings,
          created_at: new Date(now + 1),
        },
      ],
      { session: db },
    );
    const set: Record<string, unknown> = { updated_at: new Date(now + 1) };
    if (session.title_is_default) {
      set.title = titleFromQuestion(question);
      set.title_is_default = false;
    }
    await this.sessions.updateOne(
      { _id: session._id },
      { $inc: { message_count: 2 }, $set: set },
      { session: db, timestamps: false },
    );
    return {
      session_id: session._id.toString(),
      user_message_id: userMsg._id.toString(),
      assistant_message_id: assistantMsg._id.toString(),
    };
  }

  /** Another user's session is reported exactly like a missing one. */
  private async findOwned(
    id: string,
    userId: string,
  ): Promise<ChatSessionDocument> {
    const s = isValidObjectId(id)
      ? await this.sessions.findOne({
          _id: id,
          user_id: new Types.ObjectId(userId),
        })
      : null;
    if (!s) throw new NotFoundException(SESSION_NOT_FOUND);
    return s;
  }
}
