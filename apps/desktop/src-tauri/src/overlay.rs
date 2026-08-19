use std::sync::Mutex;

use tauri::{
    LogicalSize, LogicalUnit, PhysicalPosition, PhysicalSize, PixelUnit, Runtime, State,
    WebviewWindow, WindowSizeConstraints,
};

/// Размер панели.
///
/// Ширины хватает на ряд участников и читаемую строку переписки, высоты — на
/// десяток сообщений. Больше делать нельзя: панель закрывает собой игру.
const PANEL_WIDTH: f64 = 340.0;
const PANEL_HEIGHT: f64 = 420.0;

/// Отступ от края экрана, чтобы панель не липла к нему вплотную.
const MARGIN: i32 = 24;

/// Нижняя граница обычного окна.
///
/// Продублирована из `tauri.conf.json`: снятые ограничения надо чем-то
/// возвращать, а прочитать их у окна нельзя — геттера нет. Менять только вместе
/// с `minWidth` и `minHeight` в конфиге.
const MIN_WIDTH: f64 = 380.0;
const MIN_HEIGHT: f64 = 560.0;

/// Каким окно было до того, как стать панелью.
struct Normal {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    maximized: bool,
    /// Было ли окно на экране вообще. Свёрнутое в трей — нет.
    visible: bool,
    minimized: bool,
}

#[derive(Default)]
pub struct OverlayState {
    /// `Some` — сейчас панель. Заодно то, куда возвращаться.
    normal: Mutex<Option<Normal>>,
    /// Куда утащили саму панель. Чтобы в следующий раз открылась там же.
    panel: Mutex<Option<PhysicalPosition<i32>>>,
}

/// Правый верхний угол монитора, на котором окно сейчас.
///
/// Именно текущего, а не главного: с двумя мониторами игра и приложение
/// нередко на разных, и панель, уехавшая на соседний экран, бесполезна.
fn corner<R: Runtime>(window: &WebviewWindow<R>, panel: PhysicalSize<u32>) -> Option<PhysicalPosition<i32>> {
    let monitor = window.current_monitor().ok().flatten()?;
    let area = monitor.size();
    let origin = monitor.position();

    Some(PhysicalPosition::new(
        origin.x + area.width as i32 - panel.width as i32 - MARGIN,
        origin.y + MARGIN,
    ))
}

