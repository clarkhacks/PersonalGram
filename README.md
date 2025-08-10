# PersonalGram
A CloudFlare Wrangler personal photo blog with Instagram-like features.

## Features

- **Photo Upload & Management**: Upload photos with descriptions and tags
- **Dual Image Storage**: Automatic thumbnail generation with thumbhash placeholders
- **Timeline Display**: Photos displayed in reverse chronological order
- **Search & Filter**: Search by tags, descriptions, or dates
- **Infinite Scroll**: Seamless photo browsing experience
- **Admin Interface**: Secure admin panel for photo management
- **Lazy Loading**: Optimized image loading with lazysizes
- **Responsive Design**: Built with Tailwind CSS

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Storage**: 
  - R2 for photo storage (original + thumbnails)
  - KV for metadata and admin credentials
- **Frontend**: Vanilla JavaScript with Tailwind CSS
- **Image Processing**: Canvas API with thumbhash for placeholders
- **Authentication**: Encrypted admin credentials with session management

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Build CSS**
   ```bash
   npm run build:css
   ```

3. **Configure Wrangler**
   - Update `wrangler.toml` with your R2 bucket and KV namespace IDs
   - Set your CDN_URL in the vars section

4. **Deploy**
   ```bash
   npm run deploy
   ```

5. **Initial Setup**
   - Visit `/admin/setup` to create your admin account
   - Login at `/admin/login` to access the admin panel

## Development

```bash
# Start development server
npm run start

# Build CSS (watch mode)
npm run build:css:watch

# Deploy to Cloudflare
npm run deploy
```

## API Endpoints

### Public
- `GET /api/photos` - Get photos with pagination and search
- `GET /` - Main photo timeline
- `GET /admin/setup` - Admin account setup (if no admin exists)

### Admin Only
- `POST /api/auth/login` - Admin login
- `POST /api/auth/logout` - Admin logout
- `POST /api/photos/upload` - Upload new photo
- `DELETE /api/photos/:id` - Delete photo
- `GET /admin` - Admin dashboard

## Configuration

The application uses the following Cloudflare services:

- **R2 Bucket**: For storing original photos and thumbnails
- **KV Namespace**: For metadata, admin credentials, and sessions
- **Workers**: For the main application logic

Make sure to configure these in your `wrangler.toml` file.

## Security

- Admin credentials are encrypted using bcrypt
- Session-based authentication with secure cookies
- CORS headers configured for API access
- Input validation and sanitization

## Image Processing

- Automatic thumbnail generation (max 400px width)
- Thumbhash generation for blur placeholders
- Lazy loading with smooth transitions
- Support for JPEG, PNG, and other common formats

## License

MIT License - see LICENSE file for details.
