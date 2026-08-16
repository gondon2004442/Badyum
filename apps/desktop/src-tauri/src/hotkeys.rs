use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut};

/// Рация по умолчанию.
///
/// F8 выбрана намеренно: она свободна почти во всех играх и её невозможно
/// нажать случайно, набирая текст. Модификаторов нет — рацию держат одним
/// пальцем, не отрываясь от управления.
pub const DEFAULT_PTT: &str = "F8";

/// Панель по умолчанию — соседняя клавиша, чтобы не запоминать две далёкие.
pub const DEFAULT_OVERLAY: &str = "F9";

/// Что на что забиндено прямо сейчас.
///
/// Раньше клавиша была константой, и обработчик сравнивал с ней код нажатой.
/// Теперь сочетание задаёт человек, поэтому сравнивать надо с тем, что реально
/// зарегистрировано, — и это состояние приходится хранить.
pub struct Binds {
    pub ptt: Shortcut,
    pub overlay: Shortcut,
}

/// Как эти клавиши называются для интерфейса.
///
/// Показываем то, что забиндено на самом деле, а не подпись, зашитую в вёрстку:
/// расходиться им нельзя, иначе человек жмёт то, что написано, и ничего не
/// происходит.
#[derive(Clone, Serialize)]
pub struct HotkeyLabels {
    pub ptt: String,
    pub overlay: String,
}

pub struct HotkeyState {
    pub binds: Mutex<Binds>,
}

/// Разобрать сочетание, пришедшее со страницы.
///
/// Имена клавиш в браузере и в плагине совпадают: `KeyboardEvent.code` даёт
/// `F9`, `KeyB`, `Backquote` — ровно те же, что понимает разборщик. Поэтому
/// таблицы перевода между двумя сторонами не нужно, достаточно сложить
/// модификаторы в строку вида `Shift+F9`.
fn parse(raw: &str) -> Result<Shortcut, String> {
    raw.parse::<Shortcut>()
        .map_err(|_| format!("не понимаю сочетание «{raw}»"))
}

/// Строковое представление для интерфейса.
///
/// `Shortcut` печатает себя сам, но в виде, который человеку читать незачем.
/// Проще запомнить исходную строку — она и пришла от человека.
fn label(shortcut: &Shortcut) -> String {
    let mut parts = Vec::new();
    let modifiers = shortcut.mods;

    if modifiers.contains(Modifiers::CONTROL) {
        parts.push("Ctrl".to_string());
    }
    if modifiers.contains(Modifiers::SHIFT) {
        parts.push("Shift".to_string());
    }
    if modifiers.contains(Modifiers::ALT) {
        parts.push("Alt".to_string());
    }
    if modifiers.contains(Modifiers::SUPER) {
        parts.push("Super".to_string());
    }

    parts.push(pretty_key(shortcut.key));
    parts.join("+")
}

/// Человеческое имя клавиши.
///
/// `KeyB` и `Digit1` — это имена из спецификации, и на кнопке клавиатуры
/// написано не это. Показывать их значит заставлять человека переводить.
fn pretty_key(code: tauri_plugin_global_shortcut::Code) -> String {
    let raw = format!("{code:?}");

    if let Some(letter) = raw.strip_prefix("Key") {
        return letter.to_string();
    }
    if let Some(digit) = raw.strip_prefix("Digit") {
        return digit.to_string();
    }

    raw
}

impl HotkeyState {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            binds: Mutex::new(Binds {
                ptt: parse(DEFAULT_PTT)?,
                overlay: parse(DEFAULT_OVERLAY)?,
            }),
        })
    }
}

/// Что забиндено сейчас.
#[tauri::command]
pub fn hotkeys(state: State<'_, HotkeyState>) -> HotkeyLabels {
    let binds = state.binds.lock().expect("состояние клавиш повреждено");
    HotkeyLabels {
        ptt: label(&binds.ptt),
        overlay: label(&binds.overlay),
    }
}

/// Переназначить обе клавиши.
///
/// Обе сразу, а не по одной: проверка «рация и панель не совпадают» имеет смысл
/// только когда известны оба значения. Меняем всё или ничего — половинчатое
/// состояние здесь хуже отказа.
#[tauri::command]
pub fn set_hotkeys<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, HotkeyState>,
    ptt: String,
    overlay: String,
) -> Result<HotkeyLabels, String> {
    let next_ptt = parse(&ptt)?;
    let next_overlay = parse(&overlay)?;

    if next_ptt == next_overlay {
        return Err("рация и панель не могут висеть на одной клавише".into());
    }

    let mut binds = state.binds.lock().expect("состояние клавиш повреждено");

    // Старые снимаем до того, как ставить новые: иначе попытка занять ту же
    // клавишу под другое действие упрётся сама в себя.
    let _ = app.global_shortcut().unregister(binds.ptt);
    let _ = app.global_shortcut().unregister(binds.overlay);

    let taken = |shortcut: Shortcut| -> Result<(), String> {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|_| format!("«{}» уже занята другой программой", label(&shortcut)))
    };

    if let Err(problem) = taken(next_ptt).and_then(|()| taken(next_overlay)) {
        /*
          Не смогли — возвращаем как было.

          Оставить человека вообще без рации, потому что он выбрал занятую
          клавишу, было бы худшим исходом: он-то менял её ради удобства, а
          получил бы неработающее приложение.
        */
        let _ = app.global_shortcut().unregister(next_ptt);
        let _ = app.global_shortcut().unregister(next_overlay);
        let _ = app.global_shortcut().register(binds.ptt);
        let _ = app.global_shortcut().register(binds.overlay);
        return Err(problem);
    }

    binds.ptt = next_ptt;
    binds.overlay = next_overlay;

    Ok(HotkeyLabels {
        ptt: label(&binds.ptt),
        overlay: label(&binds.overlay),
    })
}

/// Занять клавиши по умолчанию при запуске.
///
/// Отказ — не повод не стартовать: канал работает и без рации, просто без неё.
/// А вот молчать нельзя, иначе человек будет жать клавишу и не понимать, почему
/// ничего не происходит, — поэтому пишем в журнал.
pub fn register_defaults<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<HotkeyState>();
    let binds = state.binds.lock().expect("состояние клавиш повреждено");

    for (what, shortcut) in [("рацию", binds.ptt), ("панель", binds.overlay)] {
        if let Err(error) = app.global_shortcut().register(shortcut) {
            log::warn!(
                "не удалось занять {} под {what}: {error}",
                label(&shortcut)
            );
        }
    }
}
