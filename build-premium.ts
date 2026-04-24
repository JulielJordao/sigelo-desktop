import { createCipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const KEY = process.env.PRIVATE_KEY;
const SOURCE_DIR = './src/premium-modules';
const OUTPUT_ENC = './src-tauri/src/premium-bundle.dat';

// Função para listar todos os arquivos recursivamente
function getAllFiles(dir: string, fileList: string[] = []): string[] {
    if (!existsSync(dir)) return fileList;
    const files = readdirSync(dir);
    for (const file of files) {
        const filepath = join(dir, file);
        if (statSync(filepath).isDirectory()) {
            getAllFiles(filepath, fileList);
        } else {
            fileList.push(filepath);
        }
    }
    return fileList;
}

// ==========================================
// 1. LÓGICA DE CACHE (TIMESTAMP)
// ==========================================

const allFiles = getAllFiles(SOURCE_DIR);

if (allFiles.length > 0) {
    // Descobre qual é o arquivo mais recente dentro da pasta premium
    let latestSourceTime = 0;
    for (const file of allFiles) {
        const mtime = statSync(file).mtimeMs;
        if (mtime > latestSourceTime) {
            latestSourceTime = mtime;
        }
    }

    // Verifica a data do arquivo criptografado existente
    let encTime = 0;
    if (existsSync(OUTPUT_ENC)) {
        encTime = statSync(OUTPUT_ENC).mtimeMs;
    }

    // Se o .enc for mais recente que o código fonte, não fazemos nada!
    if (encTime >= latestSourceTime) {
        console.log("⚡ Cache hit: Nenhum arquivo premium foi alterado. Pulando criptografia.");
        process.exit(0); // Sai do script com sucesso (código 0)
    }
}

// ==========================================
// 2. VERIFICAÇÃO DE SEGURANÇA
// ==========================================

if (!KEY || KEY.length !== 32) {
    console.error("❌ ERRO FATAL: PRIVATE_KEY de 32 bytes não encontrada.");
    process.exit(1);
}

if (!existsSync(SOURCE_DIR) || allFiles.length === 0) {
    console.warn("⚠️ AVISO: Pasta premium vazia ou não encontrada. Gerando payload vazio.");
    writeFileSync(OUTPUT_ENC, Buffer.alloc(0));
    process.exit(0);
}

// ==========================================
// 3. PROCESSO DE EMPACOTAMENTO E CRIPTOGRAFIA
// ==========================================

console.log("⏳ Arquivos alterados detectados. Gerando novo pacote criptografado...");

const virtualFileSystem: Record<string, string> = {};
for (const file of allFiles) {
    const relativePath = relative(SOURCE_DIR, file).replace(/\\/g, '/');
    virtualFileSystem[relativePath] = readFileSync(file, 'utf-8');
}

const jsonBuffer = Buffer.from(JSON.stringify(virtualFileSystem));
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', Buffer.from(KEY), iv);

let encrypted = Buffer.concat([cipher.update(jsonBuffer), cipher.final()]);
const authTag = cipher.getAuthTag();

writeFileSync(OUTPUT_ENC, Buffer.concat([iv, encrypted, authTag]));

console.log(`🔒 Sucesso: ${allFiles.length} arquivos empacotados em 'premium-bundle.dat'`);