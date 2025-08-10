export interface Photo {
  id: string;
  filename: string;
  originalUrl: string;
  thumbnailUrl: string;
  thumbhash: string;
  description: string;
  tags: string[];
  uploadedAt: string;
  metadata: {
    width: number;
    height: number;
    size: number;
    mimeType: string;
  };
}

export interface PhotoUpload {
  file: File;
  description: string;
  tags: string[];
}

export interface AdminCredentials {
  email: string;
  password: string;
}

export interface SearchFilters {
  query?: string;
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginationParams {
  cursor?: string;
  limit: number;
}

export interface PhotosResponse {
  photos: Photo[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface Env {
  KV: KVNamespace;
  R2: R2Bucket;
  STATIC: Fetcher;
  CDN_URL: string;
}

// Cloudflare Workers types
declare global {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
      keys: { name: string }[];
      list_complete: boolean;
      cursor?: string;
    }>;
  }

  interface R2Bucket {
    put(key: string, value: ArrayBuffer | ReadableStream, options?: {
      httpMetadata?: { contentType?: string };
    }): Promise<R2Object>;
    get(key: string): Promise<R2Object | null>;
    delete(key: string): Promise<void>;
  }

  interface R2Object {
    key: string;
    size: number;
    etag: string;
    httpMetadata?: { contentType?: string };
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
  }

  interface Fetcher {
    fetch(request: Request): Promise<Response>;
  }
}

export interface AuthSession {
  email: string;
  expiresAt: number;
}

export interface KVKeys {
  ADMIN_CREDENTIALS: 'admin:credentials';
  PHOTO_PREFIX: 'photo:';
  PHOTO_LIST: 'photos:list';
  SESSION_PREFIX: 'session:';
}

export const KV_KEYS: KVKeys = {
  ADMIN_CREDENTIALS: 'admin:credentials',
  PHOTO_PREFIX: 'photo:',
  PHOTO_LIST: 'photos:list',
  SESSION_PREFIX: 'session:',
};
