mod hotkeys;
mod login;
mod overlay;
mod system;
mod tray;

use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::ShortcutState;

use hotkeys::HotkeyState;
use overlay::OverlayState;

#[derive(Clone, Serialize)]
struct PttEvent {
    down: bool,
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
    // Manager — ради get_webview_window. Импорт локальный: на macOS и Windows
    // эта функция пустая, и трейт там оказался бы неиспользуемым.
    use tauri::Manager;
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
    let state = match HotkeyState::new() {
        Ok(state) => state,
        // Значения по умолчанию зашиты в коде: не разобрались — это ошибка
        // программиста, и падать здесь честнее, чем стартовать без рации.
        Err(problem) => panic!("клавиши по умолчанию заданы неверно: {problem}"),
    };

    tauri::Builder::default()
        .manage(state)
        .manage(OverlayState::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            // На macOS автозапуск бывает двух видов. LaunchAgent — обычный, тот
            // самый список «Открывать при входе»; альтернатива требует прав
            // администратора, и ради голосового чата это перебор.
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // С этим ключом система и запустит приложение. По нему мы отличаем
            // старт вместе с компьютером от запуска руками: в первом случае
            // окно показывать нельзя — человек включил машину, а не Badyum.
            Some(vec![system::HIDDEN_FLAG]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    /*
                      Сравниваем с тем, что реально забиндено.

                      Раньше здесь стояла проверка на константу. С настраиваемым
                      сочетанием так нельзя: одна и та же клавиша с разными
                      модификаторами — это разные бинды, и по коду клавиши их не
                      различить.
                    */
                    let state = app.state::<HotkeyState>();
                    let (ptt, overlay) = {
                        let Ok(binds) = state.binds.lock() else {
                            return;
                        };
                        (binds.ptt, binds.overlay)
                    };

                    if *shortcut == ptt {
                        // Нажали — передаём, отпустили — замолкаем. Это рация,
                        // поэтому нужны оба края, а не одно срабатывание.
                        let down = matches!(event.state(), ShortcutState::Pressed);
                        log::info!("рация: {}", if down { "зажата" } else { "отпущена" });
                        let _ = app.emit("badyum://ptt", PttEvent { down });
                        return;
                    }

                    if *shortcut == overlay {
                        /*
                          Только нажатие: панель — это переключатель, и на
                          отпускании она сложилась бы обратно тут же.

                          Само окно не трогаем. Показывать панель уместно только
                          в канале, а знает об этом страница — она и ответит
                          командой set_overlay.
                        */
                        if matches!(event.state(), ShortcutState::Pressed) {
                            let _ = app.emit("badyum://overlay-toggle", ());
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            hotkeys::hotkeys,
            hotkeys::set_hotkeys,
            overlay::set_overlay,
            system::notify,
            system::autostart,
            system::set_autostart,
            login::login
        ])
        /*
          Крестик прячет окно, а не закрывает приложение.

          Закрыть окно посреди разговора — обычное движение, и обрывать по нему
          связь значит наказывать человека за привычку. Так же ведут себя
          Discord и все, кто живёт в трее.

          Выход насовсем остаётся ровно один — пункт в меню трея. Он идёт через
          app.exit, который сюда не заходит, поэтому взаимной блокировки нет.
        */
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Только главное окно. Окно входа закрывается насовсем: прятать
                // его в трей значило бы оставить висеть страницу Google.
                if window.label() != "main" {
                    return;
                }

                api.prevent_close();
                let _ = window.hide();
                system::hint_hidden(window.app_handle());
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            allow_microphone(app.handle());
            hotkeys::register_defaults(app.handle());

            /*
              Окно объявлено скрытым и показывается здесь.

              Иначе автозапуск выбрасывал бы Badyum на весь экран при каждом
              включении компьютера — поведение, за которое программы и убирают
              из автозагрузки. Заодно исчезает вспышка пустого окна перед тем,
              как страница отрисуется.
            */
            if !system::started_hidden() {
                tray::show(app.handle());
            }

            // Без значка спрятанное окно стало бы невозвратным.
            if let Err(error) = tray::install(app.handle()) {
                log::error!("значок в трее не поднялся: {error}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}
