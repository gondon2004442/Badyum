import { HOST, MAX_PARTICIPANTS, PORT, hasTurn } from "./config.ts";
import { ChannelStore } from "./channels.ts";
import { RoomRegistry } from "./rooms.ts";
import { ChatLog } from "./chat.ts";
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

await app.listen({ port: PORT, host: HOST });
attachSignaling(app.server, { channels, rooms, chat });

app.log.info(`сигналинг слушает ws://${HOST}:${PORT}/ws`);
app.log.info(`тестовый канал: http://localhost:5173/j/${devInvite.code}`);

if (!hasTurn) {
  app.log.warn(
    "TURN не настроен: соединения из мобильных сетей за CGNAT устанавливаться не будут. " +
      "Подними coturn (infra/docker-compose.yml) и задай BADYUM_TURN_HOSTS + BADYUM_TURN_SECRET.",
  );
}
