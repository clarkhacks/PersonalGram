import { Env } from './types';
import { AuthManager, PhotoManager, getCookie, setCookie } from './utils';

// Add ExecutionContext type
declare global {
  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const authManager = new AuthManager(env);
    const photoManager = new PhotoManager(env);

    try {
      // Static file serving
      if (path.startsWith('/static/') || path === '/favicon.ico') {
        return env.STATIC.fetch(request);
      }

      // API Routes
      if (path.startsWith('/api/')) {
        const response = await handleApiRequest(request, env, authManager, photoManager);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
        return response;
      }

      // Admin routes
      if (path.startsWith('/admin')) {
        return handleAdminRoute(request, env, authManager);
      }

      // Main application routes
      return handleAppRoute(request, env);

    } catch (error) {
      console.error('Error handling request:', error);
      return new Response('Internal Server Error', { 
        status: 500,
        headers: corsHeaders
      });
    }
  },
};

async function handleApiRequest(
  request: Request,
  env: Env,
  authManager: AuthManager,
  photoManager: PhotoManager
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Authentication endpoints
  if (path === '/api/auth/login' && method === 'POST') {
    const { email, password } = await request.json();
    
    if (await authManager.authenticateAdmin(email, password)) {
      const sessionId = await authManager.createSession(email);
      const response = new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
      response.headers.set('Set-Cookie', setCookie('session', sessionId, 86400)); // 24 hours
      return response;
    }
    
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const sessionId = getCookie(request, 'session');
    if (sessionId) {
      await authManager.deleteSession(sessionId);
    }
    
    const response = new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
    response.headers.set('Set-Cookie', setCookie('session', '', 0));
    return response;
  }

  // Initialize admin (only if no admin exists)
  if (path === '/api/auth/init' && method === 'POST') {
    const existingCredentials = await env.KV.get('admin:credentials');
    if (existingCredentials) {
      return new Response(JSON.stringify({ error: 'Admin already exists' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { email, password } = await request.json();
    await authManager.initializeAdmin(email, password);
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Protected routes - require authentication
  const sessionId = getCookie(request, 'session');
  const session = sessionId ? await authManager.validateSession(sessionId) : null;

  // Public photo endpoints
  if (path === '/api/photos' && method === 'GET') {
    const cursor = url.searchParams.get('cursor') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const query = url.searchParams.get('q') || undefined;
    const tags = url.searchParams.get('tags')?.split(',').filter(Boolean) || undefined;

    let result;
    if (query || tags) {
      const photos = await photoManager.searchPhotos(query || '', tags, limit);
      result = { photos, hasMore: false };
    } else {
      result = await photoManager.getPhotos(cursor, limit);
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Admin-only endpoints
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (path === '/api/photos/upload' && method === 'POST') {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const description = formData.get('description') as string || '';
    const tagsString = formData.get('tags') as string || '';
    const tags = tagsString.split(',').map(tag => tag.trim()).filter(Boolean);

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const fileBuffer = await file.arrayBuffer();
    const photo = await photoManager.uploadPhoto(
      fileBuffer,
      file.name,
      description,
      tags,
      file.type
    );

    return new Response(JSON.stringify(photo), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (path.startsWith('/api/photos/') && method === 'DELETE') {
    const photoId = path.split('/').pop();
    if (!photoId) {
      return new Response(JSON.stringify({ error: 'Invalid photo ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await photoManager.deletePhoto(photoId);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response('Not Found', { status: 404 });
}

async function handleAdminRoute(request: Request, env: Env, authManager: AuthManager): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Check if admin is initialized
  const existingCredentials = await env.KV.get('admin:credentials');
  
  if (!existingCredentials && path !== '/admin/setup') {
    return new Response(getSetupPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  if (path === '/admin/setup') {
    return new Response(getSetupPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // Check authentication for other admin routes
  const sessionId = getCookie(request, 'session');
  const session = sessionId ? await authManager.validateSession(sessionId) : null;

  if (!session && path !== '/admin/login') {
    return new Response(getLoginPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  if (path === '/admin/login') {
    return new Response(getLoginPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  if (path === '/admin' || path === '/admin/') {
    return new Response(getAdminPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  return new Response('Not Found', { status: 404 });
}

async function handleAppRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Main application
  if (path === '/' || path === '/photos' || path.startsWith('/photo/')) {
    return new Response(getMainPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  return new Response('Not Found', { status: 404 });
}

function getMainPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PersonalGram</title>
    <link href="/static/styles.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/lazysizes@5.3.2/lazysizes.min.js" async></script>
</head>
<body class="bg-gray-50 min-h-screen">
    <div id="app">
        <header class="bg-white shadow-sm border-b">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between items-center py-4">
                    <h1 class="text-2xl font-bold text-gray-900">PersonalGram</h1>
                    <div class="flex items-center space-x-4">
                        <input 
                            type="text" 
                            id="searchInput" 
                            placeholder="Search photos..." 
                            class="input-field w-64"
                        >
                        <button id="searchBtn" class="btn-primary">Search</button>
                    </div>
                </div>
            </div>
        </header>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div id="photoGrid" class="photo-grid">
                <!-- Photos will be loaded here -->
            </div>
            
            <div id="loading" class="text-center py-8 hidden">
                <div class="loading-skeleton h-64 w-full rounded-lg"></div>
            </div>
            
            <div id="loadMore" class="text-center py-8 hidden">
                <button class="btn-primary">Load More Photos</button>
            </div>
        </main>
    </div>

    <!-- Photo Modal -->
    <div id="photoModal" class="fixed inset-0 bg-black bg-opacity-75 modal-overlay hidden z-50">
        <div class="flex items-center justify-center min-h-screen p-4">
            <div class="bg-white rounded-lg max-w-4xl w-full photo-modal">
                <div class="p-4">
                    <div class="flex justify-between items-start mb-4">
                        <h3 id="modalTitle" class="text-lg font-semibold"></h3>
                        <button id="closeModal" class="text-gray-500 hover:text-gray-700">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="text-center">
                        <img id="modalImage" class="max-w-full max-h-96 mx-auto rounded-lg" alt="">
                    </div>
                    <div class="mt-4">
                        <p id="modalDescription" class="text-gray-700 mb-2"></p>
                        <div id="modalTags" class="flex flex-wrap gap-1"></div>
                        <p id="modalDate" class="text-sm text-gray-500 mt-2"></p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        class PhotoApp {
            constructor() {
                this.photos = [];
                this.nextCursor = null;
                this.hasMore = true;
                this.loading = false;
                this.searchQuery = '';
                
                this.initializeElements();
                this.bindEvents();
                this.loadPhotos();
            }

            initializeElements() {
                this.photoGrid = document.getElementById('photoGrid');
                this.loadingEl = document.getElementById('loading');
                this.loadMoreEl = document.getElementById('loadMore');
                this.searchInput = document.getElementById('searchInput');
                this.searchBtn = document.getElementById('searchBtn');
                this.modal = document.getElementById('photoModal');
                this.modalImage = document.getElementById('modalImage');
                this.modalTitle = document.getElementById('modalTitle');
                this.modalDescription = document.getElementById('modalDescription');
                this.modalTags = document.getElementById('modalTags');
                this.modalDate = document.getElementById('modalDate');
                this.closeModal = document.getElementById('closeModal');
            }

            bindEvents() {
                this.searchBtn.addEventListener('click', () => this.search());
                this.searchInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') this.search();
                });
                
                this.loadMoreEl.addEventListener('click', () => this.loadPhotos());
                this.closeModal.addEventListener('click', () => this.hideModal());
                this.modal.addEventListener('click', (e) => {
                    if (e.target === this.modal) this.hideModal();
                });

                // Infinite scroll
                window.addEventListener('scroll', () => {
                    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1000) {
                        if (this.hasMore && !this.loading) {
                            this.loadPhotos();
                        }
                    }
                });
            }

            async loadPhotos() {
                if (this.loading || !this.hasMore) return;
                
                this.loading = true;
                this.showLoading();

                try {
                    const params = new URLSearchParams();
                    if (this.nextCursor) params.append('cursor', this.nextCursor);
                    if (this.searchQuery) params.append('q', this.searchQuery);
                    
                    const response = await fetch(\`/api/photos?\${params}\`);
                    const data = await response.json();
                    
                    if (this.searchQuery || !this.nextCursor) {
                        this.photos = data.photos;
                        this.photoGrid.innerHTML = '';
                    } else {
                        this.photos.push(...data.photos);
                    }
                    
                    this.nextCursor = data.nextCursor;
                    this.hasMore = data.hasMore;
                    
                    this.renderPhotos(data.photos);
                } catch (error) {
                    console.error('Error loading photos:', error);
                } finally {
                    this.loading = false;
                    this.hideLoading();
                }
            }

            renderPhotos(photos) {
                photos.forEach(photo => {
                    const photoEl = this.createPhotoElement(photo);
                    this.photoGrid.appendChild(photoEl);
                });
            }

            createPhotoElement(photo) {
                const div = document.createElement('div');
                div.className = 'photo-item aspect-square group';
                div.innerHTML = \`
                    <img 
                        class="lazyload w-full h-full object-cover"
                        data-src="\${photo.thumbnailUrl}"
                        src="data:image/svg+xml;base64,\${this.createPlaceholder(photo.thumbhash)}"
                        alt="\${photo.description}"
                    >
                    <div class="photo-overlay">
                        <div class="photo-info">
                            <p class="text-sm font-medium truncate">\${photo.description}</p>
                            <div class="flex flex-wrap gap-1 mt-1">
                                \${photo.tags.map(tag => \`<span class="tag text-xs">\${tag}</span>\`).join('')}
                            </div>
                        </div>
                    </div>
                \`;
                
                div.addEventListener('click', () => this.showModal(photo));
                return div;
            }

            createPlaceholder(thumbhash) {
                // Simple placeholder - in production you'd use the actual thumbhash
                return btoa('<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f3f4f6"/></svg>');
            }

            showModal(photo) {
                this.modalImage.src = photo.originalUrl;
                this.modalTitle.textContent = photo.filename;
                this.modalDescription.textContent = photo.description;
                this.modalTags.innerHTML = photo.tags.map(tag => 
                    \`<span class="tag">\${tag}</span>\`
                ).join('');
                this.modalDate.textContent = new Date(photo.uploadedAt).toLocaleDateString();
                this.modal.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
            }

            hideModal() {
                this.modal.classList.add('hidden');
                document.body.style.overflow = 'auto';
            }

            search() {
                this.searchQuery = this.searchInput.value.trim();
                this.nextCursor = null;
                this.hasMore = true;
                this.loadPhotos();
            }

            showLoading() {
                this.loadingEl.classList.remove('hidden');
                this.loadMoreEl.classList.add('hidden');
            }

            hideLoading() {
                this.loadingEl.classList.add('hidden');
                if (this.hasMore) {
                    this.loadMoreEl.classList.remove('hidden');
                }
            }
        }

        // Initialize app when DOM is loaded
        document.addEventListener('DOMContentLoaded', () => {
            new PhotoApp();
        });
    </script>
</body>
</html>`;
}

function getAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - PersonalGram</title>
    <link href="/static/styles.css" rel="stylesheet">
</head>
<body class="bg-gray-50 min-h-screen">
    <div class="max-w-4xl mx-auto px-4 py-8">
        <div class="flex justify-between items-center mb-8">
            <h1 class="text-3xl font-bold text-gray-900">Admin Panel</h1>
            <div class="space-x-4">
                <a href="/" class="btn-secondary">View Site</a>
                <button id="logoutBtn" class="btn-secondary">Logout</button>
            </div>
        </div>

        <!-- Upload Form -->
        <div class="card mb-8">
            <div class="p-6">
                <h2 class="text-xl font-semibold mb-4">Upload Photo</h2>
                <form id="uploadForm" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Photo</label>
                        <input type="file" id="photoFile" accept="image/*" required class="input-field">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Description</label>
                        <textarea id="description" rows="3" class="input-field" placeholder="Enter photo description..."></textarea>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Tags</label>
                        <input type="text" id="tags" class="input-field" placeholder="Enter tags separated by commas...">
                    </div>
                    <button type="submit" class="btn-primary">Upload Photo</button>
                </form>
            </div>
        </div>

        <!-- Upload Progress -->
        <div id="uploadProgress" class="card mb-8 hidden">
            <div class="p-6">
                <div class="flex items-center">
                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
                    <span>Uploading photo...</span>
                </div>
            </div>
        </div>

        <!-- Recent Photos -->
        <div class="card">
            <div class="p-6">
                <h2 class="text-xl font-semibold mb-4">Recent Photos</h2>
                <div id="recentPhotos" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <!-- Photos will be loaded here -->
                </div>
            </div>
        </div>
    </div>

    <script>
        class AdminApp {
            constructor() {
                this.initializeElements();
                this.bindEvents();
                this.loadRecentPhotos();
            }

            initializeElements() {
                this.uploadForm = document.getElementById('uploadForm');
                this.photoFile = document.getElementById('photoFile');
                this.description = document.getElementById('description');
                this.tags = document.getElementById('tags');
                this.uploadProgress = document.getElementById('uploadProgress');
                this.recentPhotos = document.getElementById('recentPhotos');
                this.logoutBtn = document.getElementById('logoutBtn');
            }

            bindEvents() {
                this.uploadForm.addEventListener('submit', (e) => this.handleUpload(e));
                this.logoutBtn.addEventListener('click', () => this.logout());
            }

            async handleUpload(e) {
                e.preventDefault();
                
                const file = this.photoFile.files[0];
                if (!file) return;

                this.showUploadProgress();

                const formData = new FormData();
                formData.append('file', file);
                formData.append('description', this.description.value);
                formData.append('tags', this.tags.value);

                try {
                    const response = await fetch('/api/photos/upload', {
                        method: 'POST',
                        body: formData
                    });

                    if (response.ok) {
                        const photo = await response.json();
                        this.uploadForm.reset();
                        this.loadRecentPhotos();
                        alert('Photo uploaded successfully!');
                    } else {
                        const error = await response.json();
                        alert('Upload failed: ' + error.error);
                    }
                } catch (error) {
                    console.error('Upload error:', error);
                    alert('Upload failed: ' + error.message);
                } finally {
                    this.hideUploadProgress();
                }
            }

            async loadRecentPhotos() {
                try {
                    const response = await fetch('/api/photos?limit=12');
                    const data = await response.json();
                    this.renderRecentPhotos(data.photos);
                } catch (error) {
                    console.error('Error loading photos:', error);
                }
            }

            renderRecentPhotos(photos) {
                this.recentPhotos.innerHTML = photos.map(photo => \`
                    <div class="relative group">
                        <img src="\${photo.thumbnailUrl}" alt="\${photo.description}" 
                             class="w-full h-32 object-cover rounded-lg">
                        <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 
                                    transition-all duration-200 rounded-lg flex items-center justify-center">
                            <button onclick="adminApp.deletePhoto('\${photo.id}')" 
                                    class="hidden group-hover:block bg-red-600 text-white px-3 py-1 rounded text-sm">
                                Delete
                            </button>
                        </div>
                        <p class="text-xs text-gray-600 mt-1 truncate">\${photo.description}</p>
                    </div>
                \`).join('');
            }

            async deletePhoto(photoId) {
                if (!confirm('Are you sure you want to delete this photo?')) return;

                try {
                    const response = await fetch(\`/api/photos/\${photoId}\`, {
                        method: 'DELETE'
                    });

                    if (response.ok) {
                        this.loadRecentPhotos();
                        alert('Photo deleted successfully!');
                    } else {
                        alert('Failed to delete photo');
                    }
                } catch (error) {
                    console.error('Delete error:', error);
                    alert('Failed to delete photo');
                }
            }

            async logout() {
                try {
                    await fetch('/api/auth/logout', { method: 'POST' });
                    window.location.href = '/admin/login';
                } catch (error) {
                    console.error('Logout error:', error);
                }
            }

            showUploadProgress() {
                this.uploadProgress.classList.remove('hidden');
            }

            hideUploadProgress() {
                this.uploadProgress.classList.add('hidden');
            }
        }

        const adminApp = new AdminApp();
    </script>
</body>
</html>`;
}

function getLoginPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Login - PersonalGram</title>
    <link href="/static/styles.css" rel="stylesheet">
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
    <div class="max-w-md w-full">
        <div class="card">
            <div class="p-8">
                <h2 class="text-2xl font-bold text-center text-gray-900 mb-8">Admin Login</h2>
                <form id="loginForm" class="space-y-6">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input type="email" id="email" required class="input-field">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Password</label>
                        <input type="password" id="password" required class="input-field">
                    </div>
                    <button type="submit" class="btn-primary w-full">Login</button>
                </form>
                <div class="mt-4 text-center">
                    <a href="/" class="text-sm text-blue-600 hover:text-blue-500">← Back to Site</a>
                </div>
            </div>
        </div>
    </div>

    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                
                if (response.ok) {
                    window.location.href = '/admin';
                } else {
                    const error = await response.json();
                    alert('Login failed: ' + error.error);
                }
            } catch (error) {
                console.error('Login error:', error);
                alert('Login failed: ' + error.message);
            }
        });
    </script>
</body>
</html>`;
}

function getSetupPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup Admin - PersonalGram</title>
    <link href="/static/styles.css" rel="stylesheet">
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
    <div class="max-w-md w-full">
        <div class="card">
            <div class="p-8">
                <h2 class="text-2xl font-bold text-center text-gray-900 mb-8">Setup Admin Account</h2>
                <form id="setupForm" class="space-y-6">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input type="email" id="email" required class="input-field">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Password</label>
                        <input type="password" id="password" required class="input-field" minlength="8">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
                        <input type="password" id="confirmPassword" required class="input-field" minlength="8">
                    </div>
                    <button type="submit" class="btn-primary w-full">Create Admin Account</button>
                </form>
                <div class="mt-4 text-center">
                    <a href="/" class="text-sm text-blue-600 hover:text-blue-500">← Back to Site</a>
                </div>
            </div>
        </div>
    </div>

    <script>
        document.getElementById('setupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            if (password !== confirmPassword) {
                alert('Passwords do not match');
                return;
            }
            
            try {
                const response = await fetch('/api/auth/init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                
                if (response.ok) {
                    alert('Admin account created successfully!');
                    window.location.href = '/admin/login';
                } else {
                    const error = await response.json();
                    alert('Setup failed: ' + error.error);
                }
            } catch (error) {
                console.error('Setup error:', error);
                alert('Setup failed: ' + error.message);
            }
        });
    </script>
</body>
</html>`;
}
