/**
 * Ответ JSON без кеширования.
 *
 * `no-store` здесь не перестраховка: все эти ручки отвечают про конкретного
 * вошедшего, и закешированный где-то по дороге ответ показал бы одному
 * человеку контакты другого.
 */
export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
