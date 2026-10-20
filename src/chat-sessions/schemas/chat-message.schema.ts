import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { GroundedChunk, Timings } from '../../types/scientific-rag';

export type MessageRole = 'user' | 'assistant';

@Schema({ collection: 'chat_messages', versionKey: false })
export class ChatMessage {
  @Prop({ type: Types.ObjectId, required: true })
  session_id: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role: MessageRole;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [String], default: undefined })
  citations?: string[];

  @Prop({ type: [MongooseSchema.Types.Mixed], default: undefined })
  grounded_chunks?: GroundedChunk[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: undefined })
  timings?: Timings;

  @Prop({ type: Date, required: true })
  created_at: Date;
}

export type ChatMessageDocument = HydratedDocument<ChatMessage>;
export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({ session_id: 1, created_at: 1 });
