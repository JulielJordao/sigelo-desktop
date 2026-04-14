/*use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

 
pub fn open_projection_window(app: &AppHandle) -> tauri::Result<()> {
    // pega os monitores disponíveis
    let monitors = app.available_monitors()?;

    if monitors.len() < 2 {
        println!("Apenas um monitor detectado");
        return Ok(());
    }

    // pega o segundo monitor
    let monitor = monitors.get(1).unwrap();

    // cria a janela de projeção
    let window =
        WebviewWindowBuilder::new(app, "projection", WebviewUrl::App("projection.html".into()))
            .decorations(false)
            .build()?;

    // move a janela para a segunda tela
    window.set_position(tauri::Position::Physical(*monitor.position()))?;

    // pega resolução do monitor
    let size = *monitor.size();

    window.set_size(tauri::Size::Physical(size))?;

    // fullscreen
    window.set_fullscreen(true)?;

    Ok(())
}
*/