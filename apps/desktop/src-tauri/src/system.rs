use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;

/// Показывали ли уже подсказку про трей.
///
/// Один раз за запуск: первое закрытие окна выглядит как выход из программы, и
/// человека надо предупредить. Повторять на каждое закрытие — навязчиво, он уже
/// понял.
static HINTED: AtomicBool = AtomicBool::new(false);

/// Уведомление системы.
///
/// Зовётся страницей, когда пришло сообщение, а окно не на виду. Без этого
/// сворачивание в трей теряет смысл: человек не узнаёт, что ему написали, пока
/// сам не откроет окно.
#[tauri::command]
pub fn notify<R: Runtime>(app: AppHandle<R>, title: String, body: String) {
    // Молча: не показать уведомление — досадно, но ронять из-за этого нечего.
    // На macOS человек мог просто запретить их системно, и это его право.
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Сказать, что приложение никуда не делось.
pub fn hint_hidden<R: Runtime>(app: &AppHandle<R>) {
    if HINTED.swap(true, Ordering::Relaxed) {
        return;
    }

    let _ = app
        .notification()
        .builder()
        .title("Badyum свернулся в трей")
        .body("Разговор продолжается. Выйти насовсем — правой кнопкой по значку у часов.")
        .show();
}

/// Запускается ли приложение вместе с системой.
#[tauri::command]
pub fn autostart<R: Runtime>(app: AppHandle<R>) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Включить или выключить автозапуск.
///
/// По умолчанию выключен, и включает его только человек руками: программа,
/// самовольно прописавшая себя в автозагрузку, — то, за что их и удаляют.
#[tauri::command]
pub fn set_autostart<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if on { manager.enable() } else { manager.disable() };
    result.map_err(|error| format!("не вышло изменить автозапуск: {error}"))
}

/// Ключ, с которым система запускает Badyum при входе в неё.
pub const HIDDEN_FLAG: &str = "--hidden";

/// Запустили ли нас вместе с компьютером, а не руками.
///
/// Разница существенная: человек, включивший машину, не просил открывать
/// голосовой чат на весь экран — ему нужно, чтобы до него могли дозвониться.
/// Человек, запустивший Badyum сам, наоборот ждёт окна.
///
/// Признак — ключ командной строки, который автозапуск проставляет за нас.
pub fn started_hidden() -> bool {
    std::env::args().any(|arg| arg == HIDDEN_FLAG)
}
