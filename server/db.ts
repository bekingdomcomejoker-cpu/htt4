import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { chatMemories, chatMessages, conversations, InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function listConversations(clientId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(conversations).where(eq(conversations.clientId, clientId)).orderBy(desc(conversations.updatedAt)).limit(50);
}

export async function getConversation(clientId: string, conversationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.clientId, clientId))).limit(1);
  return result[0];
}

export async function createConversation(clientId: string, title: string, model: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available on this deployment.");
  const result = await db.insert(conversations).values({ clientId, title: title.slice(0, 180) || "New OMEGA chat", model });
  const id = Number(result[0].insertId);
  const conversation = await getConversation(clientId, id);
  if (!conversation) throw new Error("Failed to create conversation.");
  return conversation;
}

export async function updateConversationModel(clientId: string, conversationId: number, model: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(conversations).set({ model, updatedAt: new Date() }).where(and(eq(conversations.id, conversationId), eq(conversations.clientId, clientId)));
}

export async function listChatMessages(clientId: string, conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  const conversation = await getConversation(clientId, conversationId);
  if (!conversation) return [];
  return db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId)).orderBy(chatMessages.createdAt).limit(100);
}

export async function addChatMessage(message: { conversationId: number; role: "user" | "assistant"; content: string; model?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available on this deployment.");
  await db.insert(chatMessages).values(message);
}

export async function listChatMemories(clientId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatMemories).where(eq(chatMemories.clientId, clientId)).orderBy(desc(chatMemories.updatedAt)).limit(50);
}

export async function createChatMemory(clientId: string, content: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available on this deployment.");
  const result = await db.insert(chatMemories).values({ clientId, content: content.trim().slice(0, 2000) });
  const id = Number(result[0].insertId);
  const memories = await db.select().from(chatMemories).where(and(eq(chatMemories.id, id), eq(chatMemories.clientId, clientId))).limit(1);
  if (!memories[0]) throw new Error("Failed to save memory.");
  return memories[0];
}

export async function deleteChatMemory(clientId: string, memoryId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available on this deployment.");
  await db.delete(chatMemories).where(and(eq(chatMemories.id, memoryId), eq(chatMemories.clientId, clientId)));
}
