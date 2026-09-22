/**
 * @module map-engine/fonts
 * Loads web font faces into the document so a map SDK can rasterise label
 * glyphs with them.
 *
 * Map SDKs draw label text through the browser's canvas text API, which resolves
 * families against `document.fonts` — so a face has to be *loaded*, not merely
 * declared, before the first glyph atlas is built. A plain `@font-face` rule is
 * lazy (nothing in the DOM uses a map label family), hence this explicit pass.
 *
 * Domain-free: the caller supplies the faces. What is generic is the mechanics —
 * the `FontFace` API with a CSS `@font-face` fallback, de-duplication so a face
 * is fetched once however many overlays ask for it, and a result that says
 * which faces made it and which did not, so a caller can tell "styles ready"
 * from "fonts ready" instead of conflating the two.
 *
 * @example
 * ```ts
 * import { loadFontFaces } from '@vit-foundation/map/engine';
 *
 * const status = await loadFontFaces([
 * 	{ name: 'Caption Heavy', family: 'Caption', weight: 800, src: 'url(/fonts/caption-heavy.woff2) format("woff2")' }
 * ]);
 * if (status.failed.length) console.warn('missing faces', status.failed);
 * ```
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the FontFace API is injected for tests and typed loosely */

/** One loadable web font face. */
export interface FontFaceSpec {
	/**
	 * Identity used for de-duplication and status reporting — a family alone is
	 * not unique when Regular and Heavy share one.
	 */
	name: string;
	/** CSS `font-family` to register the face under. */
	family: string;
	/**
	 * `@font-face` `src` descriptor, e.g.
	 * `url(/fonts/x.woff2) format("woff2"), url(/fonts/x.woff) format("woff")`.
	 */
	src: string;
	/** CSS `font-weight` of this face (default `'normal'`). */
	weight?: string | number;
	/** CSS `font-style` of this face (default `'normal'`). */
	style?: string;
}

/** Which faces loaded and which did not. */
export interface FontFaceStatus {
	/** Names of the faces now in `document.fonts`. */
	loaded: string[];
	/** Faces that could not be loaded by either method, with the last error. */
	failed: { name: string; error: unknown }[];
}

/**
 * The browser surfaces the loader touches, injectable so the loader runs under
 * a unit test without a real `FontFace`.
 */
export interface FontFaceEnvironment {
	/** The `FontFace` constructor. */
	FontFace?: new (family: string, src: string, descriptors: Record<string, string>) => any;
	/** `document.fonts`. */
	fonts?: { add(face: any): unknown; load(spec: string): Promise<unknown> };
	/** The document a fallback `<style>` element is appended to. */
	document?: Pick<Document, 'createElement' | 'head'>;
}

/** Faces already loaded (or loading), keyed by face name — one fetch per face per page. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Loads every face, in parallel, de-duplicating against earlier calls. Never
 * rejects: a face that fails both methods is reported in `failed` and the rest
 * still load, because a label stack with one missing face is better than none.
 *
 * @param faces - The faces to load.
 * @param env - Browser surfaces; defaults to the page's own.
 * @returns Which faces loaded and which failed.
 */
export async function loadFontFaces(
	faces: readonly FontFaceSpec[],
	env: FontFaceEnvironment = {}
): Promise<FontFaceStatus> {
	const status: FontFaceStatus = { loaded: [], failed: [] };
	await Promise.all(
		faces.map(async (face) => {
			try {
				await loadOne(face, env);
				status.loaded.push(face.name);
			} catch (error) {
				status.failed.push({ name: face.name, error });
			}
		})
	);
	return status;
}

/**
 * Loads one face once. A failure is forgotten so a later call may retry.
 *
 * @param face - The face.
 * @param env - Browser surfaces.
 */
function loadOne(face: FontFaceSpec, env: FontFaceEnvironment): Promise<void> {
	const pending = inFlight.get(face.name);
	if (pending) return pending;
	const attempt = performLoad(face, env).catch((error) => {
		inFlight.delete(face.name);
		throw error;
	});
	inFlight.set(face.name, attempt);
	return attempt;
}

/**
 * The `FontFace` API first; a CSS `@font-face` rule plus an explicit
 * `document.fonts.load` as the fallback.
 *
 * @param face - The face.
 * @param env - Browser surfaces.
 */
async function performLoad(face: FontFaceSpec, env: FontFaceEnvironment): Promise<void> {
	const weight = String(face.weight ?? 'normal');
	const style = face.style ?? 'normal';
	const FontFaceCtor = env.FontFace ?? (globalThis as any).FontFace;
	const fonts = env.fonts ?? (globalThis as any).document?.fonts;

	if (FontFaceCtor && fonts) {
		try {
			const loaded = await new FontFaceCtor(face.family, face.src, { weight, style }).load();
			fonts.add(loaded);
			return;
		} catch {
			// Fall through to the CSS method below.
		}
	}

	const doc = env.document ?? (globalThis as any).document;
	if (!doc || !fonts) throw new Error(`No font loading API available for "${face.name}"`);

	const styleEl = doc.createElement('style');
	styleEl.textContent = `@font-face { font-family: '${face.family}'; src: ${face.src}; font-weight: ${weight}; font-style: ${style}; }`;
	doc.head.appendChild(styleEl);
	// A CSS-declared face is only fetched once something asks for it, so ask
	// explicitly and wait for the fetch.
	await fonts.load(`${style} ${weight} 16px "${face.family}"`);
}

/** Forgets every loaded face. Tests only — a page never needs to unload a font. */
export function resetFontFaceCache(): void {
	inFlight.clear();
}
