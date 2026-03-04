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
const isDev = import.meta.env.DEV;
const url_base = isDev 
  ? "http://localhost:3000/" 
  : "https://meu-app-backend-f9867824586e.herokuapp.com/";

const baseUrl = `${url_base}api/`;
const publicUrl = `${url_base}public/`;

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

const getToken = (): string | null => {
  return localStorage.getItem("userToken");
};

const getDefaultHeaders = (): HeadersInit => {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  return headers;
};

const withAuth = (useToken: boolean): RequestInit => {
  return useToken ? { credentials: "include" as RequestCredentials } : {};
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
const getData = async <T = any>(url: string, useToken = false, body: any = null): Promise<T> => {
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

const deleteData = async (url: string, useToken = false): Promise<Response> => {
  const response = await fetch(url, {
    method: "DELETE",
    headers: getDefaultHeaders(),
    ...withAuth(useToken)
  });
  if (!response.ok) throw response;
  return response;
};

const createData = async <T = any>(url: string, useToken = false, body: any): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: getDefaultHeaders(),
    ...withAuth(useToken),
    body: JSON.stringify(body)
  });
  if (!response.ok) throw response;
  return await response.json();
};

const updateData = async <T = any>(url: string, useToken = false, body: any): Promise<T> => {
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
      const token = !!getToken();
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
      update: (data: any) => updateData(`${url}update`, !!getToken(), data),
      deleteFile: async (id: string) => {
        const response = await deleteData(`${url}delete/${id}`, !!getToken());
        return response.json();
      },
      getListBySongId: (data: any) => getData(`${url}getListBySongId`, !!getToken(), data),
      showFile: (fileName: string) => ({ sendUrl: getLinkFiles(fileName) }),
      generate: async (data: any) => {
        const response = await fetch(`${url}generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...withAuth(true),
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
      create: (data: any) => createData(`${url}create`, false, data),
      update: (data: any) => updateData(`${url}update`, !!getToken(), data),
      getList: () => getData(`${url}list`, !!getToken()),
      getUserByToken: async () => {
        const response = await fetch(`${url_base}api/me`, { ...withAuth(true) });
        if (!response.ok) throw new Error('Usuário não autenticado');
        return response.json();
      },
      logout: async () => {
        const response = await fetch(`${url_base}api/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        return response.json();
      }
      // ... Adicione as outras funções seguindo o padrão createData/getData
    };
  },

  bibleApi: async (book: string, chapter: number, rangeParam: string) => {
    const response = await fetch(`${baseUrl}bible/${book}/${chapter}/${rangeParam}`);
    if (!response.ok) throw new Error(`Erro na API: ${response.status}`);
    return response.json();
  },

  apiFetch: async (url: string, options: RequestInit = {}) => {
    let response = await fetch(baseUrl + url, {
      ...options,
      headers: { ...getDefaultHeaders(), ...options.headers },
      ...withAuth(true)
    });

    if (response.status === 401) {
      const refresh = await fetch(`${baseUrl}auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!refresh.ok) throw new Error('Sessão expirada');
      return fetch(baseUrl + url, { ...options, credentials: 'include' });
    }
    return response;
  }
};

export default api;