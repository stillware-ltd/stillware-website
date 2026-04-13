declare module 'astro:content' {
	interface RenderResult {
		Content: import('astro/runtime/server/index.js').AstroComponentFactory;
		headings: import('astro').MarkdownHeading[];
		remarkPluginFrontmatter: Record<string, any>;
	}
	interface Render {
		'.md': Promise<RenderResult>;
	}

	export interface RenderedContent {
		html: string;
		metadata?: {
			imagePaths: Array<string>;
			[key: string]: unknown;
		};
	}
}

declare module 'astro:content' {
	type Flatten<T> = T extends { [K: string]: infer U } ? U : never;

	export type CollectionKey = keyof AnyEntryMap;
	export type CollectionEntry<C extends CollectionKey> = Flatten<AnyEntryMap[C]>;

	export type ContentCollectionKey = keyof ContentEntryMap;
	export type DataCollectionKey = keyof DataEntryMap;

	type AllValuesOf<T> = T extends any ? T[keyof T] : never;
	type ValidContentEntrySlug<C extends keyof ContentEntryMap> = AllValuesOf<
		ContentEntryMap[C]
	>['slug'];

	/** @deprecated Use `getEntry` instead. */
	export function getEntryBySlug<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		// Note that this has to accept a regular string too, for SSR
		entrySlug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;

	/** @deprecated Use `getEntry` instead. */
	export function getDataEntryById<C extends keyof DataEntryMap, E extends keyof DataEntryMap[C]>(
		collection: C,
		entryId: E,
	): Promise<CollectionEntry<C>>;

