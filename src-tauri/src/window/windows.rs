//! Native DWM caption controls; no HTML replicas. All callbacks stay on the window thread.
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Dwm::{DwmDefWindowProc, DwmExtendFrameIntoClientArea},
    UI::{
        Controls::MARGINS,
        HiDpi::GetDpiForWindow,
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            GetWindowRect, IsZoomed, SetWindowPos, HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT,
            HTCAPTION, HTCLIENT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT, SWP_FRAMECHANGED,
            SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WM_NCCALCSIZE, WM_NCDESTROY, WM_NCHITTEST,
        },
    },
};
const SUBCLASS_ID: usize = 0x564f5649;

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0 as HWND;
    // SAFETY: hwnd is owned by Tauri, valid for this callback, and called on its UI thread.
    unsafe {
        if SetWindowSubclass(hwnd, Some(frame_proc), SUBCLASS_ID, 0) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let caption_height = (48.0 * f64::from(GetDpiForWindow(hwnd)) / 96.0).round() as i32;
        let margins = MARGINS {
            cxLeftWidth: 0,
            cxRightWidth: 0,
            cyTopHeight: caption_height,
            cyBottomHeight: 0,
        };
        let result = DwmExtendFrameIntoClientArea(hwnd, &margins);
        if result < 0 {
            RemoveWindowSubclass(hwnd, Some(frame_proc), SUBCLASS_ID);
            return Err(std::io::Error::other("DWM frame initialization failed").into());
        }
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        );
    }
    Ok(())
}

unsafe extern "system" fn frame_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    // Never unwind across this FFI boundary. No allocations, Rust callbacks, or retained pointers.
    let mut result = 0;
    if DwmDefWindowProc(hwnd, message, wparam, lparam, &mut result) != 0 {
        return result;
    }
    match message {
        WM_NCCALCSIZE if wparam != 0 => 0,
        WM_NCHITTEST => {
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect) == 0 {
                return DefSubclassProc(hwnd, message, wparam, lparam);
            }
            let x = (lparam as u16 as i16) as i32 - rect.left;
            let y = ((lparam >> 16) as u16 as i16) as i32 - rect.top;
            let scale = f64::from(GetDpiForWindow(hwnd)) / 96.0;
            let caption_height = (48.0 * scale).round() as i32;
            let caption_width = (160.0 * scale).round() as i32;
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            // DWM normally handles the caption buttons. Leave their entire region to User32.
            if y < caption_height && x > width - caption_width {
                return DefSubclassProc(hwnd, message, wparam, lparam);
            }
            let border = if IsZoomed(hwnd) != 0 {
                0
            } else {
                (8.0 * scale).round() as i32
            };
            let left = x < border;
            let right = x >= width - border;
            let top = y < border;
            let bottom = y >= height - border;
            match (left, right, top, bottom) {
                (true, _, true, _) => HTTOPLEFT as LRESULT,
                (_, true, true, _) => HTTOPRIGHT as LRESULT,
                (true, _, _, true) => HTBOTTOMLEFT as LRESULT,
                (_, true, _, true) => HTBOTTOMRIGHT as LRESULT,
                (true, _, _, _) => HTLEFT as LRESULT,
                (_, true, _, _) => HTRIGHT as LRESULT,
                (_, _, true, _) => HTTOP as LRESULT,
                (_, _, _, true) => HTBOTTOM as LRESULT,
                _ if y < caption_height => HTCAPTION as LRESULT,
                _ => HTCLIENT as LRESULT,
            }
        }
        WM_NCDESTROY => {
            RemoveWindowSubclass(hwnd, Some(frame_proc), SUBCLASS_ID);
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
        _ => DefSubclassProc(hwnd, message, wparam, lparam),
    }
}
