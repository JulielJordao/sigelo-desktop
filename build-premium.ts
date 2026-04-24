import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, appendFileSync } from 'fs'; // Adicionado appendFileSync
import { join, relative, dirname } from 'path';
import { $ } from "bun"; // Adicionado import do Bun para comandos Shell

const KEY = process.env.PRIVATE_KEY;
const SOURCE_DIR = './src/premium-modules';
const OUTPUT_ENC = './src-tauri/src/premium-bundle.dat';
const LOG_FILE = './.premium-build-history';

// ==========================================
// FUNÇÕES UTILITÁRIAS
// ==========================================

function recordLog(action: string, fileCount: number) {
    const now = new Date().toLocaleString('pt-BR');
    const logEntry = `[${now}] ${action}: ${fileCount} arquivos processados\n`;
    appendFileSync(LOG_FILE, logEntry);
}

async function internalGitCommit(message: string) {
    try {
        if (!existsSync(join(SOURCE_DIR, '.git'))) {
            console.log("🌱 Inicializando Git interno para módulos premium...");
            await $`git init`.cwd(SOURCE_DIR);
        }

        const status = await $`git status --porcelain`.cwd(SOURCE_DIR).text();
        
        if (status.trim().length > 0) {
            console.log("📝 Registrando alterações no histórico interno...");
            await $`git add .`.cwd(SOURCE_DIR);
            await $`git commit -m "${message}"`.cwd(SOURCE_DIR);
        }
    } catch (e) {
        console.error("⚠️ Aviso: Não foi possível atualizar o histórico Git interno.");
    }
}

// ==========================================
// 0. INICIALIZAÇÃO E RESTAURAÇÃO INTELIGENTE
// ==========================================

if (!existsSync(SOURCE_DIR)) mkdirSync(SOURCE_DIR, { recursive: true });

if (existsSync(OUTPUT_ENC) && KEY?.length === 32) {
    try {
        const encryptedBuffer = readFileSync(OUTPUT_ENC);
        if (encryptedBuffer.length > 28) {
            const iv = encryptedBuffer.subarray(0, 12);
            const authTag = encryptedBuffer.subarray(encryptedBuffer.length - 16);
            const encryptedData = encryptedBuffer.subarray(12, encryptedBuffer.length - 16);

            const decipher = createDecipheriv('aes-256-gcm', Buffer.from(KEY), iv);
            decipher.setAuthTag(authTag);

            const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
            const vfs: Record<string, string> = JSON.parse(decrypted.toString());

            let restoredCount = 0;
            for (const [path, content] of Object.entries(vfs)) {
                const fullPath = join(SOURCE_DIR, path);
                if (!existsSync(fullPath)) {
                    mkdirSync(dirname(fullPath), { recursive: true });
                    writeFileSync(fullPath, content);
                    console.log(`   ✅ Restaurado: ${path}`);
                    restoredCount++;
                }
            }

            if (restoredCount > 0) {
                console.log(`✨ ${restoredCount} arquivos premium foram restaurados.`);
                recordLog("Restauração (Restore)", restoredCount);
            }
        }
    } catch (e) {
        console.log("ℹ️ Nota: Payload premium detectado, mas a chave é inválida ou ausente. Ignorando restauração.");
    }
}

// Lista arquivos APÓS a tentativa de restauração
const allFiles = getAllFiles(SOURCE_DIR);

// ==========================================
// 1. LÓGICA DE CACHE (TIMESTAMP)
// ==========================================

if (allFiles.length > 0 && existsSync(OUTPUT_ENC)) {
    let latestSourceTime = 0;
    for (const file of allFiles) {
        latestSourceTime = Math.max(latestSourceTime, statSync(file).mtimeMs);
    }

    if (statSync(OUTPUT_ENC).mtimeMs >= latestSourceTime) {
        console.log("⚡ Cache hit: Tudo atualizado.");
        process.exit(0);
    }
}

// ==========================================
// 2. SEGURANÇA CONTRA SOBRESCRITA ACIDENTAL
// ==========================================

if (allFiles.length <= 1 && existsSync(OUTPUT_ENC) && statSync(OUTPUT_ENC).size > 100) {
     console.log("⚠️ Pasta premium incompleta, mas payload existente é válido. Protegendo .dat contra sobrescrita.");
     process.exit(0);
}

if (allFiles.length === 0) {
    if (!existsSync(OUTPUT_ENC)) writeFileSync(OUTPUT_ENC, Buffer.alloc(0));
    process.exit(0);
}

if (!KEY || KEY.length !== 32) {
    console.error("❌ ERRO FATAL: PRIVATE_KEY necessária para processar arquivos na pasta.");
    process.exit(1);
}

// ==========================================
// 3. SINCRONIZAÇÃO (DISK -> .DAT)
// ==========================================

console.log("⏳ Sincronizando alterações para o pacote .dat...");
const vfs: Record<string, string> = {};
for (const file of allFiles) {
    const relativePath = relative(SOURCE_DIR, file).replace(/\\/g, '/');
    vfs[relativePath] = readFileSync(file, 'utf-8');
}

const jsonBuffer = Buffer.from(JSON.stringify(vfs));
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', Buffer.from(KEY), iv);
const encrypted = Buffer.concat([cipher.update(jsonBuffer), cipher.final()]);

writeFileSync(OUTPUT_ENC, Buffer.concat([iv, encrypted, cipher.getAuthTag()]));

// AÇÕES FINAIS
await internalGitCommit(`Build auto-commit: ${new Date().toLocaleString('pt-BR')}`);
recordLog("Sincronização (Build)", allFiles.length); // Movido para cá para ter acesso ao allFiles

console.log(`🔒 Sucesso: ${allFiles.length} arquivos sincronizados no .dat.`);

// ==========================================
// FUNÇÃO DE LISTAGEM
// ==========================================

function getAllFiles(dir: string, fileList: string[] = []): string[] {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir);
    for (const file of files) {
        const filepath = join(dir, file);
        
        // Ignora README, lixo de sistema e a pasta do Git interno
        if (file === 'README.md' || file === '.git' || file === '.DS_Store') continue;

        if (statSync(filepath).isDirectory()) {
            getAllFiles(filepath, fileList);
        } else {
            fileList.push(filepath);
        }
    }
    return fileList;
}