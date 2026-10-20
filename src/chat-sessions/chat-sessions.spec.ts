import { getModelToken } from '@nestjs/mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { TokenService } from '../auth/token.service';
import { createTestApp, startMongo, TestApp } from '../testing/test-app';
import { ChatSessionsModule } from './chat-sessions.module';
import {
  ChatSessionsService,
  titleFromQuestion,
  validTitle,
} from './chat-sessions.service';
import { ChatSession } from './schemas/chat-session.schema';
import { SESSION_STORE, SessionStorePort } from './session-store.port';

const ALICE = new Types.ObjectId().toString();
const BOB = new Types.ObjectId().toString();

const answer = {
  content: 'LoRA ... [Paper: 2106.09685]',
  citations: ['2106.09685'],
  grounded_chunks: [],
  timings: {
    embed_ms: 1,
    route_ms: 0,
    search_ms: 2,
    rerank_ms: 0,
    llm_ms: 10,
    total_ms: 13,
  },
};

describe('title helpers', () => {
  it('validTitle trims and counts Unicode characters', () => {
    expect(validTitle('  Hi  ')).toBe('Hi');
    expect(validTitle('😀'.repeat(120))).toHaveLength(240); // 120 emoji = 240 UTF-16 units
    expect(() => validTitle('😀'.repeat(121))).toThrow('invalid title');
    expect(() => validTitle('   ')).toThrow('invalid title');
  });

  it('titleFromQuestion keeps the first 60 characters', () => {
    expect(titleFromQuestion('a'.repeat(80))).toBe('a'.repeat(60));
    expect(titleFromQuestion('  How  does\nLoRA work? ')).toBe(
      'How does LoRA work?',
    );
  });
});

