use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const MAIN_LABEL: &str = "main";
pub const PRESENTATION_LABEL: &str = "presentation";

pub fn create_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let builder = WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
        // Let the PDF drop zone receive files through the DOM DataTransfer API.
        .disable_drag_drop_handler()
        .title("Vovis")
        .inner_size(1440.0, 940.0)
        .min_inner_size(1000.0, 680.0)
        .center()
        .transparent(false)
        // Windows adds a white border to undecorated windows when shadow is enabled.
        .shadow(!cfg!(target_os = "windows"))
        .visible(false);
    let window = platform_controls(builder)?.build()?;
    let app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            app.exit(0);
        }
    });
    window.show()?;
    Ok(window)
}

fn platform_controls(
    builder: WebviewWindowBuilder<'_, tauri::Wry, AppHandle>,
) -> tauri::Result<WebviewWindowBuilder<'_, tauri::Wry, AppHandle>> {
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        // Let AppKit lay out the standard buttons when the window changes screens.
        .hidden_title(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);
    Ok(builder)
}

pub fn open_presentation(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(PRESENTATION_LABEL) {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        PRESENTATION_LABEL,
        WebviewUrl::App("index.html?view=presentation".into()),
    )
    .title("Vovis · 演示窗口")
    .inner_size(1280.0, 720.0)
    .build()?;
    Ok(())
}
