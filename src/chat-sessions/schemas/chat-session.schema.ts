import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({
  collection: 'chat_sessions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class ChatSession {
  @Prop({ type: Types.ObjectId, required: true })
  user_id: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  /** True until the title is set by the user or taken from the first question. */
  @Prop({ default: false })
  title_is_default: boolean;

  @Prop({ default: 0 })
  message_count: number;

  created_at: Date;
  updated_at: Date;
}

export type ChatSessionDocument = HydratedDocument<ChatSession>;
export const ChatSessionSchema = SchemaFactory.createForClass(ChatSession);
ChatSessionSchema.index({ user_id: 1, updated_at: -1, _id: -1 });
