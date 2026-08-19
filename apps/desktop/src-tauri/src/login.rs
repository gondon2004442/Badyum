use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use url::Url;

/// Ярлык окна входа. Одно на всё приложение: второе открывать незачем.
const LABEL: &str = "login";

/**
 * Вход через Google отдельным окном.
 *
 * В браузере вход — это переход по ссылке: страница уходит к Google и
 * возвращается обратно уже с кукой. В приложении так нельзя: страница лежит в
 * его файлах, и уведи мы окно на badyum.ru, приложение превратилось бы в сайт
 * и обратно уже не вернулось.
 *
 * Поэтому вход живёт в своём окне. Кука при этом попадает в общее хранилище
 * webview, и запросы из главного окна начинают её отправлять — ради этого она
 * и переведена на SameSite=None.
 */
#[tauri::command]
pub fn login<R: Runtime>(app: AppHandle<R>, url: String, server: String) -> Result<(), String> {
    let target: Url = url.parse().map_err(|_| format!("неверный адрес входа: {url}"))?;
    let server: Url = server
        .parse()
        .map_err(|_| format!("неверный адрес сервера: {server}"))?;

    // Открыто с прошлого раза — просто поднимаем, второе окно только запутает.
    if let Some(existing) = app.get_webview_window(LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let handle = app.clone();

    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(target))
        .title("Вход через Google")
        .inner_size(520.0, 700.0)
        .resizable(true)
        .focused(true)
        /*
          Ловим возвращение с Google.

          Пока идёт вход, адрес принадлежит Google. Как только он снова
          указывает на наш сервер и это уже не ручка авторизации — значит
          callback отработал, кука выдана и окну больше нечего делать.

          Закрываем не отсюда, а следующим тиком: закрыть окно прямо в
          обработчике перехода — это выдернуть из-под него землю посреди
          навигации.
        */
        .on_navigation(move |next| {
            let done = next.host_str() == server.host_str()
                && next.scheme() == server.scheme()
                && !next.path().starts_with("/api/auth/");

            if done {
                let app = handle.clone();
                let closer = handle.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(window) = closer.get_webview_window(LABEL) {
                        let _ = window.close();
                    }
                });
                // Переход не пускаем: страницу сайта показывать уже незачем.
                return false;
            }

            true
        })
        .build()
        .map_err(|error| format!("не удалось открыть окно входа: {error}"))?;

    Ok(())
}
