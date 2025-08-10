// @ts-ignore - thumbhash types not available
// @ts-ignore - bcryptjs types not available
import bcrypt from 'bcryptjs';
import { Env, Photo, AuthSession, KV_KEYS } from './types';

export class ImageProcessor {
	static async createThumbnail(
		imageBuffer: ArrayBuffer,
		maxWidth: number = 400
	): Promise<{
		thumbnailBuffer: ArrayBuffer;
		thumbhash: string;
		metadata: { width: number; height: number };
	}> {
		// For now, we'll use the original image as thumbnail
		// In a production environment, you'd want to use a service like Cloudflare Images
		// or process images on the client side before upload

		// Generate a simple placeholder thumbhash
		const thumbhash = 'placeholder';

		// Estimate dimensions (in production, you'd extract this from image headers)
		const metadata = { width: 400, height: 300 };

		return {
			thumbnailBuffer: imageBuffer, // Use original for now
			thumbhash,
			metadata,
		};
	}

	static thumbhashToDataURL(thumbhash: string): string {
		// Return a simple gray placeholder since we're not using real thumbhash
		return (
			'data:image/svg+xml;base64,' +
			btoa(
				'<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f3f4f6"/></svg>'
			)
		);
	}
}

export class AuthManager {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	async hashPassword(password: string): Promise<string> {
		return bcrypt.hash(password, 10);
	}

	async verifyPassword(password: string, hash: string): Promise<boolean> {
		return bcrypt.compare(password, hash);
	}

	async initializeAdmin(email: string, password: string): Promise<void> {
		const hashedPassword = await this.hashPassword(password);
		const credentials = { email, password: hashedPassword };
		await this.env.KV.put(
			KV_KEYS.ADMIN_CREDENTIALS,
			JSON.stringify(credentials)
		);
	}

	async authenticateAdmin(email: string, password: string): Promise<boolean> {
		const credentialsJson = await this.env.KV.get(KV_KEYS.ADMIN_CREDENTIALS);
		if (!credentialsJson) return false;

		const credentials = JSON.parse(credentialsJson);
		return (
			credentials.email === email &&
			(await this.verifyPassword(password, credentials.password))
		);
	}

	async createSession(email: string): Promise<string> {
		const sessionId = crypto.randomUUID();
		const session: AuthSession = {
			email,
			expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
		};

		await this.env.KV.put(
			`${KV_KEYS.SESSION_PREFIX}${sessionId}`,
			JSON.stringify(session)
		);
		return sessionId;
	}

	async validateSession(sessionId: string): Promise<AuthSession | null> {
		const sessionJson = await this.env.KV.get(
			`${KV_KEYS.SESSION_PREFIX}${sessionId}`
		);
		if (!sessionJson) return null;

		const session: AuthSession = JSON.parse(sessionJson);
		if (session.expiresAt < Date.now()) {
			await this.env.KV.delete(`${KV_KEYS.SESSION_PREFIX}${sessionId}`);
			return null;
		}

		return session;
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.env.KV.delete(`${KV_KEYS.SESSION_PREFIX}${sessionId}`);
	}
}

export class PhotoManager {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	async uploadPhoto(
		file: ArrayBuffer,
		filename: string,
		description: string,
		tags: string[],
		mimeType: string
	): Promise<Photo> {
		const photoId = crypto.randomUUID();
		const timestamp = new Date().toISOString();

		// Process image and create thumbnail
		const { thumbnailBuffer, thumbhash, metadata } =
			await ImageProcessor.createThumbnail(file);

		// Upload original image to R2
		const originalKey = `photos/${photoId}/original.jpg`;
		await this.env.R2.put(originalKey, file, {
			httpMetadata: { contentType: mimeType },
		});

		// Upload thumbnail to R2
		const thumbnailKey = `photos/${photoId}/thumbnail.jpg`;
		await this.env.R2.put(thumbnailKey, thumbnailBuffer, {
			httpMetadata: { contentType: 'image/jpeg' },
		});

		// Create photo object
		const photo: Photo = {
			id: photoId,
			filename,
			originalUrl: `${this.env.CDN_URL}/${originalKey}`,
			thumbnailUrl: `${this.env.CDN_URL}/${thumbnailKey}`,
			thumbhash,
			description,
			tags,
			uploadedAt: timestamp,
			metadata: {
				width: metadata.width,
				height: metadata.height,
				size: file.byteLength,
				mimeType,
			},
		};

		// Store photo metadata in KV
		await this.env.KV.put(
			`${KV_KEYS.PHOTO_PREFIX}${photoId}`,
			JSON.stringify(photo)
		);

		// Update photo list
		await this.addToPhotoList(photoId, timestamp);

		return photo;
	}

