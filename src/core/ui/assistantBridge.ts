/**
 * How any screen can open the assistant (Handy) about something, without knowing which module provides it:
 * `askAssistant({ title, prompt })` from the screen, and the assistant's own overlay listens with `onAssistantRequest`.
 */
export interface AssistantRequest {
  /** A short name for the chat, like the to-do item. */
  title: string;
  /** What to ask first (empty: just open a new chat). */
  prompt: string;
}

const listeners = new Set<(r: AssistantRequest) => void>();

export function askAssistant(r: AssistantRequest): void {
  listeners.forEach((l) => l(r));
}
/** Listens for requests; returns how to stop. */
export function onAssistantRequest(handler: (r: AssistantRequest) => void): () => void {
  listeners.add(handler);
  return () => void listeners.delete(handler);
}
