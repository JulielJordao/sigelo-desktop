import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { hostname } from '@tauri-apps/plugin-os';
import { invoke } from "@tauri-apps/api/core"
import { useConnectionStore } from '../stores/statusConnectionStore';

// Interfaces básicas para tipagem
interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: any;
  status?: number;
  fields?: string[];
  filename?: string;
  [key: string]: any;
}

// 1. Configurações de URL
//const isDev = import.meta.env.DEV;
//const url_base = "http://localhost:3000/" 
//const url_base = isDev   ? "http://localhost:3000/"   : "https://meu-app-backend-f9867824586e.herokuapp.com/";
const url_base = "https://meu-app-backend-f9867824586e.herokuapp.com/"

const baseUrl = `${url_base}api/`;

// ═════════════════════════════════════════════════════════════════════════
// SESSÃO (sem depender de cookies)
//  - accessToken (15 min) vai no cabeçalho Authorization de toda chamada;
//  - refreshToken (90 dias sem uso) renova pelo corpo de /api/auth/refresh;
//  - quem entrou numa versão anterior (só o token antigo) é migrado com
//    /api/auth/exchange, sem novo login.
// O `fetch` abaixo envolve o do plugin-http: todas as chamadas deste
// arquivo passam por ele.
// ═════════════════════════════════════════════════════════════════════════
const ACCESS_KEY = "sigelo.accessToken";
const REFRESH_KEY = "sigelo.refreshToken";
const LEGACY_KEY = "userToken";

const readLS = (key: string) => {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
};
const writeLS = (key: string, value: string) => {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* ignora */ }
};

const getAccessToken = () => readLS(ACCESS_KEY) || readLS(LEGACY_KEY);

/** Guarda os tokens do login/renovação. `userToken` segue preenchido (o resto do app usa). */
export const saveTokens = (data: any) => {
  if (!data) return;
  if (data.accessToken) {
    writeLS(ACCESS_KEY, data.accessToken);
    writeLS(LEGACY_KEY, data.accessToken);
  } else if (data.token) {
    writeLS(LEGACY_KEY, data.token);
  }
  if (data.refreshToken) writeLS(REFRESH_KEY, data.refreshToken);
};

export const clearTokens = () => {
  writeLS(ACCESS_KEY, "");
  writeLS(REFRESH_KEY, "");
  writeLS(LEGACY_KEY, "");
};

/** Evento disparado quando o servidor recusa a sessão (MainLayout volta ao login). */
export const SESSION_EXPIRED_EVENT = "sigelo:session-expired";

/** O servidor encerrou a sessão (sair pelo site, 90 dias sem uso, conta desativada…). */
const endSession = () => {
  const hadSession = !!(readLS(REFRESH_KEY) || readLS(LEGACY_KEY));
  clearTokens();
  if (hadSession) {
    try { window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)); } catch { /* ignora */ }
  }
};

let cachedDeviceName: string | null = null;
const clientInfo = async () => {
  if (cachedDeviceName === null) {
    try { cachedDeviceName = (await hostname()) || ""; } catch { cachedDeviceName = ""; }
  }
  return { client: "desktop", deviceName: cachedDeviceName ? `Sigelo Projeção (${cachedDeviceName})` : "Sigelo Projeção" };
};

/** Troca o token de login (antigo ou do Google) pelos tokens da sessão. */
export const exchangeLegacyToken = async (token?: string): Promise<boolean> => {
  const legacy = token || readLS(LEGACY_KEY);
  if (!legacy) return false;
  try {
    const res = await tauriFetch(`${baseUrl}auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${legacy}` },
      body: JSON.stringify(await clientInfo()),
    });
    if (!res.ok) {
      // Token antigo recusado (encerrado em outro aparelho ou após a data limite).
      if (res.status === 401 && !token) endSession();
      return false;
    }
    saveTokens(await res.json());
    return true;
  } catch {
    return false;
  }
};

