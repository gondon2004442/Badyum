use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

/// Клавиша рации по умолчанию.
///
/// F8 выбрана намеренно: она свободна почти во всех играх и её невозможно
/// нажать случайно, набирая текст. Модификаторы здесь только мешали бы — рацию
/// держат одним пальцем, не отрываясь от управления.
const PTT_KEY: Code = Code::F8;
const PTT_LABEL: &str = "F8";

#[derive(Clone, Serialize)]
struct PttEvent {
    down: bool,
}

/// Какая клавиша реально забиндена: интерфейс показывает то, что есть на самом
/// деле, а не зашитую в вёрстку подпись.
#[tauri::command]
fn ptt_hotkey() -> &'static str {
    PTT_LABEL
}

/// Разрешает webview доступ к микрофону.
///
/// WebKitGTK по умолчанию и не включает media stream, и отклоняет запрос
/// разрешения — молча, без всякого диалога. Для приложения, весь смысл которого
/// в голосе, это отказ работать: пользователь видит «нужен доступ к микрофону»
/// и не может ничего с этим сделать, потому что разрешать негде.
///
/// Здесь разрешение выдаётся сразу: микрофон человек уже включил тем, что
/// запустил Badyum и зашёл в канал, второй вопрос был бы бессмысленным.
#[cfg(target_os = "linux")]
fn allow_microphone(app: &tauri::AppHandle) {
    use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let result = window.with_webview(|webview| {
        let view = webview.inner();

        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
            settings.set_enable_media_capabilities(true);
        }

        view.connect_permission_request(|_, request| {
            request.allow();
            true
        });
    });

    if let Err(error) = result {
        log::error!("микрофон в webview останется недоступен: {error}");
    }
}

#[cfg(not(target_os = "linux"))]
fn allow_microphone(_app: &tauri::AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if shortcut.key != PTT_KEY {
                        return;
                    }
                    // Нажали — передаём, отпустили — замолкаем. Это рация,
                    // поэтому нужны оба края, а не одно срабатывание.
                    let down = matches!(event.state(), ShortcutState::Pressed);
                    log::info!("рация: {}", if down { "зажата" } else { "отпущена" });
                    let _ = app.emit("badyum://ptt", PttEvent { down });
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![ptt_hotkey])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            allow_microphone(app.handle());

            // Клавишу мог занять кто-то другой. Это не повод не запускаться:
            // канал работает и без рации, просто без неё.
            let shortcut = Shortcut::new(None, PTT_KEY);
            if let Err(error) = app.global_shortcut().register(shortcut) {
                log::warn!("не удалось занять {PTT_LABEL} под рацию: {error}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}
