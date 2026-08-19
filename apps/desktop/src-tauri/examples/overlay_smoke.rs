/*
  Проверка того, что панель вообще появляется на экране.

  Живьём, настоящим окном: типы и cargo check ловят опечатки, а вопрос здесь
  другой — видно ли окно после set_overlay. Ровно на нём панель и сломалась:
  геометрия менялась исправно, но у окна, спрятанного в трей, и результат был
  невидимым.

  Модуль подключается файлом, а не через библиотеку: делать его публичным ради
  проверки значило бы менять рабочий код под тест.
*/
#[path = "../src/overlay.rs"]
mod overlay;

use std::thread;
use std::time::Duration;

use tauri::test::{mock_context, noop_assets};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use overlay::{set_overlay, OverlayState};

/// Дать системе дорисовать окно: show и hide асинхронны, и спрашивать сразу
/// значит спрашивать про прошлое состояние.
fn settle() {
    thread::sleep(Duration::from_millis(400));
}

fn main() {
    let app = tauri::Builder::default()
        .manage(OverlayState::default())
        .build(mock_context(noop_assets()))
        .expect("приложение не собралось");

    let _window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::External(
        "about:blank".parse().unwrap(),
    ))
    .inner_size(900.0, 700.0)
    .visible(true)
    .build()
    .expect("окно не создалось");

    let handle = app.handle().clone();

    thread::spawn(move || {
        let mut log = Vec::new();
        let window = handle.get_webview_window("main").unwrap();

        let note = |log: &mut Vec<_>, step: &str| {
            settle();
            log.push((
                step.to_string(),
                window.is_visible().unwrap_or(false),
                window.is_minimized().unwrap_or(false),
            ));
        };

        settle();
        note(&mut log, "старт");

        // Сценарий ради которого всё: окно спрятано в трей, человек в игре.
        let _ = window.hide();
        note(&mut log, "спрятали в трей");

        set_overlay(window.clone(), handle.state::<OverlayState>(), true).expect("панель не открылась");
        note(&mut log, "F9 — панель");

        set_overlay(window.clone(), handle.state::<OverlayState>(), false).expect("панель не закрылась");
        note(&mut log, "F9 — обратно");

        // Второй сценарий: окно свёрнуто на панель задач.
        let _ = window.show();
        let _ = window.minimize();
        note(&mut log, "свернули");

        set_overlay(window.clone(), handle.state::<OverlayState>(), true).expect("панель не открылась");
        note(&mut log, "F9 — панель");

        set_overlay(window.clone(), handle.state::<OverlayState>(), false).expect("панель не закрылась");
        note(&mut log, "F9 — обратно");

        report(&log);
        /*
          Печатаем и выходим здесь, а не после app.run: run завершает процесс
          сам, и до кода за ним управление не доходит вовсе. exit самого Tauri
          тоже не годится — он не доносит код возврата, а CI смотрит только на
          него.
        */
        std::process::exit(if failures(&log) == 0 { 0 } else { 1 });
    });

    app.run(|_, _| {});
}

type Log = [(String, bool, bool)];

fn report(log: &Log) {
    println!("\n{:<22} {:>9} {:>9}", "шаг", "на экране", "свёрнуто");
    for (step, visible, minimized) in log {
        println!("{step:<22} {:>9} {:>9}", if *visible { "да" } else { "нет" }, if *minimized { "да" } else { "нет" });
    }

    for (what, ok) in checks(log) {
        let mark = match ok {
            Some(true) => "OK      ",
            Some(false) => "ПЛОХО   ",
            None => "не проверить (нет оконного менеджера):",
        };
        println!("{mark} {what}");
    }
}

fn failures(log: &Log) -> usize {
    checks(log).into_iter().filter(|(_, ok)| *ok == Some(false)).count()
}

/// `None` — проверить нечем, и это не провал.
type Check = (&'static str, Option<bool>);

/*
  Второй сценарий проверяется, только если окно вообще свернулось.

  Сворачивание делает оконный менеджер, а под голым Xvfb — где эта проверка и
  гоняется в CI — его нет, и minimize молча ничего не меняет. Считать это
  поломкой кода значило бы держать в CI красный шаг, который ни о чём не
  сообщает; а считать успехом — тем более.
*/
fn checks(log: &Log) -> [Check; 5] {
    let minimizes = log[4].2;
    let only_if = |value: bool| if minimizes { Some(value) } else { None };

    [
        ("из трея панель появляется", Some(log[2].1 && !log[2].2)),
        ("и уходит обратно в трей", Some(!log[3].1)),
        ("из свёрнутого панель появляется", only_if(log[5].1 && !log[5].2)),
        ("и сворачивается обратно", only_if(log[6].2)),
        ("панель не осталась висеть поверх игры", only_if(!log[6].1 || log[6].2)),
    ]
}