	private async addToPhotoList(
		photoId: string,
		timestamp: string
	): Promise<void> {
		const listJson = await this.env.KV.get(KV_KEYS.PHOTO_LIST);
		const photoList: string[] = listJson ? JSON.parse(listJson) : [];

		// Add to beginning for reverse chronological order
		photoList.unshift(photoId);

		await this.env.KV.put(KV_KEYS.PHOTO_LIST, JSON.stringify(photoList));
	}

	async getPhotos(
		cursor?: string,
		limit: number = 20
	): Promise<{
		photos: Photo[];
		nextCursor?: string;
		hasMore: boolean;
	}> {
		const listJson = await this.env.KV.get(KV_KEYS.PHOTO_LIST);
		if (!listJson) return { photos: [], hasMore: false };

		const photoList: string[] = JSON.parse(listJson);

		// Find starting index
		let startIndex = 0;
		if (cursor) {
			const cursorIndex = photoList.indexOf(cursor);
			if (cursorIndex !== -1) {
				startIndex = cursorIndex + 1;
			}
		}

		// Get slice of photo IDs
		const endIndex = startIndex + limit;
		const photoIds = photoList.slice(startIndex, endIndex);

		// Fetch photo data
		const photos: Photo[] = [];
		for (const photoId of photoIds) {
			const photoJson = await this.env.KV.get(
				`${KV_KEYS.PHOTO_PREFIX}${photoId}`
			);
			if (photoJson) {
				photos.push(JSON.parse(photoJson));
			}
		}

		const hasMore = endIndex < photoList.length;
		const nextCursor = hasMore ? photoIds[photoIds.length - 1] : undefined;

		return { photos, nextCursor, hasMore };
	}

	async searchPhotos(
		query: string,
		tags?: string[],
		limit: number = 20
	): Promise<Photo[]> {
		const listJson = await this.env.KV.get(KV_KEYS.PHOTO_LIST);
		if (!listJson) return [];

		const photoList: string[] = JSON.parse(listJson);
		const photos: Photo[] = [];

		for (const photoId of photoList) {
			if (photos.length >= limit) break;

			const photoJson = await this.env.KV.get(
				`${KV_KEYS.PHOTO_PREFIX}${photoId}`
			);
			if (!photoJson) continue;

			const photo: Photo = JSON.parse(photoJson);

			// Check if photo matches search criteria
			const matchesQuery =
				!query ||
				photo.description.toLowerCase().includes(query.toLowerCase()) ||
				photo.tags.some((tag) =>
					tag.toLowerCase().includes(query.toLowerCase())
				);

			const matchesTags =
				!tags ||
				tags.length === 0 ||
				tags.some((tag) => photo.tags.includes(tag));

			if (matchesQuery && matchesTags) {
				photos.push(photo);
			}
		}

		return photos;
	}

	async deletePhoto(photoId: string): Promise<void> {
		// Delete from R2
		await this.env.R2.delete(`photos/${photoId}/original.jpg`);
		await this.env.R2.delete(`photos/${photoId}/thumbnail.jpg`);

		// Delete from KV
		await this.env.KV.delete(`${KV_KEYS.PHOTO_PREFIX}${photoId}`);

		// Remove from photo list
		const listJson = await this.env.KV.get(KV_KEYS.PHOTO_LIST);
		if (listJson) {
			const photoList: string[] = JSON.parse(listJson);
			const updatedList = photoList.filter((id) => id !== photoId);
			await this.env.KV.put(KV_KEYS.PHOTO_LIST, JSON.stringify(updatedList));
		}
	}
}

export function getCookie(request: Request, name: string): string | null {
	const cookieHeader = request.headers.get('Cookie');
	if (!cookieHeader) return null;

	const cookies = cookieHeader.split(';').map((c) => c.trim());
	const cookie = cookies.find((c) => c.startsWith(`${name}=`));

	return cookie ? cookie.substring(name.length + 1) : null;
}

export function setCookie(
	name: string,
	value: string,
	maxAge?: number
): string {
	let cookie = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict`;
	if (maxAge) {
		cookie += `; Max-Age=${maxAge}`;
	}
	return cookie;
}
