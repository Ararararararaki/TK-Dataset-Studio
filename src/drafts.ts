// Presentation drafts are crash-recoverable; persisted image revisions stay server-owned.
type Draft = { text: string; revision: number };
const prefix = "tkds:image-draft:";
const writers = new Map<string, () => Promise<void>>();
export function readDraft(id: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(prefix + id) || "null");
  } catch {
    return null;
  }
}
export function keepDraft(id: string, draft: Draft) {
  localStorage.setItem(prefix + id, JSON.stringify(draft));
}
export function clearDraft(id: string, text: string) {
  if (readDraft(id)?.text === text) localStorage.removeItem(prefix + id);
}
export function registerWriter(id: string, write: () => Promise<void>) {
  writers.set(id, write);
  return () => {
    writers.delete(id);
  };
}
export async function flushDrafts() {
  await Promise.all([...writers.values()].map((write) => write()));
}