/// Превратить окно в панель поверх остальных или вернуть обратно.
///
/// Вся геометрия живёт здесь, а не на странице: во-первых, это единственное
/// место, где она вообще доступна, во-вторых, так невозможно состояние «окно
/// ужато, а панель не показана».
#[tauri::command]
pub fn set_overlay<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, OverlayState>,
    on: bool,
) -> Result<(), String> {
    let mut normal = state.normal.lock().expect("состояние окна повреждено");

    if on {
        // Уже панель — второй раз ужимать нечего, а перезаписав сохранённое,
        // мы потеряли бы размеры обычного окна навсегда.
        if normal.is_some() {
            return Ok(());
        }

        /*
          Откуда мы поднимаем окно.

          Панель зовут во время игры, а тогда окно почти наверняка не на экране:
          свёрнуто на панель задач или спрятано в трей, потому что крестик его
          прячет. Оба состояния надо запомнить, чтобы вернуть их при выходе, и
          оба надо снять — иначе вся работа ниже происходит с невидимым окном.
        */
        let visible = window.is_visible().unwrap_or(true);
        let minimized = window.is_minimized().unwrap_or(false);

        /*
          Свёрнутое окно разворачиваем спрятанным.

          Во-первых, у свёрнутого окна нельзя спросить размер и положение —
          система отдаёт значения-заглушки, и возвращаться потом было бы некуда.
          Во-вторых, разверни мы его на виду, поверх игры мигнуло бы окно во весь
          экран — как раз то, от чего панель и избавляет.
        */
        if minimized {
            let _ = window.hide();
            window.unminimize().map_err(|e| e.to_string())?;
        }

        let maximized = window.is_maximized().unwrap_or(false);

        // Развёрнутое окно отдаёт размер во весь экран, и возвращать его потом
        // некуда. Схлопываем до восстановления и запоминаем сам факт.
        if maximized {
            window.unmaximize().map_err(|e| e.to_string())?;
        }

        *normal = Some(Normal {
            position: window.outer_position().map_err(|e| e.to_string())?,
            size: window.outer_size().map_err(|e| e.to_string())?,
            maximized,
            visible,
            minimized,
        });

        // Ограничения снимаем первыми: с minWidth 380 окно просто не согласится
        // стать уже, и панель молча осталась бы прежнего размера.
        window
            .set_size_constraints(WindowSizeConstraints::default())
            .map_err(|e| e.to_string())?;

        window.set_resizable(false).map_err(|e| e.to_string())?;
        window.set_decorations(false).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        // Панель — это состояние приложения, а не второе окно; отдельная кнопка
        // в панели задач сбивала бы с толку.
        let _ = window.set_skip_taskbar(true);

        window
            .set_size(LogicalSize::new(PANEL_WIDTH, PANEL_HEIGHT))
            .map_err(|e| e.to_string())?;

        /*
          Место панели считаем после установки размера.

          Физический размер зависит от масштабирования экрана, и вычислять его
          из логического вручную значит повторять работу системы — и ошибиться
          там, где масштаб дробный.
        */
        let panel_size = window.outer_size().map_err(|e| e.to_string())?;
        let saved = *state.panel.lock().expect("состояние панели повреждено");

        if let Some(place) = saved.or_else(|| corner(&window, panel_size)) {
            window.set_position(place).map_err(|e| e.to_string())?;
        }

        /*
          И только теперь — на экран.

          Показываем последними, когда окно уже панель нужного размера и на своём
          месте: покажи мы раньше, поверх игры проехало бы полноразмерное окно.

          Фокус берём намеренно. Панель зовут, чтобы что-то сделать — написать,
          замьютиться, — а без фокуса клавиши продолжают уходить в игру, и первым
          движением пришлось бы кликать по панели. Отпускаем фокус обратно при
          выходе: там окно уходит с экрана, и система возвращает его игре.
        */
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();

        return Ok(());
    }

    let Some(previous) = normal.take() else {
        // Не были панелью — возвращать нечего.
        return Ok(());
    };

    // Запоминаем, куда панель утащили: в следующий раз откроется там же.
    if let Ok(place) = window.outer_position() {
        *state.panel.lock().expect("состояние панели повреждено") = Some(place);
    }

    /*
      Прячем до возврата геометрии, а не после.

      Окно уходит обратно в трей — значит на экране ему делать нечего уже сейчас,
      и растянуть его до прежнего размера на виду значило бы показать игроку то
      самое большое окно, от которого он вторым нажатием и уходит.
    */
    if !previous.visible {
        let _ = window.hide();
    }

    let _ = window.set_skip_taskbar(false);
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_decorations(true).map_err(|e| e.to_string())?;
    window.set_resizable(true).map_err(|e| e.to_string())?;

    window
        .set_size_constraints(WindowSizeConstraints {
            min_width: Some(PixelUnit::Logical(LogicalUnit::new(MIN_WIDTH))),
            min_height: Some(PixelUnit::Logical(LogicalUnit::new(MIN_HEIGHT))),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    window.set_size(previous.size).map_err(|e| e.to_string())?;
    window
        .set_position(previous.position)
        .map_err(|e| e.to_string())?;

    if previous.maximized {
        window.maximize().map_err(|e| e.to_string())?;
    }

    // Свернуть — последним действием: до этого окну нужны настоящие размер и
    // место, иначе восстанавливать его потом будет не во что.
    if previous.minimized {
        let _ = window.minimize();
    }

    Ok(())
}