/** Migra quem só tem o token antigo (entrou antes desta versão). */
export const migrateLegacySession = async (): Promise<boolean> => {
  if (readLS(REFRESH_KEY) || !readLS(LEGACY_KEY)) return false;
  return exchangeLegacyToken();
};

let refreshing: Promise<boolean> | null = null;

/** Renova o token de acesso (uma renovação por vez). false = sessão encerrada. */
export const refreshSession = (): Promise<boolean> => {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = readLS(REFRESH_KEY);
    if (!refreshToken) return await migrateLegacySession();
    try {
      const res = await tauriFetch(`${baseUrl}auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken, ...(await clientInfo()) }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) endSession();
        return false;
      }
      saveTokens(await res.json());
      return true;
    } catch {
      return false; // sem rede: mantém os tokens
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
};

const AUTH_SKIP = ["api/auth/refresh", "api/auth/exchange", "api/login", "api/logout"];

/** 401 de permissão (não é sessão vencida): não tenta renovar. */
const isPermission401 = async (res: Response) => {
  try {
    const data = await res.clone().json();
    const msg = String(data?.msg || data?.error || "").toLowerCase();
    return /permiss|não autorizado|nao autorizado/.test(msg) && !/autenticad/.test(msg);
  } catch {
    return false;
  }
};

/** fetch do plugin-http com o token da sessão e renovação automática no 401. */
const fetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
  const url = String(input);
  if (!url.startsWith(url_base) || AUTH_SKIP.some((path) => url.startsWith(url_base + path))) {
    return tauriFetch(url, init);
  }
  const withToken = (): RequestInit => {
    const headers = new Headers(init.headers || {});
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers };
  };

  const response = await tauriFetch(url, withToken());
  if (response.status !== 401 || (await isPermission401(response))) return response;
  if (!(await refreshSession())) return response;
  return tauriFetch(url, withToken());
};

const safeFetch = async (url: string, options: RequestInit): Promise<Response> => {
  const connectionStore = useConnectionStore();

  try {
    const response = await fetch(url, options);

    // SUCESSO! Chegamos no servidor. A rede está viva.
    if (!connectionStore.hasInternet || !connectionStore.isNetworkConnected) {
      connectionStore.hasInternet = true;
      connectionStore.isNetworkConnected = true;
    }

    // Se a API responder com erro (ex: 400, 404, 500), nós passamos isso para a frente
    if (!response.ok) {
      throw response;
    }

    return response;

  } catch (error) {
    // 1. Verificamos se foi um erro da API (O throw response que fizemos acima)
    if (error instanceof Response) {
      throw error; // A internet funcionou, foi só um erro do servidor. Deixa passar.
    }

    // 2. SE NÃO FOI UMA RESPONSE, É QUEDA DE REDE (cabo puxado, Wi-Fi desligado, etc).
    console.warn("safeFetch: A requisição não conseguiu sair do computador.", error);

    // Derruba a interface IMEDIATAMENTE (fica vermelho)
    connectionStore.forceOffline();

    // Dispara uma verificação em background. 
    // Se a internet não caiu (foi só a API local que desligou), a barra volta ao normal sozinha.
    connectionStore.validateConnection();

    throw new Error("NETWORK_ERROR");
  }
};

// 2. Helpers de Utilitários
const getLinkFiles = (filename: string): string => {
  const ext = filename.split('.')[1] + '/';
  return `https://storage.googleapis.com/my-app-storage-sigelo/${ext}${filename}`;
};

const deleteEmptyFields = (form: any, fields: string[]): any => {
  const object = { ...form };
  fields.forEach(field => {
    if (object[field] === "") {
      delete object[field];
    }
  });
  return object;
};

const getToken = (): string  => {
  return getAccessToken();
};

const getDefaultHeaders = (): HeadersInit => {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  return headers;
};

const withAuth = (useToken: string): RequestInit => {
  return useToken.length < 1 ? { credentials: "include" as RequestCredentials } : {};
};

// 3. Tratamento de Erros e Validação
const getValidateMessage = async (response: any, status: number): Promise<ApiResponse> => {
  let data: any;
  try {
    data = await response.json();
  } catch {
    data = { error: { name: "UnknownError" } };
  }

  if (data.error?.name === "ValidationError") {
    data.fields = Object.keys(data.error.errors);
  } else {
    data.fields = [];
  }
  data.status = status;
  return data;
};

export const getData = async <T = any>(url: string, useToken: string, body: any = null): Promise<T> => {
  const method = body ? "POST" : "GET";

  const response = await safeFetch(url, {
    method,
    headers: getDefaultHeaders(),
    ...withAuth(useToken),
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  
  return await response.json();
};

export const deleteData = async (url: string, useToken: string): Promise<Response> => {
  const response = await safeFetch(url, {
    method: "DELETE",
    headers: getDefaultHeaders(),
    ...withAuth(useToken)
  });
  
  return response; // DELETE geralmente não retorna JSON, então devolvemos o response puro
};

export const createData = async <T = any>(url: string, useToken: string, body: any): Promise<T> => {
  const response = await safeFetch(url, {
    method: "POST",
    headers: getDefaultHeaders(),
    ...withAuth(useToken),
    body: JSON.stringify(body)
  });
  
  return await response.json();
};

export const updateData = async <T = any>(url: string, useToken: string, body: any): Promise<T> => {
  const response = await safeFetch(url, {
    method: "PUT",
    headers: getDefaultHeaders(),
    ...withAuth(useToken),
    body: JSON.stringify(body)
  });
  
  return await response.json();
};

// 5. Exportação dos Módulos
export const api = {
  defaultUrl: url_base,
  files: () => {
    const url = `${baseUrl}songFile/`;
    const updateUrl = `${baseUrl}files/`;

    const create = async (data: any) => {
      const token = getToken();
      return createData(`${url}create`, token, deleteEmptyFields(data, ["tone"]));
    };

    const upload = async (data: File): Promise<any> => {
      const formData = new FormData();
      formData.append("file", data);
      try {
        const response = await fetch(`${updateUrl}upload`, {
          method: "POST",
          headers: { Authorization: getToken() || "" },
          credentials: "include",
          body: formData
        });
        if (!response.ok) throw response;
        return await response.json();
      } catch (error: any) {
        alert(`Erro ao enviar arquivo: ${error.message}`);
        return error;
      } 
    };

    const uploadListFiles = async (data: any[]) => {
      const successFilesIndex: number[] = [];

      for (let i = 0; i < data.length; i++) {
        const formData = new FormData();
        formData.append("file", data[i].file);
        try {
          const response = await fetch(`${updateUrl}upload`, {
            method: "POST",
            headers: { Authorization: getToken() || "" },
            credentials: "include",
            body: formData
          });
          
          if (response.ok) {
            const body = await response.json();
            data[i].fileName = body.filename;
            await create(data[i]);
            successFilesIndex.push(i);
          } else {
            throw response;
          }

          if (successFilesIndex.length === data.length) return { ok: true };
        } catch (error: any) {
          return await getValidateMessage(error, error.status);
        }
      }
    };

    return {
      upload,
      uploadListFiles,
      create,
      update: (data: any) => updateData(`${url}update`, getToken(), data),
      deleteFile: async (id: string) => {
        const response = await deleteData(`${url}delete/${id}`, getToken());
        return response.json();
      },
      getListBySongId: (songId: string[]) => getData(`${url}getListBySongId`, getToken(), {songId}),
      showFile: (fileName: string) => ({ sendUrl: getLinkFiles(fileName) }),
      generate: async (data: any) => {
        const response = await fetch(`${url}generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...withAuth(""),
          body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error("Erro na requisição");
        return response.blob();
      }
    };
  },

  user: () => {
    const url = `${baseUrl}user/`;
    return {
      // Exige login no servidor: usa apiFetch (cookie + renova a sessão no 401).
      getUserById: async (userId: string) => {
        const response = await api.apiFetch('user/getUserById', {
          method: 'POST',
          body: JSON.stringify({ id: userId }),
        });
        if (!response.ok) throw new Error(`Falha ao buscar usuário: ${response.status}`);
        return response.json();
      },
      create: (data: any) => createData(`${url}create`, "", data),
      update: (data: any) => updateData(`${url}update`, getToken(), data),
      getList: () => getData(`${url}list`, getToken()),
      getUserByToken: async () => {
        const response = await fetch(`${url_base}api/me`, { ...withAuth("") });
        if (!response.ok) throw new Error('Usuário não autenticado');
        return response.json();
      },
      login: async(email: string, password: string) => {
          let msgError = ''

            try {
                const body = {
                email: email,
                password: password,
                ...(await clientInfo())
            }
                const response = await fetch(url_base + 'api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                credentials: 'include'
            
            });

            const data = await response.json();

            if (response.status != 200) {
                msgError = data.msg ? data.msg : '';
                throw new Error('Login failed');
            }

            saveTokens(data); // accessToken + refreshToken (sessão)

            return { success: true, msg: "" }
        } catch (err: any) {
             return { success: false, msg: 'Login falhou. Verifique os dados e tente novamente.' + msgError }
        }
      },
      // Encerra a sessão deste computador no servidor e apaga os tokens.
      logout: async () => {
        const refreshToken = readLS(REFRESH_KEY);
        const access = getAccessToken();
        try {
          const response = await tauriFetch(`${url_base}api/logout`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(access ? { Authorization: `Bearer ${access}` } : {}),
            },
            body: JSON.stringify(refreshToken ? { refreshToken } : {}),
          });
          return await response.json();
        } finally {
          clearTokens();
        }
      }
    };
  },

  songGroup: () => {
    const url = baseUrl + "songGroup/";

    const get = async() => getData(`${url}list`, getToken())

    const getOfflineLyrics = async(id: string) => {
      try {
        const lyrics = await invoke("get_offline_lyrics_safe", { groupId: id })
        return lyrics
      } catch (err) {
        return {}
      }
    }

    return {
        get,
        getOfflineLyrics
    }
  },
  song: () => {
    const url = baseUrl + "song/";

    const list = async (songGroupId: string, songsUpdatedAt: string | Date | undefined) => {
      try {
        const data = await getData(`${url}listOptimezed`, getToken(), {songGroupId, songsUpdatedAt})

        return data
      } catch (err) {
        console.log("error", err)
        return {search: [], error: true}
      }
    }

    const getByListId = async(listId: string | string[]) => getData(`${url}getSongById`, getToken(), listId)  
    

    return {
        list,
        getByListId
    }
  },

  bibleApi: async (book: string, chapter: number, rangeParam: string) => {
    const response = await safeFetch(`${baseUrl}bible/${book}/${chapter}/${rangeParam}`, {
      method: 'GET',
      headers: getDefaultHeaders()
    });
    if (!response.ok) throw new Error(`Erro na API: ${response.status}`);
    return response.json();
  },

  settings: () => {
    const url = baseUrl + "settings/";

    async function get() {
      const token = getToken();
      const response = await getData(url + "get", token);
      return response;
    }

    return{
        get
    }
  },

  apiFetch: async (url: string, options: RequestInit = {}) => {
    // A renovação da sessão (401 → refresh) é feita pelo `fetch` deste arquivo.
    const response = await fetch(baseUrl + url, {
      ...options,
      headers: { ...getDefaultHeaders(), ...options.headers },
    });

    if (response.status === 401) throw new Error('Sessão expirada');
    return response;
  },

  proxy: async(url: string) => {
    let response = await fetch(url_base + "proxy?url=" + url, {
      headers: { ...getDefaultHeaders()},
      ...withAuth("")
    });
    return response.json();
  },

  event: () => {
    const url = baseUrl + "event/";

    const list = async() => getData(`${url}list`, getToken())

    return {
        list
    }
  }
};

export default api;