describe('Chat sessions (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let t: TestApp;
  let alice: string;
  let bob: string;
  let svc: ChatSessionsService;

  beforeAll(async () => {
    mongo = await startMongo();
    t = await createTestApp(mongo, {
      imports: [AuthModule, ChatSessionsModule],
    });
    const tokens = t.app.get(TokenService);
    alice = (await tokens.issue({ id: ALICE, roles: ['user'] }, 'f1'))
      .access_token;
    bob = (await tokens.issue({ id: BOB, roles: ['user'] }, 'f2')).access_token;
    svc = t.app.get(ChatSessionsService);
  });

  afterAll(async () => {
    await t.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await t.app
      .get<Model<ChatSession>>(getModelToken(ChatSession.name))
      .deleteMany({});
  });

  const http = () => request(t.server());
  const as = (tok: string) => ({ Authorization: `Bearer ${tok}` });

  it('requires a JWT', async () => {
    await http().get('/api/v1/chat-sessions').expect(401);
  });

  it('create, get, rename, delete', async () => {
    const created = await http()
      .post('/api/v1/chat-sessions')
      .set(as(alice))
      .send({})
      .expect(201);
    expect(created.body).toMatchObject({ title: 'New chat', message_count: 0 });
    const id = created.body.id as string;

    const got = await http()
      .get(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .expect(200);
    expect(got.body).toMatchObject({ id, title: 'New chat', messages: [] });

    const renamed = await http()
      .patch(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .send({ title: '  LoRA notes  ' })
      .expect(200);
    expect(renamed.body.title).toBe('LoRA notes');

    const bad = await http()
      .patch(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .send({ title: ' ' })
      .expect(400);
    expect(bad.body.message).toBe('invalid title');

    await http()
      .delete(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .expect(204);
    await http()
      .delete(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .expect(204);
    await http().get(`/api/v1/chat-sessions/${id}`).set(as(alice)).expect(404);
  });

  it("another user's session ➔ 404, and delete does nothing", async () => {
    const { id } = await svc.create(ALICE, 'mine');
    const reads = [
      () => http().get(`/api/v1/chat-sessions/${id}`),
      () => http().patch(`/api/v1/chat-sessions/${id}`).send({ title: 'x' }),
    ];
    for (const req of reads) {
      const r = await req().set(as(bob)).expect(404);
      expect(r.body.message).toBe('session not found');
    }
    await http().delete(`/api/v1/chat-sessions/${id}`).set(as(bob)).expect(204);
    await http().get(`/api/v1/chat-sessions/${id}`).set(as(alice)).expect(200);
    await http()
      .get('/api/v1/chat-sessions/not-an-id')
      .set(as(alice))
      .expect(404);
  });

  it('paginates 3 pages with no duplicates and no gaps (same updated_at too)', async () => {
    const model = t.app.get<Model<ChatSession>>(
      getModelToken(ChatSession.name),
    );
    const same = new Date('2026-10-20T00:00:00Z');
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const [doc] = await model.create(
        [
          {
            user_id: new Types.ObjectId(ALICE),
            title: `s${i}`,
            created_at: same,
            updated_at: i < 4 ? same : new Date(same.getTime() + i * 1000),
          },
        ],
        { timestamps: false },
      );
      ids.push(doc._id.toString());
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = cursor ? `?limit=3&cursor=${cursor}` : '?limit=3';
      const r = await http()
        .get(`/api/v1/chat-sessions${q}`)
        .set(as(alice))
        .expect(200);
      seen.push(...(r.body.items as Array<{ id: string }>).map((x) => x.id));
      cursor = r.body.next_cursor as string | null;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('bad cursor ➔ 400 invalid cursor; limit out of range ➔ 400', async () => {
    const r = await http()
      .get('/api/v1/chat-sessions?cursor=abc!!')
      .set(as(alice))
      .expect(400);
    expect(r.body.message).toBe('invalid cursor');
    await http()
      .get('/api/v1/chat-sessions?limit=51')
      .set(as(alice))
      .expect(400);
  });

  it('q searches titles case-insensitively, regex characters are literal', async () => {
    await svc.create(ALICE, 'What is C++ (really)?');
    await svc.create(ALICE, 'LoRA basics');
    await svc.create(BOB, 'lora for bob');
    const plus = await http()
      .get(`/api/v1/chat-sessions?q=${encodeURIComponent('c++ (REALLY')}`)
      .set(as(alice))
      .expect(200);
    expect(plus.body.items.map((x: { title: string }) => x.title)).toEqual([
      'What is C++ (really)?',
    ]);
    const lora = await http()
      .get('/api/v1/chat-sessions?q=LORA')
      .set(as(alice))
      .expect(200);
    expect(lora.body.items.map((x: { title: string }) => x.title)).toEqual([
      'LoRA basics',
    ]);
    const dot = await http()
      .get('/api/v1/chat-sessions?q=.*')
      .set(as(alice))
      .expect(200);
    expect(dot.body.items).toEqual([]);
  });

  it('saveExchange: new session titled after the question, count +2, messages in order', async () => {
    const store = t.app.get<SessionStorePort>(SESSION_STORE);
    const first = await store.saveExchange(
      ALICE,
      null,
      'How does LoRA reduce trainable parameters in practice?',
      answer,
    );
    await store.saveExchange(ALICE, first.session_id, 'And QLoRA?', answer);
    const r = await http()
      .get(`/api/v1/chat-sessions/${first.session_id}`)
      .set(as(alice))
      .expect(200);
    expect(r.body.title).toBe(
      'How does LoRA reduce trainable parameters in practice?',
    );
    expect(
      r.body.messages.map((m: { role: string; content: string }) => [
        m.role,
        m.content,
      ]),
    ).toEqual([
      ['user', 'How does LoRA reduce trainable parameters in practice?'],
      ['assistant', answer.content],
      ['user', 'And QLoRA?'],
      ['assistant', answer.content],
    ]);
    expect(r.body.messages[1]).toMatchObject({
      citations: ['2106.09685'],
      timings: answer.timings,
    });
    expect(r.body.messages[0]).not.toHaveProperty('citations');
    const list = await http()
      .get('/api/v1/chat-sessions')
      .set(as(alice))
      .expect(200);
    expect(list.body.items[0]).toMatchObject({
      id: first.session_id,
      message_count: 4,
    });
  });

  it('saveExchange into an explicitly created untitled session takes the question as title', async () => {
    const s = await svc.create(ALICE);
    await svc.saveExchange(ALICE, s.id, 'Diffusion models?', answer);
    expect((await svc.get(ALICE, s.id)).title).toBe('Diffusion models?');
  });

  it("saveExchange into someone else's session ➔ 404 and nothing written", async () => {
    const s = await svc.create(ALICE, 'mine');
    await expect(svc.saveExchange(BOB, s.id, 'q', answer)).rejects.toThrow(
      'session not found',
    );
    expect((await svc.get(ALICE, s.id)).messages).toHaveLength(0);
  });
});
