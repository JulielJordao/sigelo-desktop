fn main() {
    // 1. Avisa ao Cargo para recompilar se o .env for alterado
    println!("cargo:rerun-if-changed=../.env");
    
    // 2. Lê o arquivo .env e repassa as variáveis para o compilador (rustc)
    if let Ok(iter) = dotenvy::from_path_iter("../.env") {
        for item in iter {
            if let Ok((key, val)) = item {
                // ESTA É A LINHA MÁGICA: Ela cria a ponte para o option_env!
                println!("cargo:rustc-env={}={}", key, val);
            }
        }
    }
    tauri_build::build()
}
