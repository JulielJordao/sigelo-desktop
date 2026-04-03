use std::fs;
use std::path::Path;
use std::process::Command; // Adicione isso no topo do arquivo junto com os outros 'use'

#[tauri::command]
pub fn open_folder_native(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// Comando para calcular o tamanho de um diretório recursivamente
#[tauri::command]
pub fn get_dir_size(path: String) -> Result<u64, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Ok(0);
    }

    let mut size = 0;
    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let metadata = entry.metadata().map_err(|e| e.to_string())?;

            if metadata.is_dir() {
                // Chamada recursiva para subpastas
                size += get_dir_size(entry.path().to_string_lossy().into_owned())?;
            } else {
                size += metadata.len();
            }
        }
    }
    Ok(size)
}

// Comando para limpar o cache (apaga o conteúdo da pasta)
#[tauri::command]
pub fn clear_directory(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if path.exists() && path.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                fs::remove_dir_all(path).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
