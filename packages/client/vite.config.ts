import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
     * Список, а не `true`: отключать проверку целиком незачем, туннель и наши
     * домены исчерпывают реальные случаи. Точка в начале разрешает и сам домен,
     * и его поддомены.
     */
    allowedHosts: [".trycloudflare.com", ".badyum.ru", ".badyum.online"],
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/ws": { target: "ws://localhost:8787", ws: true },
    },
  },
});
