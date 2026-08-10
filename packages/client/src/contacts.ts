import { useCallback, useEffect, useState } from "react";
import { publicOrigin } from "./api.ts";
import type { Account } from "./account.ts";

/** Кем человек тебе приходится. Совпадает с `Relation` в ядре. */
export type Relation = "self" | "none" | "friends" | "outgoing" | "incoming";

export interface Contact {
  user: Account;
  relation: Relation;
  since: number;
}

const MESSAGES: Record<string, string> = {
  not_found: "Такого ника нет — проверь тег после решётки",
  bad_handle: "Ник пишется как имя#1234",
  self: "Это ты сам",
  already_friends: "Вы уже в контактах",
  already_sent: "Заявка уже отправлена",
  too_many: "Слишком много заявок за сутки. Попробуй завтра",
  auth_required: "Нужно войти",
};

export class ContactsError extends Error {
  constructor(code: string) {
    super(MESSAGES[code] ?? "Не получилось");
    this.name = "ContactsError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${publicOrigin()}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ContactsError(body.error ?? "unknown");
  }
  return (await response.json()) as T;
}

/**
 * Открыть переписку с контактом.
 *
 * Возвращает постоянный личный канал пары — тот же самый, в который придёт и
 * звонок. Поэтому переписка и разговор — одно место, а не два.
 */
export function openDirect(
  userId: string,
): Promise<{ channelId: string; code: string; peer: Account }> {
  return call(`/api/contacts/${encodeURIComponent(userId)}/chat`);
}

export interface ContactsState {
  /** Принявшие. Им можно звонить. */
  friends: Contact[];
  /** Позвали тебя — ждут ответа. */
  incoming: Contact[];
  /** Позвал ты — ждёшь ответа. */
  outgoing: Contact[];
  loading: boolean;
  add: (handle: string) => Promise<void>;
  accept: (userId: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  reload: () => void;
}

/**
 * Контакты вошедшего.
 *
 * Гостю не нужен: у него нет ни аккаунта, ни того, кто мог бы его позвать.
 * Поэтому хук принимает аккаунт и при `null` просто ничего не грузит — так
 * гостевой вход по ссылке не делает ни одного лишнего запроса.
 */
export function useContacts(account: Account | null): ContactsState {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!account) {
      setContacts([]);
      return;
    }

    let alive = true;
    setLoading(true);

    void call<{ contacts: Contact[] }>("/api/contacts")
      .then((data) => {
        if (alive) setContacts(data.contacts);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [account?.id, tick]);

  const add = useCallback(
    async (handle: string) => {
      await call("/api/contacts", { method: "POST", body: JSON.stringify({ handle }) });
      reload();
    },
    [reload],
  );

  const accept = useCallback(
    async (userId: string) => {
      await call(`/api/contacts/${encodeURIComponent(userId)}/accept`, { method: "POST" });
      reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (userId: string) => {
      await call(`/api/contacts/${encodeURIComponent(userId)}`, { method: "DELETE" });
      reload();
    },
    [reload],
  );

  return {
    friends: contacts.filter((c) => c.relation === "friends"),
    incoming: contacts.filter((c) => c.relation === "incoming"),
    outgoing: contacts.filter((c) => c.relation === "outgoing"),
    loading,
    add,
    accept,
    remove,
    reload,
  };
}
