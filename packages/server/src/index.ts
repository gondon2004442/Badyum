import { HOST, MAX_PARTICIPANTS, PORT } from "./config.ts";
import { primeTurn, turnStatus } from "./turn.ts";
import { ChannelStore, ChatLog, RoomRegistry } from "@badyum/core";
import { buildHttpServer } from "./http.ts";
import { attachSignaling } from "./signaling.ts";

const channels = new ChannelStore();
const rooms = new RoomRegistry(MAX_PARTICIPANTS);
const chat = new ChatLog();

// Канал по умолчанию для разработки: чтобы `pnpm dev` сразу давал ссылку,
// по которой можно открыть два браузера и проверить звук.
const dev = channels.createChannel({ name: "Катка", slug: "katka" });
const devInvite = channels.createInvite(dev.id, { ttlMs: null });

const app = buildHttpServer({ channels, rooms });

// До приёма трафика: первый же вошедший должен получить список с relay.
await primeTurn();

await app.listen({ port: PORT, host: HOST });
attachSignaling(app.server, { channels, rooms, chat });

app.log.info(`сигналинг слушает ws://${HOST}:${PORT}/ws`);
app.log.info(`тестовый канал: http://localhost:5173/j/${devInvite.code}`);

const turn = turnStatus();
if (turn.configured) {
  app.log.info(
    `relay: ${[turn.cloudflare === "ready" ? "cloudflare" : null, turn.coturn ? "coturn" : null].filter(Boolean).join(" + ")}`,
  );
} else if (turn.cloudflare === "failing") {
  // Ключи заданы, но кред нет — это не «не настроено», а поломка, и звучать
  // она должна иначе: настройки трогать не надо, надо смотреть на ответ API.
  app.log.error(
    "Cloudflare TURN настроен, но креды получить не удалось: relay не работает. " +
      "Проверь BADYUM_CF_TURN_KEY_ID и BADYUM_CF_TURN_API_TOKEN.",
  );
} else {
  app.log.warn(
    "TURN не настроен: соединения из мобильных сетей за CGNAT устанавливаться не будут. " +
      "Либо задай BADYUM_CF_TURN_KEY_ID + BADYUM_CF_TURN_API_TOKEN (managed relay Cloudflare), " +
      "либо подними свой coturn — см. README, раздел «TURN — обязателен, а не опция».",
  );
}
