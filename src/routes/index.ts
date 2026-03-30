import { fetch } from '@tauri-apps/plugin-http';

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
const url_base = "http://localhost:3000/" 
// const url_base = isDev   ? "http://localhost:3000/"   : "https://meu-app-backend-f9867824586e.herokuapp.com/";

const baseUrl = `${url_base}api/`;

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
  return localStorage.getItem("userToken") ?? "";
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

// 4. Métodos Base de Requisicao (Generics)
const getData = async <T = any>(url: string, useToken : string, body: any = null): Promise<T> => {
  const method = body ? "POST" : "GET";
  const response = await fetch(url, {
    method,
    headers: getDefaultHeaders(),
    ...withAuth(useToken),
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (!response.ok) throw response;
  return await response.json();
};

const deleteData = async (url: string, useToken: string): Promise<Response> => {
  const response = await fetch(url, {
    
    method: "DELETE",
    headers: getDefaultHeaders(),
    ...withAuth(useToken)
  });
  if (!response.ok) throw response;
  return response;
};

const createData = async <T = any>(url: string, useToken: string, body: any): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: getDefaultHeaders(),
    ...withAuth(useToken),
    body: JSON.stringify(body)
  });
  if (!response.ok) throw response;
  return await response.json();
};

const updateData = async <T = any>(url: string, useToken: string, body: any): Promise<T> => {
  const response = await fetch(url, {
    method: "PUT",
    headers: getDefaultHeaders(),
    ...withAuth(useToken),
    body: JSON.stringify(body)
  });
  if (!response.ok) throw response;
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
      getListBySongId: (songId: string) => getData(`${url}getListBySongId`, getToken(), {songId}),
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
      getUserById: (userId: string) => getData(`${url}getUserById`, getToken(), {id: userId}),
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
                password: password
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

            localStorage.setItem('userToken', data.token);

            return { success: true, msg: "" }
        } catch (err: any) {
             return { success: false, msg: 'Login falhou. Verifique os dados e tente novamente.' + msgError }
        }
      },
      logout: async () => {
        const response = await fetch(`${url_base}api/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        return response.json();
      }
    };
  },

  songGroup: () => {
    const url = baseUrl + "songGroup/";

    const get = async() => getData(`${url}list`, getToken())

    return {
        get
    }
  },
  song: () => {
    const url = baseUrl + "song/";

    const list = async(songGroupId: string) => getData(`${url}listBySongGroup`, getToken(), {songGroupId})

    return {
        list
    }
  },

  bibleApi: async (book: string, chapter: number, rangeParam: string) => {
    const response = await fetch(`${baseUrl}bible/${book}/${chapter}/${rangeParam}`);
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
    let response = await fetch(baseUrl + url, {
      ...options,
      headers: { ...getDefaultHeaders(), ...options.headers },
      ...withAuth("")
    });

    if (response.status === 401) {
      const refresh = await fetch(`${baseUrl}auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!refresh.ok) throw new Error('Sessão expirada');
      return fetch(baseUrl + url, { ...options, credentials: 'include' });
    }
    return response;
  },

  proxy: async(url: string) => {
    let response = await fetch(url_base + "proxy?url=" + url, {
      headers: { ...getDefaultHeaders()},
      ...withAuth("")
    });
    return response.json();
  }
};

export default api;