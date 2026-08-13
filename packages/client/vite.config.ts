import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Какая это сборка. Уходит в сообщения о поломках.
 *
 * Без него журнал ошибок бесполезен: непонятно, пришла жалоба со свежей версии
 * или у человека в браузере лежит вчерашняя из кэша. Коммит подходит лучше
 * времени сборки — по нему сразу видно, вошло исправление или нет; время
 * остаётся запасным вариантом там, где git недоступен (образ Docker, чужая
 * копия репозитория без истории).
 */
const BUILD_ID = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return new Date().toISOString().slice(0, 16);
  }
})();

/**
 * Домены туннелей, через которые проверяют звонок с телефона и с друзьями.
 *
 * Их несколько, потому что один провайдер может не подойти: cloudflared ходит
 * наружу по порту 7844, и там, где он закрыт, туннель не поднимется вообще.
 * Запасные варианты используют 443 и 22, которые открыты почти везде.
 */
const TUNNEL_HOSTS = [
  ".trycloudflare.com", // cloudflared
  ".lhr.life", // localhost.run, по ssh
  ".serveo.net", // serveo, по ssh
  ".ngrok-free.app", // ngrok
  ".ngrok.io",
  ".ngrok.app",
  ".devtunnels.ms", // порт-форвардинг VS Code
  ".loca.lt", // localtunnel
];

/** Свой домен через запятую, если понадобится что-то ещё. */
const EXTRA_HOSTS = (process.env.BADYUM_DEV_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const ALLOWED_HOSTS = [
  ...TUNNEL_HOSTS,
  ".badyum.ru",
  ".badyum.online",
  ...EXTRA_HOSTS,
];

/** Сигналинг и API всегда на соседнем порту — путь один и для dev, и для preview. */
const PROXY = {
  "/api": { target: "http://localhost:8787", changeOrigin: true },
  "/ws": { target: "ws://localhost:8787", ws: true },
};

export default defineConfig({
  plugins: [react()],
  define: {
    __BADYUM_BUILD__: JSON.stringify(BUILD_ID),
  },
  server: {
    // Слушаем все интерфейсы: телефон проверяется с той же машины по локальному
    // IP, а не через localhost.
    host: true,
    /**
     * Хосты, под которыми дев-сервер согласен отвечать.
     *
     * Vite защищается от DNS rebinding и по умолчанию пускает только localhost.
     * Но проверить звонок с телефона или с другом можно исключительно по https
     * — микрофон в незащищённом контексте недоступен, — а значит через туннель,
     * и тогда Host приходит чужой. Без этого списка человек получает
     * «Blocked request» вместо приложения.
     *
     * Список, а не `true`: отключать проверку целиком незачем. Точка в начале
     * разрешает и сам домен, и его поддомены. Если понадобится провайдер, не
     * попавший в список, его добавляют переменной BADYUM_DEV_HOSTS — менять
     * конфиг ради этого не нужно.
     */
    allowedHosts: ALLOWED_HOSTS,
    port: 5173,
    proxy: PROXY,
  },

  /**
   * Собранная версия — то, что показывают людям через туннель.
   *
   * Дев-сервер отдаёт каждый модуль исходников отдельным запросом; их сотни, и
   * через туннель страница либо ползёт, либо не догружается вовсе — выглядит
   * это как пустой экран с вечно крутящейся вкладкой. Собранный билд — это
   * один бандл, и он проходит туннель нормально.
   */
  preview: {
    host: true,
    allowedHosts: ALLOWED_HOSTS,
    port: 4173,
    proxy: PROXY,
  },
});
