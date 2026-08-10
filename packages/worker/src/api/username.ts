import { z } from "zod";
import { normalizeUsername } from "@badyum/core";
import { Users, type User } from "../users.ts";
import { json } from "../http.ts";
import type { Env } from "../env.ts";

const bodySchema = z.object({ username: z.string().min(1).max(40) });

/**
 * Почему юз не подошёл — словами.
 *
 * «Юз не подходит» читается как «сервис сломался». «Можно латиницу, цифры,
 * точку и подчёркивание» — как правило, по которому исправляются с первого
 * раза.
 */
const WHY: Record<string, string> = {
  too_short: "Слишком короткий — нужно хотя бы три символа",
  too_long: "Слишком длинный — не больше двадцати символов",
  bad_chars: "Можно латиницу, цифры, точку и подчёркивание",
  bad_edges: "Не может начинаться или заканчиваться точкой или подчёркиванием",
  double_separator: "Две точки или подчёркивания подряд — нельзя",
  reserved: "Это слово занято сервисом",
  taken: "Этот юз уже занят",
};

/**
 * Выбор юза.
 *
 * Две ручки: спросить «свободен ли» и занять. Первая нужна, чтобы человек
 * видел «занято» пока печатает, а не после нажатия кнопки. Полагаться на неё
 * нельзя — между ответом и нажатием юз успевает занять другой, — поэтому
 * настоящую проверку делает вторая, через уникальный индекс в базе.
 */
export async function handleUsername(
  request: Request,
  url: URL,
  env: Env,
  viewer: User,
): Promise<Response | null> {
  const users = new Users(env.DB);

  if (url.pathname === "/api/username/check") {
    const parsed = normalizeUsername(url.searchParams.get("u") ?? "");
    if (!parsed.ok) return json({ free: false, why: WHY[parsed.problem] });

    const taken = await users.byUsername(parsed.username);
    // Свой собственный юз занятым не считается: человек открыл настройки, а
    // менять передумал, и «занято» на своём же юзе выглядит поломкой.
    const free = !taken || taken.id === viewer.id;

    return json({ free, why: free ? null : WHY.taken });
  }

  if (url.pathname === "/api/username" && request.method === "POST") {
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "bad_input" }, 400);

    const parsed = normalizeUsername(body.data.username);
    if (!parsed.ok) return json({ error: parsed.problem, why: WHY[parsed.problem] }, 400);

    const result = await users.setUsername(viewer.id, parsed.username);
    if (!result.ok) return json({ error: result.error, why: WHY[result.error] }, 409);

    return json({ username: result.user.username });
  }

  return null;
}