	export function getCollection<C extends keyof AnyEntryMap, E extends CollectionEntry<C>>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => entry is E,
	): Promise<E[]>;
	export function getCollection<C extends keyof AnyEntryMap>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => unknown,
	): Promise<CollectionEntry<C>[]>;

	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(entry: {
		collection: C;
		slug: E;
	}): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(entry: {
		collection: C;
		id: E;
	}): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		slug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		collection: C,
		id: E,
	): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;

	/** Resolve an array of entry references from the same collection */
	export function getEntries<C extends keyof ContentEntryMap>(
		entries: {
			collection: C;
			slug: ValidContentEntrySlug<C>;
		}[],
	): Promise<CollectionEntry<C>[]>;
	export function getEntries<C extends keyof DataEntryMap>(
		entries: {
			collection: C;
			id: keyof DataEntryMap[C];
		}[],
	): Promise<CollectionEntry<C>[]>;

	export function render<C extends keyof AnyEntryMap>(
		entry: AnyEntryMap[C][string],
	): Promise<RenderResult>;

	export function reference<C extends keyof AnyEntryMap>(
		collection: C,
	): import('astro/zod').ZodEffects<
		import('astro/zod').ZodString,
		C extends keyof ContentEntryMap
			? {
					collection: C;
					slug: ValidContentEntrySlug<C>;
				}
			: {
					collection: C;
					id: keyof DataEntryMap[C];
				}
	>;
	// Allow generic `string` to avoid excessive type errors in the config
	// if `dev` is not running to update as you edit.
	// Invalid collection names will be caught at build time.
	export function reference<C extends string>(
		collection: C,
	): import('astro/zod').ZodEffects<import('astro/zod').ZodString, never>;

	type ReturnTypeOrOriginal<T> = T extends (...args: any[]) => infer R ? R : T;
	type InferEntrySchema<C extends keyof AnyEntryMap> = import('astro/zod').infer<
		ReturnTypeOrOriginal<Required<ContentConfig['collections'][C]>['schema']>
	>;

	type ContentEntryMap = {
		"blog": {
"best-gamified-chore-trackers-for-kids.md": {
	id: "best-gamified-chore-trackers-for-kids.md";
  slug: "best-gamified-chore-trackers-for-kids";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-home-inventory-apps-for-insurance-claims.md": {
	id: "best-home-inventory-apps-for-insurance-claims.md";
  slug: "best-home-inventory-apps-for-insurance-claims";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-apps-for-kids-no-ads-2026.md": {
	id: "best-offline-apps-for-kids-no-ads-2026.md";
  slug: "best-offline-apps-for-kids-no-ads-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-apps-for-kids-no-ads.md": {
	id: "best-offline-apps-for-kids-no-ads.md";
  slug: "best-offline-apps-for-kids-no-ads";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-budget-app-for-windows.md": {
	id: "best-offline-budget-app-for-windows.md";
  slug: "best-offline-budget-app-for-windows";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-chess-app-for-kids-2026.md": {
	id: "best-offline-chess-app-for-kids-2026.md";
  slug: "best-offline-chess-app-for-kids-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-chess-app-for-kids.md": {
	id: "best-offline-chess-app-for-kids.md";
  slug: "best-offline-chess-app-for-kids";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-chess-puzzles-for-kids.md": {
	id: "best-offline-chess-puzzles-for-kids.md";
  slug: "best-offline-chess-puzzles-for-kids";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-hiking-map-app-compared.md": {
	id: "best-offline-hiking-map-app-compared.md";
  slug: "best-offline-hiking-map-app-compared";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-hiking-map-app-no-subscription-compared.md": {
	id: "best-offline-hiking-map-app-no-subscription-compared.md";
  slug: "best-offline-hiking-map-app-no-subscription-compared";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-hiking-map-app-no-subscription.md": {
	id: "best-offline-hiking-map-app-no-subscription.md";
  slug: "best-offline-hiking-map-app-no-subscription";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-medication-tracker-apps-for-seniors.md": {
	id: "best-offline-medication-tracker-apps-for-seniors.md";
  slug: "best-offline-medication-tracker-apps-for-seniors";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-medication-trackers-for-seniors.md": {
	id: "best-offline-medication-trackers-for-seniors.md";
  slug: "best-offline-medication-trackers-for-seniors";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-password-managers-for-seniors.md": {
	id: "best-offline-password-managers-for-seniors.md";
  slug: "best-offline-password-managers-for-seniors";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-study-app-for-teens-2026.md": {
	id: "best-offline-study-app-for-teens-2026.md";
  slug: "best-offline-study-app-for-teens-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-offline-study-app-for-teens-guide.md": {
	id: "best-offline-study-app-for-teens-guide.md";
  slug: "best-offline-study-app-for-teens-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-one-time-purchase-apps-2026.md": {
	id: "best-one-time-purchase-apps-2026.md";
  slug: "best-one-time-purchase-apps-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-physics-simulation-apps-for-kids-offline.md": {
	id: "best-physics-simulation-apps-for-kids-offline.md";
  slug: "best-physics-simulation-apps-for-kids-offline";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"best-teen-study-apps-block-social-media.md": {
	id: "best-teen-study-apps-block-social-media.md";
  slug: "best-teen-study-apps-block-social-media";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"budgeting-app-that-works-without-internet.md": {
	id: "budgeting-app-that-works-without-internet.md";
  slug: "budgeting-app-that-works-without-internet";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"envelope-budgeting-app-no-bank-sync.md": {
	id: "envelope-budgeting-app-no-bank-sync.md";
  slug: "envelope-budgeting-app-no-bank-sync";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"essential-scam-prevention-tips-for-seniors.md": {
	id: "essential-scam-prevention-tips-for-seniors.md";
  slug: "essential-scam-prevention-tips-for-seniors";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"first-car-maintenance-guide-for-teens.md": {
	id: "first-car-maintenance-guide-for-teens.md";
  slug: "first-car-maintenance-guide-for-teens";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"focus-music-without-streaming-offline-alternatives.md": {
	id: "focus-music-without-streaming-offline-alternatives.md";
  slug: "focus-music-without-streaming-offline-alternatives";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"home-inventory-app-for-faster-insurance-claims.md": {
	id: "home-inventory-app-for-faster-insurance-claims.md";
  slug: "home-inventory-app-for-faster-insurance-claims";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"home-inventory-app-insurance-claims-guide.md": {
	id: "home-inventory-app-insurance-claims-guide.md";
  slug: "home-inventory-app-insurance-claims-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-learn-coding-on-phone-offline.md": {
	id: "how-to-learn-coding-on-phone-offline.md";
  slug: "how-to-learn-coding-on-phone-offline";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-make-a-zine-for-kids-guide.md": {
	id: "how-to-make-a-zine-for-kids-guide.md";
  slug: "how-to-make-a-zine-for-kids-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-protect-kids-data-online-parent-guide.md": {
	id: "how-to-protect-kids-data-online-parent-guide.md";
  slug: "how-to-protect-kids-data-online-parent-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-record-a-band-demo-offline.md": {
	id: "how-to-record-a-band-demo-offline.md";
  slug: "how-to-record-a-band-demo-offline";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-spot-a-scam-for-seniors-guide.md": {
	id: "how-to-spot-a-scam-for-seniors-guide.md";
  slug: "how-to-spot-a-scam-for-seniors-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-start-a-rock-collection-for-kids.md": {
	id: "how-to-start-a-rock-collection-for-kids.md";
  slug: "how-to-start-a-rock-collection-for-kids";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-start-a-side-hustle-at-16.md": {
	id: "how-to-start-a-side-hustle-at-16.md";
  slug: "how-to-start-a-side-hustle-at-16";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-teach-kids-coding-logic-without-syntax.md": {
	id: "how-to-teach-kids-coding-logic-without-syntax.md";
  slug: "how-to-teach-kids-coding-logic-without-syntax";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-teach-kids-financial-literacy-with-cash.md": {
	id: "how-to-teach-kids-financial-literacy-with-cash.md";
  slug: "how-to-teach-kids-financial-literacy-with-cash";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-teach-kids-fractions-through-cooking.md": {
	id: "how-to-teach-kids-fractions-through-cooking.md";
  slug: "how-to-teach-kids-fractions-through-cooking";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-track-chronic-illness-symptoms-effectively.md": {
	id: "how-to-track-chronic-illness-symptoms-effectively.md";
  slug: "how-to-track-chronic-illness-symptoms-effectively";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-to-write-a-memoir-for-beginners-guide.md": {
	id: "how-to-write-a-memoir-for-beginners-guide.md";
  slug: "how-to-write-a-memoir-for-beginners-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"how-zeroed-encrypts-your-data.md": {
	id: "how-zeroed-encrypts-your-data.md";
  slug: "how-zeroed-encrypts-your-data";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"local-first-software-movement-guide.md": {
	id: "local-first-software-movement-guide.md";
  slug: "local-first-software-movement-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"offline-medication-tracker-app-for-seniors.md": {
	id: "offline-medication-tracker-app-for-seniors.md";
  slug: "offline-medication-tracker-app-for-seniors";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"offline-medication-tracker-apps-for-seniors.md": {
	id: "offline-medication-tracker-apps-for-seniors.md";
  slug: "offline-medication-tracker-apps-for-seniors";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"offline-password-manager-for-seniors.md": {
	id: "offline-password-manager-for-seniors.md";
  slug: "offline-password-manager-for-seniors";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"pixel-art-tutorial-for-beginners-first-sprite.md": {
	id: "pixel-art-tutorial-for-beginners-first-sprite.md";
  slug: "pixel-art-tutorial-for-beginners-first-sprite";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"pixel-art-tutorial-for-kids-16x16-grid-guide.md": {
	id: "pixel-art-tutorial-for-kids-16x16-grid-guide.md";
  slug: "pixel-art-tutorial-for-kids-16x16-grid-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"privacy-budgeting-apps-compared.md": {
	id: "privacy-budgeting-apps-compared.md";
  slug: "privacy-budgeting-apps-compared";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"privacy-first-budgeting-apps-2026-comparison.md": {
	id: "privacy-first-budgeting-apps-2026-comparison.md";
  slug: "privacy-first-budgeting-apps-2026-comparison";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"privacy-first-budgeting-apps-compared-2026.md": {
	id: "privacy-first-budgeting-apps-compared-2026.md";
  slug: "privacy-first-budgeting-apps-compared-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"privacy-first-budgeting-philosophy.md": {
	id: "privacy-first-budgeting-philosophy.md";
  slug: "privacy-first-budgeting-philosophy";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"stop-motion-animation-for-beginners-guide.md": {
	id: "stop-motion-animation-for-beginners-guide.md";
  slug: "stop-motion-animation-for-beginners-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"subscription-fatigue-software-alternatives.md": {
	id: "subscription-fatigue-software-alternatives.md";
  slug: "subscription-fatigue-software-alternatives";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"teaching-kids-coding-without-screen-time.md": {
	id: "teaching-kids-coding-without-screen-time.md";
  slug: "teaching-kids-coding-without-screen-time";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"teen-side-hustle-tools-offline.md": {
	id: "teen-side-hustle-tools-offline.md";
  slug: "teen-side-hustle-tools-offline";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"true-cost-of-ynab.md": {
	id: "true-cost-of-ynab.md";
  slug: "true-cost-of-ynab";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"what-is-local-first-software-movement-guide-2026.md": {
	id: "what-is-local-first-software-movement-guide-2026.md";
  slug: "what-is-local-first-software-movement-guide-2026";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"what-is-local-first-software-movement-guide.md": {
	id: "what-is-local-first-software-movement-guide.md";
  slug: "what-is-local-first-software-movement-guide";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"what-is-local-first-software-movement.md": {
	id: "what-is-local-first-software-movement.md";
  slug: "what-is-local-first-software-movement";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-free-apps-sell-your-data.md": {
	id: "why-free-apps-sell-your-data.md";
  slug: "why-free-apps-sell-your-data";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-kids-deserve-digital-privacy.md": {
	id: "why-kids-deserve-digital-privacy.md";
  slug: "why-kids-deserve-digital-privacy";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-manual-expense-tracking-is-better.md": {
	id: "why-manual-expense-tracking-is-better.md";
  slug: "why-manual-expense-tracking-is-better";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-offline-apps-are-better.md": {
	id: "why-offline-apps-are-better.md";
  slug: "why-offline-apps-are-better";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-offline-apps-protect-seniors-data.md": {
	id: "why-offline-apps-protect-seniors-data.md";
  slug: "why-offline-apps-protect-seniors-data";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"why-we-dont-do-subscriptions.md": {
	id: "why-we-dont-do-subscriptions.md";
  slug: "why-we-dont-do-subscriptions";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"ynab-alternative-no-subscription-ultimate-comparison.md": {
	id: "ynab-alternative-no-subscription-ultimate-comparison.md";
  slug: "ynab-alternative-no-subscription-ultimate-comparison";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"ynab-alternative-no-subscription.md": {
	id: "ynab-alternative-no-subscription.md";
  slug: "ynab-alternative-no-subscription";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"ynab-alternatives-local-storage.md": {
	id: "ynab-alternatives-local-storage.md";
  slug: "ynab-alternatives-local-storage";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
"zero-based-budgeting-explained-simply.md": {
	id: "zero-based-budgeting-explained-simply.md";
  slug: "zero-based-budgeting-explained-simply";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".md"] };
};

	};

	type DataEntryMap = {
		
	};

	type AnyEntryMap = ContentEntryMap & DataEntryMap;

	export type ContentConfig = typeof import("./../../src/content/config.js");
}
