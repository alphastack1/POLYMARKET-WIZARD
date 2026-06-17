import { getStore } from "@netlify/blobs";

export type JournalEntry = {
  id: string;
  at: string;
  type: string;
  message: string;
  data?: unknown;
};

const key = "trade-journal";

export async function readJournal(): Promise<JournalEntry[]> {
  try {
    const store = getStore("bot-state");
    return ((await store.get(key, { type: "json" })) as JournalEntry[] | null) || [];
  } catch {
    return [];
  }
}

export async function writeJournal(entry: Omit<JournalEntry, "id" | "at">) {
  try {
    const store = getStore("bot-state");
    const entries = await readJournal();
    const next = [
      { id: crypto.randomUUID(), at: new Date().toISOString(), ...entry },
      ...entries,
    ].slice(0, 100);
    await store.setJSON(key, next);
    return true;
  } catch {
    return false;
  }
}
