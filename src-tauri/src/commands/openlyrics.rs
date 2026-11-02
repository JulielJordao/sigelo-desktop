use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
pub struct OpenLyricsFile {
    pub name: String,
    pub xml: String,
}

/// Abre um seletor de arquivos .xml (OpenLyrics), lê cada um e devolve
/// o nome e o conteúdo bruto para o front-end parsear.
#[tauri::command]
pub async fn pick_openlyrics_files(
    app: tauri::AppHandle,
) -> Result<Vec<OpenLyricsFile>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("OpenLyrics", &["xml"])
        .blocking_pick_files();

    // Usuário cancelou o diálogo: retorna lista vazia (não é erro).
    let Some(files) = picked else {
        return Ok(Vec::new());
    };

    let mut out = Vec::with_capacity(files.len());
    for f in files {
        let path = f.into_path().map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        match std::fs::read_to_string(&path) {
            Ok(xml) => out.push(OpenLyricsFile { name, xml }),
            // Um arquivo ilegível não derruba o lote inteiro: ignora e segue.
            Err(_) => continue,
        }
    }
    Ok(out)
}
