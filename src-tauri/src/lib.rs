mod commands;
mod error;
mod feishu_meeting;
mod project_archive;
mod providers;
mod storage;
mod window;

use serde_json::Value;
use std::sync::Mutex;
use storage::Repository;
use tauri::Manager;

pub(crate) struct Presentation(pub Mutex<Option<Value>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            app.manage(Repository::open(
                app.path().app_data_dir()?,
                app.path().app_config_dir()?,
            )?);
            app.manage(commands::SpeechJobs::default());
            app.manage(feishu_meeting::FeishuUser::default());
            app.manage(feishu_meeting::FeishuReads::default());
            app.manage(Presentation(Mutex::new(None)));
            window::create_main(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project_archive::save_project_package,
            project_archive::remove_imported_pdf,
            commands::complete_text,
            commands::start_speech,
            commands::cancel_speech,
            commands::transcribe_audio,
            commands::create_custom_voice,
            commands::test_feishu_credentials,
            feishu_meeting::read_feishu_chat,
            feishu_meeting::feishu_user_login,
            feishu_meeting::check_feishu_meeting_permission,
            feishu_meeting::feishu_user_logout,
            feishu_meeting::feishu_active_meetings,
            feishu_meeting::feishu_meeting_events,
            feishu_meeting::cancel_feishu_read,
            commands::load_workspace,
            commands::save_workspace,
            commands::save_pdf,
            commands::save_session_video,
            commands::load_pdf,
            commands::save_credential,
            commands::has_credential,
            commands::open_presentation,
            commands::update_presentation,
            commands::get_presentation
        ])
        .run(tauri::generate_context!())
        .expect("Vovis desktop runtime failed");
}
