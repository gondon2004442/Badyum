use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// Значок в трее и меню при нём.
///
/// Нужен не ради красоты: без него закрытие окна пришлось бы понимать как выход
/// из приложения, а это ровно то, чего в голосовой программе делать нельзя.
/// Крестик посреди разговора — обычное движение, и обрывать по нему связь значит
/// наказывать человека за привычку. Со значком окно просто прячется, а вернуть
/// его есть чем.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Badyum")
        .menu(&menu)
        // Левый клик открывает окно, меню висит на правом. Ровно так ведут себя
        // все программы, живущие в трее, и нарушать это не за чем.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show(app),
            // Единственный способ выйти насовсем. Всё остальное прячет окно.
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show(tray.app_handle());
            }
        });

    // Своей иконки у трея нет — берём ту же, что у окна. Отдельная выглядела бы
    // как другое приложение.
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

/// Показать окно и передать ему фокус.
///
/// Три действия, а не одно: спрятанное окно надо показать, свёрнутое —
/// развернуть, а поднятое из трея ещё и вывести вперёд, иначе оно откроется за
/// игрой и человек решит, что нажатие не сработало.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}
