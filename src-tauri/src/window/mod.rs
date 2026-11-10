#[cfg(target_os = "windows")]
mod windows;
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
        .transparent(!cfg!(target_os = "macos"))
        .shadow(true)
        .visible(false);
    let window = platform_controls(builder)?.build()?;
    #[cfg(target_os = "windows")]
    windows::install(&window)?;
    #[cfg(target_os = "linux")]
    linux_controls(&window)?;
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
    let builder = builder.decorations(true);
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

#[cfg(target_os = "linux")]
fn linux_controls(window: &WebviewWindow) -> tauri::Result<()> {
    use gtk::prelude::*;
    let native = window.gtk_window()?;
    let titlebar = gtk::HeaderBar::new();
    titlebar.set_show_close_button(true);
    titlebar.set_decoration_layout(Some(":minimize,maximize,close"));
    titlebar.set_title(Some("Vovis"));
    native.set_titlebar(Some(&titlebar));
    titlebar.show_all();
    Ok(())
}
